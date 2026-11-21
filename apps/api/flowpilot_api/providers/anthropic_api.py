"""Optional Claude API provider (paid, separately authorized API credentials).

* Authentication: the official ``anthropic`` SDK resolves credentials from the
  environment (``ANTHROPIC_API_KEY`` from the Claude Console, or a profile).
  A Claude.ai subscription login is *not* a supported way to power FlowPilot
  (see ``docs/adr/0004-claude-subscription-mode.md``).
* Structured output: ``output_config.format`` with the action JSON schema
  (forced ``tool_choice`` is rejected by current models).
* Prompt caching: the stable system prompt carries ``cache_control``; cache
  read/write tokens are reported from ``usage``. Very short prefixes may be
  below the model's minimum cacheable size, in which case both stay at 0.
* No server-side refusal fallback is enabled: FlowPilot never switches model
  silently. A refusal is reported as an error and the agent escalates.

Install with ``pip install -e ".[anthropic]"``. The SDK is imported lazily so
that the backend runs without it when this provider is not selected.
"""

from __future__ import annotations

import time
from typing import Any

from .base import Message, ModelReply, ProviderError, ProviderUsage

DEFAULT_MODEL = "claude-opus-5-5"


class AnthropicProvider:
    name = "anthropic"
    local = False

    def __init__(
        self, *, model: str | None, effort: str = "medium", max_tokens: int = 16_000, client: Any | None = None
    ) -> None:
        self.model: str | None = model or DEFAULT_MODEL
        self.effort = effort
        self.max_tokens = max_tokens
        if client is None:
            try:
                import anthropic
            except ImportError as exc:
                raise ProviderError(
                    "not_installed", 'The Anthropic provider needs the SDK: pip install -e ".[anthropic]".'
                ) from exc
            client = anthropic.Anthropic(max_retries=0)  # retries are owned by the agent's budget
        self._client = client

    def complete(self, *, system: str, messages: list[Message], schema: dict[str, Any], timeout_s: float) -> ModelReply:
        import anthropic

        started = time.perf_counter()
        try:
            response = self._client.with_options(timeout=timeout_s).messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": m.role, "content": m.content} for m in messages],
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
            )
        except anthropic.AuthenticationError as exc:
            raise ProviderError("unauthorized", "The Claude API rejected the API key.") from exc
        except anthropic.NotFoundError as exc:
            raise ProviderError("model_not_found", f"Unknown Claude model {self.model!r}.") from exc
        except anthropic.BadRequestError as exc:
            raise ProviderError("bad_request", f"The Claude API rejected the request: {exc.message}") from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError("rate_limited", "The Claude API rate limit was reached.", retryable=True) from exc
        except anthropic.APITimeoutError as exc:
            raise ProviderError(
                "timeout", f"The Claude API did not answer within {timeout_s:.0f} s.", retryable=True
            ) from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(
                "http_error", f"The Claude API returned HTTP {exc.status_code}.", retryable=exc.status_code >= 500
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("unreachable", "The Claude API is unreachable.", retryable=True) from exc

        if response.stop_reason == "refusal":
            raise ProviderError("refusal", "The model declined the request.")
        if response.stop_reason == "max_tokens":
            raise ProviderError("truncated", "The model output was truncated (max_tokens).")
        text = next((block.text for block in response.content if block.type == "text"), None)
        if text is None:
            raise ProviderError("invalid_response", "The Claude API returned no text block.")
        usage = response.usage
        return ModelReply(
            text=text,
            usage=ProviderUsage(
                input_tokens=int(usage.input_tokens or 0),
                output_tokens=int(usage.output_tokens or 0),
                cache_read_tokens=int(getattr(usage, "cache_read_input_tokens", 0) or 0),
                cache_write_tokens=int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
            ),
            latency_ms=int((time.perf_counter() - started) * 1000),
            model=str(response.model),
        )
