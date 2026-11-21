from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from conftest import CONTRACTS, TOKEN, fixture_json

from flowpilot_api.config import ConfigError, Settings, load_settings
from flowpilot_api.contracts import OutcomeReport, RecoveryRequest, RecoveryResponse
from flowpilot_api.pricing import estimate_cost
from flowpilot_api.prompts import ACTION_SCHEMA, SYSTEM_PROMPT
from flowpilot_api.providers import Message, ProviderError, create_provider
from flowpilot_api.providers.anthropic_api import AnthropicProvider
from flowpilot_api.providers.ollama import OllamaProvider
from flowpilot_api.providers.openai_compat import OpenAICompatibleProvider

MESSAGES = [Message("user", "hello")]


# --- contract fixtures shared with TypeScript ---------------------------------------


def test_shared_contract_fixtures_validate() -> None:
    assert sorted(p.name for p in CONTRACTS.glob("*.json")) == [
        "outcome-report.json",
        "recovery-request.json",
        "recovery-response-escalate.json",
        "recovery-response-propose.json",
    ]
    RecoveryRequest.model_validate(fixture_json("recovery-request.json"))
    OutcomeReport.model_validate(fixture_json("outcome-report.json"))
    for name in ("recovery-response-propose.json", "recovery-response-escalate.json"):
        raw = fixture_json(name)
        assert RecoveryResponse.model_validate(raw).model_dump(by_alias=True, mode="json") == raw


# --- Ollama --------------------------------------------------------------------------


def ollama(handler) -> OllamaProvider:  # type: ignore[no-untyped-def]
    return OllamaProvider(base_url="http://ollama", model="qwen2.5:3b", transport=httpx.MockTransport(handler))


def test_ollama_sends_schema_and_reports_usage() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(
            200, json={"message": {"content": '{"action":"escalate"}'}, "prompt_eval_count": 321, "eval_count": 12}
        )

    reply = ollama(handler).complete(system=SYSTEM_PROMPT, messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=5)
    assert seen["format"] == ACTION_SCHEMA and seen["options"]["temperature"] == 0 and seen["stream"] is False
    assert seen["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert (reply.usage.input_tokens, reply.usage.output_tokens, reply.usage.cache_read_tokens) == (321, 12, None)


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [(404, "model_not_found", False), (500, "http_error", True), (400, "http_error", False)],
)
def test_ollama_errors_are_explicit(status: int, code: str, retryable: bool) -> None:
    provider = ollama(lambda _r: httpx.Response(status, text="boom"))
    with pytest.raises(ProviderError) as error:
        provider.complete(system="s", messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=5)
    assert (error.value.code, error.value.retryable) == (code, retryable)


def test_ollama_unreachable_and_unconfigured() -> None:
    def refuse(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderError) as error:
        ollama(refuse).complete(system="s", messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=5)
    assert error.value.code == "unreachable"
    with pytest.raises(ProviderError):
        OllamaProvider(base_url="http://ollama", model="")


def test_provider_errors_never_echo_url_credentials() -> None:
    def refuse(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    provider = OllamaProvider(
        base_url="http://user:s3cr3t@ollama:11434", model="qwen2.5:3b", transport=httpx.MockTransport(refuse)
    )
    with pytest.raises(ProviderError) as error:
        provider.complete(system="s", messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=5)
    assert "s3cr3t" not in str(error.value)
    assert "ollama:11434" in str(error.value)


# --- OpenAI-compatible (llama.cpp, vLLM, LM Studio) ----------------------------------


def test_openai_compatible_uses_json_schema_and_cached_tokens() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={
                "model": "llama-3.2-3b",
                "choices": [{"message": {"content": '{"action":"escalate"}'}}],
                "usage": {
                    "prompt_tokens": 500,
                    "completion_tokens": 9,
                    "prompt_tokens_details": {"cached_tokens": 384},
                },
            },
        )

    provider = OpenAICompatibleProvider(
        base_url="http://llama:8080/v1", model="llama-3.2-3b", transport=httpx.MockTransport(handler)
    )
    reply = provider.complete(system="s", messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=5)
    assert seen["response_format"]["json_schema"]["schema"] == ACTION_SCHEMA and seen["auth"] is None
    assert (reply.usage.input_tokens, reply.usage.cache_read_tokens, provider.local) == (500, 384, True)


def test_openai_compatible_reports_unsupported_structured_output() -> None:
    provider = OpenAICompatibleProvider(
        base_url="http://old/v1",
        model="m",
        transport=httpx.MockTransport(lambda _r: httpx.Response(400, text="unknown field response_format")),
    )
    with pytest.raises(ProviderError) as error:
        provider.complete(system="s", messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=5)
    assert error.value.code == "unsupported_capability"


# --- Anthropic (optional, paid) ------------------------------------------------------


class _FakeMessages:
    def __init__(self, response: Any) -> None:
        self.response = response
        self.kwargs: dict[str, Any] = {}

    def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        return self.response


class _FakeClient:
    def __init__(self, response: Any) -> None:
        self.messages = _FakeMessages(response)

    def with_options(self, **_kwargs: Any) -> _FakeClient:
        return self


def _claude_response(stop_reason: str = "end_turn") -> Any:
    return SimpleNamespace(
        stop_reason=stop_reason,
        model="claude-opus-5-5",
        content=[SimpleNamespace(type="text", text='{"action":"escalate"}')],
        usage=SimpleNamespace(
            input_tokens=200, output_tokens=30, cache_read_input_tokens=1500, cache_creation_input_tokens=0
        ),
    )


def test_anthropic_uses_structured_output_and_caches_the_stable_prefix() -> None:
    client = _FakeClient(_claude_response())
    provider = AnthropicProvider(model=None, client=client)
    reply = provider.complete(system=SYSTEM_PROMPT, messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=10)
    kwargs = client.messages.kwargs
    assert kwargs["model"] == "claude-opus-5-5"
    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}
    # The task and page context (first user message) is cached across tool turns of one recovery.
    assert kwargs["messages"][0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert kwargs["max_tokens"] == 1024  # output bounded by the agent's budget, not a fixed 16k
    assert kwargs["output_config"]["format"] == {"type": "json_schema", "schema": ACTION_SCHEMA}
    assert "tool_choice" not in kwargs and "fallbacks" not in kwargs  # no forced tools, no silent model switch
    assert (reply.usage.cache_read_tokens, reply.usage.cache_write_tokens) == (1500, 0)
    assert provider.local is False


@pytest.mark.parametrize(("stop", "code"), [("refusal", "refusal"), ("max_tokens", "truncated")])
def test_anthropic_refusal_and_truncation_are_errors(stop: str, code: str) -> None:
    provider = AnthropicProvider(model="claude-opus-5-5", client=_FakeClient(_claude_response(stop)))
    with pytest.raises(ProviderError) as error:
        provider.complete(system="s", messages=MESSAGES, schema=ACTION_SCHEMA, timeout_s=10)
    assert error.value.code == code


# --- pricing and configuration -------------------------------------------------------


def test_local_inference_reports_zero_api_cost() -> None:
    assert (
        estimate_cost(
            provider_local=True,
            model="claude-opus-5-5",
            input_tokens=10**6,
            output_tokens=10**6,
            cache_read_tokens=None,
            cache_write_tokens=None,
        )
        == 0.0
    )
    paid = estimate_cost(
        provider_local=False,
        model="claude-opus-5-5",
        input_tokens=1_000,
        output_tokens=100,
        cache_read_tokens=10_000,
        cache_write_tokens=0,
    )
    assert paid == pytest.approx((1_000 * 4 + 100 * 20 + 10_000 * 0.2) / 1_000_000)


def test_configuration_is_explicit_and_safe(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("FLOWPILOT_API_TOKEN", raising=False)
    with pytest.raises(ConfigError, match="FLOWPILOT_API_TOKEN"):
        load_settings()
    monkeypatch.setenv("FLOWPILOT_API_TOKEN", TOKEN)
    assert load_settings().provider == "none"  # no model, and certainly no paid one, by default

    monkeypatch.setenv("FLOWPILOT_HOST", "0.0.0.0")  # noqa: S104 - testing the refusal
    with pytest.raises(ConfigError, match="non-loopback"):
        load_settings()
    monkeypatch.setenv("FLOWPILOT_HOST", "127.0.0.1")
    monkeypatch.setenv("FLOWPILOT_PROVIDER", "gpt-magic")
    with pytest.raises(ConfigError, match="FLOWPILOT_PROVIDER"):
        load_settings()

    monkeypatch.setenv("FLOWPILOT_PROVIDER", "mock")
    monkeypatch.setenv("FLOWPILOT_MOCK_RULES", "Rechercher=>Trouver des offres")
    settings = load_settings()
    assert settings.mock_rules == {"Rechercher": "Trouver des offres"}
    assert create_provider(settings) is not None
    assert create_provider(Settings(api_token=TOKEN)) is None


def test_dotenv_file_does_not_override_the_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("FLOWPILOT_PORT=9999\nFLOWPILOT_API_TOKEN=from-file-xxxxxxxxxxxxxxxxxxxx\n", encoding="utf-8")
    monkeypatch.setenv("FLOWPILOT_API_TOKEN", TOKEN)
    monkeypatch.delenv("FLOWPILOT_PORT", raising=False)
    settings = load_settings(env)
    assert settings.port == 9999 and settings.api_token == TOKEN


def test_paid_providers_need_a_known_price(monkeypatch: pytest.MonkeyPatch) -> None:
    for suffix in ("MODEL", "OPENAI_BASE_URL", "OPENAI_IS_PAID", "OPENAI_IS_LOCAL", "PRICE_INPUT_PER_MTOK"):
        monkeypatch.delenv(f"FLOWPILOT_{suffix}", raising=False)
    monkeypatch.delenv("FLOWPILOT_PRICE_OUTPUT_PER_MTOK", raising=False)
    monkeypatch.setenv("FLOWPILOT_API_TOKEN", TOKEN)

    monkeypatch.setenv("FLOWPILOT_PROVIDER", "anthropic")
    assert load_settings().provider == "anthropic"  # default model has a published price
    monkeypatch.setenv("FLOWPILOT_MODEL", "claude-unknown-9")
    with pytest.raises(ConfigError, match="No price"):
        load_settings()

    monkeypatch.setenv("FLOWPILOT_PROVIDER", "openai-compatible")
    monkeypatch.setenv("FLOWPILOT_MODEL", "some-model")
    monkeypatch.setenv("FLOWPILOT_OPENAI_BASE_URL", "http://127.0.0.1:8080/v1")
    assert load_settings().openai_is_local is True
    monkeypatch.setenv("FLOWPILOT_OPENAI_BASE_URL", "https://api.example.com/v1")
    with pytest.raises(ConfigError, match="No price"):  # remote endpoint = paid unless declared local
        load_settings()
    monkeypatch.setenv("FLOWPILOT_PRICE_INPUT_PER_MTOK", "1")
    monkeypatch.setenv("FLOWPILOT_PRICE_OUTPUT_PER_MTOK", "2")
    assert load_settings().openai_is_local is False
