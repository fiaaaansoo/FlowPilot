"""OpenAI-compatible chat completions provider.

Covers local runtimes that expose ``/v1/chat/completions``: llama.cpp
(``llama-server``), vLLM, LM Studio, and Ollama's compatibility endpoint. A
hosted OpenAI-compatible service can also be used, but only through explicit
configuration (base URL, key and prices): nothing paid is ever selected
implicitly.

Structured output uses ``response_format: json_schema``. If the server does not
support it, the provider raises ``unsupported_capability`` instead of silently
degrading to free-form text.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import Message, ModelReply, ProviderError, ProviderUsage


class OpenAICompatibleProvider:
    name = "openai-compatible"

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str | None = None,
        local: bool = True,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not base_url:
            raise ProviderError(
                "not_configured", "FLOWPILOT_OPENAI_BASE_URL is required for the openai-compatible provider."
            )
        if not model:
            raise ProviderError(
                "model_not_configured", "FLOWPILOT_MODEL is required for the openai-compatible provider."
            )
        self.base_url = base_url.rstrip("/")
        self.model: str | None = model
        self.local = local
        self._api_key = api_key
        self._transport = transport

    def complete(
        self,
        *,
        system: str,
        messages: list[Message],
        schema: dict[str, Any],
        timeout_s: float,
        max_output_tokens: int = 1024,
    ) -> ModelReply:
        body = {
            "model": self.model,
            "temperature": 0,
            "max_tokens": max_output_tokens,
            "messages": [{"role": "system", "content": system}]
            + [{"role": m.role, "content": m.content} for m in messages],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "recovery_action", "schema": schema, "strict": True},
            },
        }
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        started = time.perf_counter()
        try:
            with httpx.Client(timeout=timeout_s, transport=self._transport) as client:
                response = client.post(f"{self.base_url}/chat/completions", json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise ProviderError(
                "timeout", f"The model server did not answer within {timeout_s:.0f} s.", retryable=True
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("unreachable", f"The model server is unreachable at {self.base_url}: {exc}") from exc

        if response.status_code in {400, 422} and "response_format" in response.text:
            raise ProviderError("unsupported_capability", "This server does not support JSON-schema structured output.")
        if response.status_code in {401, 403}:
            raise ProviderError("unauthorized", "The model server rejected the credentials.")
        if response.status_code >= 400:
            raise ProviderError(
                "http_error",
                f"The model server returned HTTP {response.status_code}: {response.text[:200]}",
                retryable=response.status_code == 429 or response.status_code >= 500,
            )

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("invalid_response", "The model server returned no message content.") from exc
        usage = data.get("usage") or {}
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
        return ModelReply(
            text=str(content),
            usage=ProviderUsage(
                input_tokens=int(usage.get("prompt_tokens") or 0),
                output_tokens=int(usage.get("completion_tokens") or 0),
                cache_read_tokens=int(cached) if cached is not None else None,
            ),
            latency_ms=int((time.perf_counter() - started) * 1000),
            model=str(data.get("model") or self.model),
        )
