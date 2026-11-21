"""Recovery agent: the reasoning half of FlowPilot's recovery loop.

The full lifecycle spans both processes:

    extension: OBSERVE (snapshot) -> request
    backend:   CLASSIFY -> MEMORY -> BUILD_CONTEXT -> SEMANTIC -> (MODEL loop) -> VALIDATE -> decision
    extension: VALIDATE (gateway) -> [HUMAN] -> EXECUTE (deterministic executor) -> VERIFY
               -> SUCCESS | RETRY (new snapshot, previous attempts excluded) | ESCALATE

This module implements the backend states as an explicit, bounded state
machine (no framework: the graph is linear with one bounded loop, see
``docs/adr/0002-recovery-state-machine.md``). Every transition is recorded in a
trace that is stored with the telemetry row.

Acceptance policy (reliability over autonomy):

* memory and semantic matches are proposed only when they designate exactly one
  current element;
* a model proposal must reference an element the model was shown, compatible
  with the step, not previously rejected, not disabled, not a cross-origin link;
* a model proposal is auto-executable only with high confidence *and* structural
  support from semantic grounding (same role or tag), and never when identical
  copies exist; otherwise a human confirms, or the agent escalates;
* anything flagged irreversible always requires human confirmation.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import Settings
from .context_builder import ContextEntry, ContextPack, build_context, fingerprint, render_task, render_untrusted
from .contracts import Binding, Candidate, Decision, Escalate, ProposeTarget, RecoveryRequest, RecoveryResponse, Usage
from .grounding import Score, accepts, decide, score
from .pricing import estimate_cost
from .prompts import ACTION_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, render_user_message
from .providers import Message, ModelProvider, ProviderError
from .store import Correction, Store
from .text import normalize, tokens

#: Thresholds for executing a model proposal without asking the user.
AUTO_CONFIDENCE = 0.8
CONFIRM_CONFIDENCE = 0.5
STRUCTURAL_SUPPORT = 0.6
MAX_INVALID_OUTPUTS = 2


class State(StrEnum):
    CLASSIFY = "classify"
    MEMORY = "memory"
    BUILD_CONTEXT = "build_context"
    SEMANTIC = "semantic"
    MODEL = "model"
    TOOL = "tool"
    VALIDATE = "validate"
    DECIDED = "decided"
    ESCALATED = "escalated"


class ModelAction(BaseModel):
    """One structured action from the model. Anything else is an invalid output."""

    model_config = ConfigDict(extra="forbid")

    action: str = Field(pattern="^(find_elements|inspect_element|propose_target|request_user_confirmation|escalate)$")
    ref: str = Field(default="", max_length=8)
    query: str = Field(default="", max_length=200)
    confidence: float = Field(default=0.0, ge=0, le=1)
    reason: str = Field(default="", max_length=600)


@dataclass
class _Run:
    request: RecoveryRequest
    started: float
    deadline: float
    trace: list[dict[str, Any]] = field(default_factory=list)
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int | None = None
    cache_write: int | None = None
    cost: float = 0.0
    pack: ContextPack | None = None
    #: Refs the model has seen (context, search results, inspections): the only refs it may propose.
    shown: set[str] = field(default_factory=set)
    proposed: Candidate | None = None

    def log(self, state: State, **detail: Any) -> None:
        self.trace.append({"state": state.value, "ms": int((time.perf_counter() - self.started) * 1000), **detail})


class RecoveryAgent:
    def __init__(self, *, settings: Settings, store: Store, provider: ModelProvider | None) -> None:
        self.settings = settings
        self.store = store
        self.provider = provider

    # --- entry point ------------------------------------------------------------

    def propose(self, request: RecoveryRequest) -> RecoveryResponse:
        started = time.perf_counter()
        run = _Run(request=request, started=started, deadline=started + request.budget.timeout_ms / 1000)
        decision = self._decide(run)
        return self._finish(run, decision)

    def _decide(self, run: _Run) -> Decision:
        request = run.request
        elements = [c for c in request.observation.elements if c.ref]
        rejected = {fingerprint(a.candidate) for a in request.attempts}

        # CLASSIFY: only target-resolution failures, never sensitive fields.
        run.log(State.CLASSIFY, failure=request.failure.code, kind=request.step.kind, attempts=len(request.attempts))
        if request.step.kind == "manualInput":
            return self._escalate(run, "none", "Sensitive fields are never recovered automatically.")

        usable = [
            c for c in elements if accepts(request.step.kind, c) and fingerprint(c) not in rejected and c.same_origin
        ]

        # MEMORY: a verified correction is reused only if it matches exactly one current element.
        prior = self._memory_lookup(run)
        if prior is not None:
            matches = [c for c in usable if _same_element(prior.corrected, c)]
            run.log(State.MEMORY, correction=prior.id, matches=len(matches))
            if len(matches) == 1:
                self.store.mark_used(prior.id)
                return self._propose(run, matches[0], 0.95, "memory", "Verified correction from a previous run.")
        else:
            run.log(State.MEMORY, correction=None)

        # BUILD_CONTEXT
        pack = build_context(
            request,
            max_elements=self.settings.context_max_elements,
            max_chars=self.settings.context_max_chars,
        )
        run.pack = pack
        run.shown = set(pack.by_ref)
        run.log(
            State.BUILD_CONTEXT,
            shown=len(pack.entries),
            compatible=pack.compatible_count,
            excluded=pack.excluded_count,
            truncated=pack.truncated,
        )
        if not pack.entries:
            return self._escalate(run, "none", "No compatible element is visible on the page.")

        # SEMANTIC: strong, unique match without a model.
        semantic = decide(request.step.target, request.step.kind, [e.candidate for e in pack.entries])
        run.log(State.SEMANTIC, ref=semantic.ref, confidence=round(semantic.confidence, 3), reason=semantic.reason)
        if semantic.ref is not None:
            entry = pack.by_ref[semantic.ref]
            if entry.duplicates == 0 and entry.candidate.same_origin:
                return self._propose(run, entry.candidate, semantic.confidence, "semantic", semantic.reason)

        if self.provider is None:
            return self._escalate(run, "semantic", "No confident match and no model is configured.")
        return self._model_loop(run, prior)

    # --- memory -----------------------------------------------------------------

    def _memory_lookup(self, run: _Run) -> Correction | None:
        b = run.request.binding
        return self.store.find_correction(
            origin=b.origin,
            workflow_id=b.workflow_id,
            step_id=b.step_id,
            target_fp=fingerprint(run.request.step.target),
        )

    # --- model loop -------------------------------------------------------------

    def _model_loop(self, run: _Run, prior: Correction | None) -> Decision:
        assert self.provider is not None and run.pack is not None
        request = run.request
        budget = request.budget
        hint = None
        if prior is not None:
            hint = {
                "recordedAs": prior.original.name or prior.original.text,
                "previouslyMatched": _describe(prior.corrected),
            }
        messages = [
            Message(
                "user",
                render_user_message(
                    task_json=render_task(request),
                    page_json=render_untrusted(request, run.pack),
                    prior_correction=hint,
                ),
            )
        ]
        invalid = 0
        while True:
            if run.calls >= budget.max_model_calls:
                return self._escalate(run, "llm", "Model call budget exhausted.")
            if time.perf_counter() > run.deadline:
                return self._escalate(run, "llm", "Recovery time budget exhausted.")
            try:
                reply = self._call(run, messages)
            except ProviderError as exc:
                return self._escalate(run, "llm", f"Model provider error ({exc.code}): {exc}")
            if run.input_tokens + run.output_tokens > budget.max_tokens:
                return self._escalate(run, "llm", "Token budget exhausted.")
            if run.cost > budget.max_cost_usd:
                return self._escalate(run, "llm", "Cost budget exhausted.")

            try:
                action = ModelAction.model_validate_json(reply)
            except ValidationError as exc:
                invalid += 1
                run.log(State.MODEL, invalid_output=True, error=str(exc.errors()[0].get("msg", "invalid"))[:120])
                if invalid > MAX_INVALID_OUTPUTS:
                    return self._escalate(run, "llm", "The model kept returning invalid output.")
                messages += [
                    Message("assistant", reply[:2000]),
                    Message("user", "Invalid answer: it must be one JSON object matching the schema. Try again."),
                ]
                continue

            run.log(State.MODEL, action=action.action, ref=action.ref, confidence=action.confidence)
            if action.action == "escalate":
                return self._escalate(run, "llm", action.reason[:280] or "The model found no safe match.")
            if action.action in {"find_elements", "inspect_element"}:
                result = self._tool(run, action)
                messages += [Message("assistant", reply), Message("user", f"<tool_result>\n{result}\n</tool_result>")]
                continue
            return self._validate_proposal(run, action)

    def _call(self, run: _Run, messages: list[Message]) -> str:
        assert self.provider is not None
        attempts = 0
        while True:
            run.calls += 1
            remaining = max(1.0, run.deadline - time.perf_counter())
            try:
                reply = self.provider.complete(
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    schema=ACTION_SCHEMA,
                    timeout_s=min(self.settings.llm_timeout_s, remaining),
                )
            except ProviderError as exc:
                attempts += 1
                if (
                    exc.retryable
                    and attempts <= self.settings.llm_max_retries
                    and run.calls < run.request.budget.max_model_calls
                ):
                    continue
                raise
            usage = reply.usage
            run.input_tokens += usage.input_tokens
            run.output_tokens += usage.output_tokens
            if usage.cache_read_tokens is not None:
                run.cache_read = (run.cache_read or 0) + usage.cache_read_tokens
            if usage.cache_write_tokens is not None:
                run.cache_write = (run.cache_write or 0) + usage.cache_write_tokens
            run.cost += estimate_cost(
                provider_local=self.provider.local,
                model=reply.model or self.provider.model,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_read_tokens=usage.cache_read_tokens,
                cache_write_tokens=usage.cache_write_tokens,
                override_input=self.settings.price_input,
                override_output=self.settings.price_output,
            )
            return reply.text

    def _tool(self, run: _Run, action: ModelAction) -> str:
        """Read-only tools over the observation the extension sent. They never touch the browser."""
        import json

        request = run.request
        rejected = {fingerprint(a.candidate) for a in request.attempts}
        usable = [
            c
            for c in request.observation.elements
            if accepts(request.step.kind, c) and fingerprint(c) not in rejected and c.same_origin
        ]
        if action.action == "find_elements":
            wanted = tokens(action.query)
            found = [
                c
                for c in usable
                if wanted
                & tokens(" ".join(filter(None, [c.name, c.text, c.context, c.section, *c.attributes.values()])))
            ][:5]
            run.shown.update(c.ref for c in found)
            run.log(State.TOOL, tool="find_elements", results=len(found))
            return json.dumps({"elements": [_describe(c) for c in found]}, ensure_ascii=False)
        candidate = next((c for c in usable if c.ref == action.ref), None)
        run.log(State.TOOL, tool="inspect_element", ref=action.ref, found=candidate is not None)
        if candidate is None:
            return json.dumps({"error": "unknown or incompatible ref"})
        run.shown.add(candidate.ref)
        return json.dumps({"element": _describe(candidate)}, ensure_ascii=False)

    # --- validation and policy --------------------------------------------------

    def _validate_proposal(self, run: _Run, action: ModelAction) -> Decision:
        request = run.request
        candidate = next((c for c in request.observation.elements if c.ref == action.ref), None)
        rejected = {fingerprint(a.candidate) for a in request.attempts}
        problem = None
        if candidate is None or action.ref not in run.shown:
            problem = "the model proposed an element it was not shown"
        elif not accepts(request.step.kind, candidate):
            problem = "the proposed element cannot perform the recorded action"
        elif fingerprint(candidate) in rejected:
            problem = "the model repeated a rejected proposal"
        elif not candidate.same_origin:
            problem = "the proposed link leaves the workflow origin"
        run.log(State.VALIDATE, ref=action.ref, problem=problem)
        if problem or candidate is None:
            return self._escalate(run, "llm", f"Proposal rejected: {problem}.")

        support: Score = score(request.step.target, candidate)
        entry: ContextEntry | None = run.pack.shown(candidate.ref) if run.pack else None
        duplicates = entry.duplicates if entry else 0
        structural = support.structure >= STRUCTURAL_SUPPORT
        confident = action.confidence >= AUTO_CONFIDENCE
        human_requested = action.action == "request_user_confirmation"
        if action.confidence < CONFIRM_CONFIDENCE:
            return self._escalate(run, "llm", f"Model confidence too low ({action.confidence:.2f}).")
        auto = confident and structural and duplicates == 0 and not human_requested
        return self._propose(
            run, candidate, action.confidence, "llm", action.reason or "Model proposal.", force_confirm=not auto
        )

    def _propose(
        self,
        run: _Run,
        candidate: Candidate,
        confidence: float,
        strategy: str,
        reason: str,
        *,
        force_confirm: bool = False,
    ) -> Decision:
        run.proposed = candidate
        requires = force_confirm or candidate.irreversible
        run.log(State.DECIDED, ref=candidate.ref, strategy=strategy, confirm=requires)
        return ProposeTarget(
            type="propose_target",
            ref=candidate.ref,
            confidence=round(min(max(confidence, 0), 1), 3),
            strategy=strategy,
            rationale=reason[:300],
            requires_confirmation=requires,
        )

    def _escalate(self, run: _Run, strategy: str, reason: str) -> Decision:
        run.log(State.ESCALATED, reason=reason)
        return Escalate(type="escalate", strategy=strategy, reason=reason[:300])

    # --- result -----------------------------------------------------------------

    def _finish(self, run: _Run, decision: Decision) -> RecoveryResponse:
        import json

        request = run.request
        recovery_id = uuid.uuid4().hex
        latency = int((time.perf_counter() - run.started) * 1000)
        usage = Usage(
            provider=self.provider.name if self.provider and run.calls else "none",
            model=self.provider.model if self.provider and run.calls else None,
            prompt_version=PROMPT_VERSION,
            model_calls=run.calls,
            input_tokens=run.input_tokens,
            output_tokens=run.output_tokens,
            cache_read_tokens=run.cache_read,
            cache_write_tokens=run.cache_write,
            latency_ms=latency,
            estimated_cost_usd=round(run.cost, 6),
            context_elements=len(run.pack.entries) if run.pack else 0,
        )
        b: Binding = request.binding
        self.store.record_recovery(
            {
                "id": recovery_id,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "origin": b.origin,
                "workflow_id": b.workflow_id,
                "step_id": b.step_id,
                "step_index": b.step_index,
                "step_kind": request.step.kind,
                "failure_code": request.failure.code,
                "decision": decision.type,
                "strategy": decision.strategy,
                "confidence": decision.confidence if isinstance(decision, ProposeTarget) else None,
                "requires_confirmation": int(decision.requires_confirmation)
                if isinstance(decision, ProposeTarget)
                else None,
                "provider": usage.provider,
                "model": usage.model,
                "prompt_version": PROMPT_VERSION,
                "model_calls": run.calls,
                "input_tokens": run.input_tokens,
                "output_tokens": run.output_tokens,
                "cache_read_tokens": run.cache_read,
                "cache_write_tokens": run.cache_write,
                "latency_ms": latency,
                "cost_usd": round(run.cost, 6),
                "context_elements": usage.context_elements,
                "compatible_elements": run.pack.compatible_count if run.pack else 0,
                "original_json": request.step.target.model_dump_json(by_alias=True),
                "proposed_json": run.proposed.model_dump_json(by_alias=True) if run.proposed else None,
                "trace_json": json.dumps(run.trace, ensure_ascii=False),
            }
        )
        return RecoveryResponse(recovery_id=recovery_id, binding=b, decision=decision, usage=usage)


def _same_element(stored: Candidate, current: Candidate) -> bool:
    """Does a current element match a stored correction? Identity hints must agree exactly."""
    if stored.tag != current.tag or (stored.role or "") != (current.role or ""):
        return False
    if normalize(stored.name) != normalize(current.name):
        return False
    for key in ("id", "name", "data-testid", "href", "type"):
        if stored.attributes.get(key) != current.attributes.get(key):
            return False
    return not stored.context or normalize(stored.context) == normalize(current.context)


def _describe(candidate: Candidate) -> dict[str, Any]:
    return candidate.model_dump(by_alias=True, exclude_none=True, exclude_defaults=True) | {"ref": candidate.ref}
