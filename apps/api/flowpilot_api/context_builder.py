"""Task-specific context selection for a failed step.

Goal: give the model the *minimum* relevant information. The builder never
summarizes the page; it selects elements:

1. keep candidates compatible with the step kind (a ``click`` cannot target a text field);
2. drop cross-origin links and candidates already rejected in previous attempts;
3. collapse identical descriptors (and remember how many copies exist: copies are
   indistinguishable, so choosing one of them is never auto-executed);
4. rank by semantic similarity to the recorded target;
5. keep at most ``max_elements`` and at most ``max_chars`` of serialized content.

Bounding the context is the main defense against *context rot*: irrelevant
elements dilute the signal for small local models. The limits are configurable
so the effect can be measured (see ``evaluation``).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

from .contracts import Candidate, ElementTarget, RecoveryRequest
from .grounding import Score, accepts, score


def fingerprint(value: Candidate | ElementTarget) -> str:
    """Stable identity of an element description, independent of the snapshot ``ref``."""
    payload = {
        "tag": value.tag,
        "role": value.role,
        "name": value.name,
        "text": value.text,
        "context": value.context,
        "attributes": dict(sorted(value.attributes.items())),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]


@dataclass(frozen=True, slots=True)
class ContextEntry:
    candidate: Candidate
    score: Score
    #: Number of *other* visible elements with the exact same description.
    duplicates: int


@dataclass(frozen=True, slots=True)
class ContextPack:
    entries: tuple[ContextEntry, ...]
    #: Candidates compatible with the step before truncation (for telemetry and context-rot studies).
    compatible_count: int
    excluded_count: int
    truncated: bool
    by_ref: dict[str, ContextEntry] = field(default_factory=dict)

    def shown(self, ref: str) -> ContextEntry | None:
        return self.by_ref.get(ref)


def _compact(entry: ContextEntry) -> dict[str, object]:
    c = entry.candidate
    item: dict[str, object] = {"ref": c.ref, "tag": c.tag}
    for key in ("role", "name", "text", "context", "section"):
        value = getattr(c, key)
        if value:
            item[key] = value
    if c.attributes:
        item["attributes"] = c.attributes
    if c.irreversible:
        item["irreversible"] = True
    if not c.same_origin:
        item["sameOrigin"] = False
    if entry.duplicates:
        item["identicalCopies"] = entry.duplicates
    return item


def build_context(request: RecoveryRequest, *, max_elements: int = 12, max_chars: int = 6_000) -> ContextPack:
    target = request.step.target
    rejected = {fingerprint(attempt.candidate) for attempt in request.attempts}

    # Cross-origin links can never be executed (no navigation outside the workflow origin):
    # they are not even shown to the model.
    compatible = [c for c in request.observation.elements if accepts(request.step.kind, c) and c.same_origin]
    allowed = [c for c in compatible if fingerprint(c) not in rejected]

    groups: dict[str, list[Candidate]] = {}
    for candidate in allowed:
        groups.setdefault(fingerprint(candidate), []).append(candidate)

    ranked = sorted(
        (ContextEntry(group[0], score(target, group[0]), len(group) - 1) for group in groups.values()),
        key=lambda entry: entry.score.total,
        reverse=True,
    )

    kept: list[ContextEntry] = []
    used = 0
    for entry in ranked[:max_elements]:
        size = len(json.dumps(_compact(entry), ensure_ascii=False))
        if kept and used + size > max_chars:
            break
        kept.append(entry)
        used += size

    entries = tuple(kept)
    return ContextPack(
        entries=entries,
        compatible_count=len(compatible),
        excluded_count=len(compatible) - len(allowed),
        truncated=len(kept) < len(ranked),
        by_ref={entry.candidate.ref: entry for entry in entries},
    )


def render_untrusted(request: RecoveryRequest, pack: ContextPack) -> str:
    """Serialized page observation. Always placed inside an explicit untrusted-content block."""
    path = request.page.url.split("?", 1)[0]
    payload = {
        "page": {"path": path, "title": request.page.title},
        "elements": [_compact(entry) for entry in pack.entries],
    }
    # Escape "<" so page text cannot close the <untrusted_page_content> block (still valid JSON).
    return json.dumps(payload, ensure_ascii=False, indent=None).replace("<", "\\u003c")


def render_task(request: RecoveryRequest) -> str:
    """Trusted part: what the workflow tried to do. Comes from the user's own recording."""
    target = request.step.target
    recorded = {
        key: value
        for key, value in {
            "tag": target.tag,
            "role": target.role,
            "name": target.name,
            "text": target.text,
            "context": target.context,
            "attributes": target.attributes or None,
        }.items()
        if value
    }
    return json.dumps(
        {
            "action": request.step.kind,
            "recordedTarget": recorded,
            "failure": request.failure.code,
            "previouslyRejected": len(request.attempts),
        },
        ensure_ascii=False,
    )
