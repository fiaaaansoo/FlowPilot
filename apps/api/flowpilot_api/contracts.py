"""Versioned wire contract between the FlowPilot extension and the recovery backend.

Contract id: ``flowpilot.recovery/v1``. The TypeScript twin lives in
``packages/shared/src/recovery.ts``; both sides validate the shared JSON
fixtures in ``tests/contracts`` so they cannot drift silently.

Design rules:

* Everything coming from a web page (element names, texts, attributes, page
  title) is *untrusted data*. It is bounded here and labelled as such in
  prompts; it is never interpreted as an instruction.
* The extension never sends field values, sensitive fields, cookies or full
  HTML. The backend rejects payloads that exceed the size limits.
* The model can only *select a candidate element* (by ``ref``) for the failed
  step. It cannot change the action, the value, or navigate anywhere.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CONTRACT = "flowpilot.recovery/v1"

MAX_TEXT = 200
MAX_ATTRIBUTE_VALUE = 300
MAX_ATTRIBUTES = 12
MAX_ELEMENTS = 300
MAX_ATTEMPTS = 8

StepKind = Literal["click", "input", "manualInput", "select", "check", "press", "submit"]
#: Failures that recovery may handle. Permission, sensitive-field, confirmation and policy
#: failures are deliberately absent: they must never trigger autonomous recovery.
RecoverableCode = Literal["TARGET_NOT_FOUND", "TARGET_AMBIGUOUS"]
Strategy = Literal["memory", "semantic", "llm", "none"]

ShortText = Annotated[str, Field(max_length=MAX_TEXT)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


def _bounded_attributes(value: dict[str, str]) -> dict[str, str]:
    if len(value) > MAX_ATTRIBUTES:
        raise ValueError(f"at most {MAX_ATTRIBUTES} attributes")
    for key, item in value.items():
        if not key or len(key) > 64 or not key.replace("-", "").replace("_", "").replace(":", "").isalnum():
            raise ValueError(f"invalid attribute name {key!r}")
        if len(item) > MAX_ATTRIBUTE_VALUE:
            raise ValueError(f"attribute {key!r} is too long")
    return value


class ElementTarget(_Strict):
    """Multi-hint description of the element a workflow step was recorded on."""

    tag: Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$", max_length=32)]
    role: ShortText | None = None
    name: ShortText | None = None
    text: ShortText | None = None
    context: ShortText | None = None
    attributes: dict[str, str] = Field(default_factory=dict)
    css: Annotated[str, Field(min_length=1, max_length=1000)]

    _check_attributes = field_validator("attributes")(_bounded_attributes)


class Candidate(_Strict):
    """An element currently visible in the page, observed by the extension (untrusted content)."""

    ref: Annotated[str, Field(pattern=r"^e\d{1,5}$")]
    tag: Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$", max_length=32)]
    role: ShortText | None = None
    name: ShortText | None = None
    text: ShortText | None = None
    #: Text of the row (list item, table row, card) containing the element.
    context: ShortText | None = None
    #: Label of the enclosing form, section, dialog or landmark.
    section: ShortText | None = None
    attributes: dict[str, str] = Field(default_factory=dict)
    disabled: bool = False
    #: The extension's irreversibility heuristic flagged this element.
    irreversible: bool = False
    #: For links: does the target URL stay on the workflow origin?
    same_origin: bool = Field(default=True, alias="sameOrigin")

    _check_attributes = field_validator("attributes")(_bounded_attributes)


class Binding(_Strict):
    """Binds a recovery to one run, tab, origin, workflow step and page snapshot."""

    run_id: Annotated[str, Field(min_length=1, max_length=64, alias="runId")]
    workflow_id: Annotated[str, Field(min_length=1, max_length=64, alias="workflowId")]
    step_id: Annotated[str, Field(min_length=1, max_length=64, alias="stepId")]
    step_index: Annotated[int, Field(ge=0, le=500, alias="stepIndex")]
    origin: Annotated[str, Field(pattern=r"^https?://[^/\s]+$", max_length=200)]
    tab_id: Annotated[int, Field(ge=0, alias="tabId")]
    snapshot_id: Annotated[str, Field(min_length=1, max_length=64, alias="snapshotId")]


class Failure(_Strict):
    code: RecoverableCode
    message: Annotated[str, Field(max_length=500)]


class FailedStep(_Strict):
    """The step that failed. Values (typed text, selected option) are never transmitted."""

    kind: StepKind
    target: ElementTarget


class PageInfo(_Strict):
    url: Annotated[str, Field(pattern=r"^https?://", max_length=2000)]
    title: ShortText = ""


class Observation(_Strict):
    snapshot_id: Annotated[str, Field(min_length=1, max_length=64, alias="snapshotId")]
    elements: Annotated[list[Candidate], Field(max_length=MAX_ELEMENTS)]


class PreviousAttempt(_Strict):
    """A candidate already proposed in an earlier attempt of the same recovery, and why it was dropped."""

    candidate: Candidate
    outcome: Literal["rejected", "failed"]
    reason: Annotated[str, Field(max_length=300)]


class Budget(_Strict):
    max_model_calls: Annotated[int, Field(ge=0, le=8, alias="maxModelCalls")] = 3
    max_tokens: Annotated[int, Field(ge=0, le=200_000, alias="maxTokens")] = 12_000
    timeout_ms: Annotated[int, Field(ge=1_000, le=120_000, alias="timeoutMs")] = 30_000
    max_cost_usd: Annotated[float, Field(ge=0, le=10, alias="maxCostUsd")] = 0.05


class RecoveryRequest(_Strict):
    contract: Literal["flowpilot.recovery/v1"]
    binding: Binding
    failure: Failure
    step: FailedStep
    page: PageInfo
    observation: Observation
    attempts: Annotated[list[PreviousAttempt], Field(max_length=MAX_ATTEMPTS)] = Field(default_factory=list)
    budget: Budget = Field(default_factory=Budget)


class ProposeTarget(_Strict):
    type: Literal["propose_target"]
    ref: Annotated[str, Field(pattern=r"^e\d{1,5}$")]
    confidence: Annotated[float, Field(ge=0, le=1)]
    strategy: Strategy
    rationale: Annotated[str, Field(max_length=300)]
    #: The backend's policy requires a human to approve before execution.
    requires_confirmation: bool = Field(alias="requiresConfirmation")


class Escalate(_Strict):
    type: Literal["escalate"]
    strategy: Strategy
    reason: Annotated[str, Field(max_length=300)]


Decision = Annotated[ProposeTarget | Escalate, Field(discriminator="type")]


class Usage(_Strict):
    provider: Annotated[str, Field(max_length=40)]
    model: str | None = Field(default=None, max_length=120)
    prompt_version: Annotated[str, Field(max_length=40, alias="promptVersion")]
    model_calls: Annotated[int, Field(ge=0, alias="modelCalls")] = 0
    input_tokens: Annotated[int, Field(ge=0, alias="inputTokens")] = 0
    output_tokens: Annotated[int, Field(ge=0, alias="outputTokens")] = 0
    #: ``None`` when the provider does not report cache usage.
    cache_read_tokens: int | None = Field(default=None, ge=0, alias="cacheReadTokens")
    cache_write_tokens: int | None = Field(default=None, ge=0, alias="cacheWriteTokens")
    latency_ms: Annotated[int, Field(ge=0, alias="latencyMs")] = 0
    #: External API charges only; local inference reports 0 (hardware and energy are not counted).
    estimated_cost_usd: Annotated[float, Field(ge=0, alias="estimatedCostUsd")] = 0.0
    context_elements: Annotated[int, Field(ge=0, alias="contextElements")] = 0


class RecoveryResponse(_Strict):
    contract: Literal["flowpilot.recovery/v1"] = CONTRACT
    recovery_id: Annotated[str, Field(alias="recoveryId")]
    binding: Binding
    decision: Decision
    usage: Usage


class OutcomeReport(_Strict):
    """Sent by the extension once the recovered step (and the step after it) ran."""

    contract: Literal["flowpilot.recovery/v1"]
    verified: bool
    detail: Annotated[str, Field(max_length=300)] = ""
    #: Description of the element that was actually used, recorded only when ``verified``.
    corrected_target: Candidate | None = Field(default=None, alias="correctedTarget")


class MemoryEntryOut(_Strict):
    id: int
    origin: str
    workflow_id: str = Field(alias="workflowId")
    step_id: str = Field(alias="stepId")
    failure_code: str = Field(alias="failureCode")
    original: ElementTarget
    corrected: Candidate
    strategy: Strategy
    uses: int
    created_at: str = Field(alias="createdAt")
    last_used_at: str | None = Field(alias="lastUsedAt")


class ErrorBody(_Strict):
    contract: Literal["flowpilot.recovery/v1"] = CONTRACT
    error: str
    message: str
