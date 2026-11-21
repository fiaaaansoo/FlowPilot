"""Versioned prompts. A prompt change = a new version, so evaluations stay reproducible."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from . import recovery_v1, recovery_v2
from .recovery_v1 import ACTION_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, render_user_message


@dataclass(frozen=True, slots=True)
class Prompt:
    version: str
    system: str
    schema: dict[str, Any]
    render: Callable[..., str]


PROMPTS: dict[str, Prompt] = {
    module.PROMPT_VERSION: Prompt(
        module.PROMPT_VERSION, module.SYSTEM_PROMPT, module.ACTION_SCHEMA, module.render_user_message
    )
    for module in (recovery_v1, recovery_v2)
}

#: Version used unless FLOWPILOT_PROMPT_VERSION selects another one.
DEFAULT_PROMPT_VERSION = recovery_v1.PROMPT_VERSION


def get_prompt(version: str | None = None) -> Prompt:
    return PROMPTS[version or DEFAULT_PROMPT_VERSION]


__all__ = [
    "ACTION_SCHEMA",
    "DEFAULT_PROMPT_VERSION",
    "PROMPTS",
    "PROMPT_VERSION",
    "SYSTEM_PROMPT",
    "Prompt",
    "get_prompt",
    "render_user_message",
]
