"""Small, dependency-free text normalization used by semantic grounding and memory matching."""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "in",
        "into",
        "is",
        "it",
        "of",
        "on",
        "or",
        "the",
        "this",
        "to",
        "with",
        "your",
        "you",
        "au",
        "aux",
        "avec",
        "ce",
        "ces",
        "dans",
        "de",
        "des",
        "du",
        "en",
        "et",
        "la",
        "le",
        "les",
        "leur",
        "mon",
        "ma",
        "mes",
        "ou",
        "par",
        "pour",
        "sur",
        "un",
        "une",
        "vos",
        "votre",
        "l",
        "d",
        "s",
        "n",
        "qu",
        "je",
        "tu",
        "il",
        "nous",
    ]
)

_SUFFIXES = (
    "ements",
    "ement",
    "ations",
    "ation",
    "euses",
    "euse",
    "eurs",
    "eur",
    "ings",
    "ing",
    "ers",
    "er",
    "es",
    "ez",
    "s",
    "e",
)


def normalize(text: str | None) -> str:
    """Lowercase, strip accents and collapse whitespace."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped.lower()).strip()


def stem(token: str) -> str:
    """Very light suffix stripping (French and English) so that recherche/rechercher/recherches match."""
    for suffix in _SUFFIXES:
        if len(token) > len(suffix) + 3 and token.endswith(suffix):
            return token[: -len(suffix)]
    return token


@lru_cache(maxsize=4096)
def tokens(text: str | None) -> frozenset[str]:
    """Meaningful stemmed tokens of a label. Also splits camelCase and snake/kebab identifiers."""
    if not text:
        return frozenset()
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    words = re.split(r"[^a-z0-9]+", normalize(spaced))
    return frozenset(stem(word) for word in words if len(word) > 1 and word not in _STOPWORDS)


def jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def overlap(left: frozenset[str], right: frozenset[str]) -> float:
    """Share of ``left`` tokens found in ``right`` (asymmetric: did the old label survive in the new one?)."""
    if not left or not right:
        return 0.0
    return len(left & right) / len(left)
