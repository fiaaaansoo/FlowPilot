"""Model providers. Selection is explicit (``FLOWPILOT_PROVIDER``); there is no automatic fallback."""

from __future__ import annotations

from ..config import Settings
from .base import Message, ModelProvider, ModelReply, ProviderError, ProviderUsage

__all__ = ["Message", "ModelProvider", "ModelReply", "ProviderError", "ProviderUsage", "create_provider"]


def create_provider(settings: Settings) -> ModelProvider | None:
    """Build the configured provider, or ``None`` when AI recovery runs without a model."""
    if settings.provider == "none":
        return None
    if settings.provider == "ollama":
        from .ollama import OllamaProvider

        return OllamaProvider(base_url=settings.ollama_url, model=settings.model or "", num_ctx=settings.ollama_num_ctx)
    if settings.provider == "openai-compatible":
        from .openai_compat import OpenAICompatibleProvider

        return OpenAICompatibleProvider(
            base_url=settings.openai_base_url or "",
            model=settings.model or "",
            api_key=settings.openai_api_key,
            local=settings.openai_is_local,
        )
    if settings.provider == "anthropic":
        from .anthropic_api import AnthropicProvider

        return AnthropicProvider(model=settings.model, effort=settings.anthropic_effort)
    if settings.provider == "mock":
        from .mock import MockProvider

        return MockProvider(rules=settings.mock_rules)
    raise ProviderError("not_configured", f"Unknown provider {settings.provider!r}")
