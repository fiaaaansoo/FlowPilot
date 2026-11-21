"""Provider-independent model interface.

The recovery agent only needs one capability: *given a system prompt and a
conversation, return a JSON object matching a schema*. Each provider maps that
to its native structured-output mechanism (Ollama ``format``, OpenAI-compatible
``response_format``, Anthropic ``output_config.format``). Tool calling is
expressed at the agent level as a closed set of JSON actions, so it works the
same way on every provider, including small local models.

There is no fallback between providers: a failure is reported as a
``ProviderError`` and the agent escalates to the user.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx

Role = Literal["user", "assistant"]


@dataclass(frozen=True, slots=True)
class Message:
    role: Role
    content: str


@dataclass(slots=True)
class ProviderUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    #: ``None`` when the provider does not expose prompt-cache metrics.
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None


@dataclass(slots=True)
class ModelReply:
    text: str
    usage: ProviderUsage = field(default_factory=ProviderUsage)
    latency_ms: int = 0
    model: str | None = None


class ProviderError(Exception):
    """Any provider failure. ``retryable`` marks transient failures (timeouts, 429, 5xx)."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def chat_messages(system: str, messages: list[Message]) -> list[dict[str, str]]:
    """Chat-completions style message list (system prompt first)."""
    return [{"role": "system", "content": system}] + [{"role": m.role, "content": m.content} for m in messages]


def post_json(
    client: httpx.Client,
    url: str,
    body: dict[str, Any],
    *,
    timeout_s: float,
    service: str,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    """POST with the network failures every HTTP provider maps the same way (timeouts are retryable)."""
    try:
        return client.post(url, json=body, headers=headers or {}, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        raise ProviderError("timeout", f"{service} did not answer within {timeout_s:.0f} s.", retryable=True) from exc
    except httpx.HTTPError as exc:
        where = redact_url(url)
        raise ProviderError("unreachable", f"{service} is unreachable at {where}: {exc}".replace(url, where)) from exc


def redact_url(url: str) -> str:
    """The URL without user info nor query: credentials put in a base URL never reach an error message."""
    try:
        parsed = httpx.URL(url)
    except httpx.InvalidURL:
        return "<invalid URL>"
    return str(parsed.copy_with(userinfo=b"", query=None))


class ModelProvider(Protocol):
    #: Short identifier reported in telemetry (``ollama``, ``openai-compatible``, ``anthropic``, ``mock``).
    name: str
    model: str | None
    #: Local inference: no external API charges are reported.
    local: bool

    def complete(
        self,
        *,
        system: str,
        messages: list[Message],
        schema: dict[str, Any],
        timeout_s: float,
        max_output_tokens: int = 1024,
    ) -> ModelReply: ...
