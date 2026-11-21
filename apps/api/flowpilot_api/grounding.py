"""Semantic grounding without a model: compare the recorded target with current candidates.

The score combines label similarity, stable-attribute similarity, row/section
context and structural compatibility. It recovers renamed labels
("Rechercher" -> "Lancer la recherche"), changed ids or classes and moved
elements, but not pure synonyms ("Search jobs" -> "Find opportunities"):
those need the model. It is also used to *support or contradict* a model
proposal: a model choice with no structural support is never auto-executed.
"""

from __future__ import annotations

from dataclasses import dataclass

from .contracts import Candidate, ElementTarget, StepKind
from .text import jaccard, overlap, tokens

CLICKABLE_ROLES = frozenset({"button", "link", "tab", "menuitem", "option", "switch", "checkbox", "radio", "treeitem"})
TEXT_ROLES = frozenset({"textbox", "searchbox", "spinbutton", "combobox"})
CHOICE_ROLES = frozenset({"combobox", "listbox"})
TOGGLE_ROLES = frozenset({"checkbox", "radio", "switch"})


def accepts(kind: StepKind, candidate: Candidate) -> bool:
    """Can a step of this kind be executed on this element? Mirrors ``kindAccepts`` in the extension."""
    role = candidate.role or ""
    tag = candidate.tag
    if candidate.disabled:
        return False
    if kind == "click":
        return role in CLICKABLE_ROLES or tag in {"a", "button", "summary"} or role == ""
    if kind in {"input", "press", "manualInput"}:
        return role in TEXT_ROLES - {"combobox"} or tag == "textarea"
    if kind == "select":
        return tag == "select" or role in CHOICE_ROLES
    if kind == "check":
        return role in TOGGLE_ROLES
    if kind == "submit":
        return tag == "form" or role == "form"
    return False


def _label(value: ElementTarget | Candidate) -> str:
    attrs = value.attributes
    parts = [value.name, value.text, attrs.get("aria-label"), attrs.get("placeholder"), attrs.get("title")]
    return " ".join(part for part in parts if part)


def _identifiers(value: ElementTarget | Candidate) -> frozenset[str]:
    attrs = value.attributes
    keys = ("id", "name", "data-testid", "data-test", "data-qa", "data-cy", "for")
    return tokens(" ".join(attrs[key] for key in keys if attrs.get(key)))


def _href_path(value: ElementTarget | Candidate) -> str | None:
    href = value.attributes.get("href")
    if not href:
        return None
    return href.split("#", 1)[0].split("?", 1)[0].rstrip("/") or "/"


@dataclass(frozen=True, slots=True)
class Score:
    ref: str
    total: float
    label: float
    identifiers: float
    context: float
    structure: float


def score(target: ElementTarget, candidate: Candidate) -> Score:
    """Similarity in [0, 1] between the recorded target and a candidate."""
    old_label = tokens(_label(target))
    new_label = tokens(_label(candidate))
    label = max(jaccard(old_label, new_label), 0.85 * overlap(old_label, new_label))

    old_ids = _identifiers(target)
    identifiers = jaccard(old_ids, _identifiers(candidate)) if old_ids else 0.0
    old_href, new_href = _href_path(target), _href_path(candidate)
    if old_href and new_href:
        identifiers = max(identifiers, 1.0 if old_href == new_href else 0.0)

    context = jaccard(tokens(target.context), tokens(candidate.context)) if target.context else 0.0

    structure = 0.0
    if target.role and target.role == candidate.role:
        structure += 0.6
    if target.tag == candidate.tag:
        structure += 0.3
    if target.attributes.get("type") and target.attributes.get("type") == candidate.attributes.get("type"):
        structure += 0.1

    # Weights favour meaning (label) and stable identifiers over structure, which many elements share.
    if target.context:
        total = 0.45 * label + 0.2 * identifiers + 0.2 * context + 0.15 * structure
    else:
        total = 0.55 * label + 0.25 * identifiers + 0.2 * structure
    return Score(candidate.ref, round(total, 4), label, identifiers, context, min(structure, 1.0))


@dataclass(frozen=True, slots=True)
class SemanticDecision:
    ref: str | None
    confidence: float
    ranked: tuple[Score, ...]
    reason: str


#: A semantic match is only executed without a model when it is both strong and clearly ahead.
SEMANTIC_ACCEPT = 0.6
SEMANTIC_MARGIN = 0.2


def rank(target: ElementTarget, kind: StepKind, candidates: list[Candidate]) -> list[Score]:
    compatible = [c for c in candidates if accepts(kind, c)]
    return sorted((score(target, c) for c in compatible), key=lambda s: s.total, reverse=True)


def decide(target: ElementTarget, kind: StepKind, candidates: list[Candidate]) -> SemanticDecision:
    ranked = rank(target, kind, candidates)
    if not ranked:
        return SemanticDecision(None, 0.0, (), "no compatible element on the page")
    best = ranked[0]
    runner_up = ranked[1].total if len(ranked) > 1 else 0.0
    if best.total >= SEMANTIC_ACCEPT and best.total - runner_up >= SEMANTIC_MARGIN:
        return SemanticDecision(best.ref, best.total, tuple(ranked), "strong unique semantic match")
    if best.total >= SEMANTIC_ACCEPT:
        return SemanticDecision(None, best.total, tuple(ranked), "several elements match equally well")
    return SemanticDecision(None, best.total, tuple(ranked), "no element is similar enough")
