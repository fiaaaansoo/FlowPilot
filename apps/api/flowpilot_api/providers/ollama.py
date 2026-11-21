"""Ollama provider (local, free, offline once the model is installed).

Uses the native ``/api/chat`` endpoint with ``format`` set to the JSON schema,
which Ollama enforces through constrained decoding. Temperature is 0 so that
model comparisons are reproducible.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import Message, ModelReply, ProviderError, ProviderUsage, chat_messages, post_json


class OllamaProvider:
    name = "ollama"
    local = True

    def __init__(
        self, *, base_url: str, model: str, num_ctx: int = 4096, transport: httpx.BaseTransport | None = None
    ) -> None:
        if not model:
            raise ProviderError("model_not_configured", "FLOWPILOT_MODEL must name an installed Ollama model.")
        self.base_url = base_url.rstrip("/")
        self.model: str | None = model
        self.num_ctx = num_ctx
        self._client = httpx.Client(transport=transport)  # reused: one connection for all calls

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
            "stream": False,
            "format": schema,
            "options": {"temperature": 0, "num_ctx": self.num_ctx, "num_predict": max_output_tokens},
            "messages": chat_messages(system, messages),
        }
        started = time.perf_counter()
        response = post_json(self._client, f"{self.base_url}/api/chat", body, timeout_s=timeout_s, service="Ollama")

        if response.status_code == 404:
            raise ProviderError(
                "model_not_found", f"Model {self.model!r} is not installed (run `ollama pull {self.model}`)."
            )
        if response.status_code >= 400:
            raise ProviderError(
                "http_error",
                f"Ollama returned HTTP {response.status_code}: {response.text[:200]}",
                retryable=response.status_code >= 500,
            )
        data = response.json()
        content = (data.get("message") or {}).get("content")
        if not isinstance(content, str):
            raise ProviderError("invalid_response", "Ollama returned no message content.")
        return ModelReply(
            text=content,
            usage=ProviderUsage(
                input_tokens=int(data.get("prompt_eval_count") or 0),
                output_tokens=int(data.get("eval_count") or 0),
            ),
            latency_ms=int((time.perf_counter() - started) * 1000),
            model=self.model,
        )
