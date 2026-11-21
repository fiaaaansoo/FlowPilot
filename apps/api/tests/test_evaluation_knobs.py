"""Sprint 4 evaluation knobs: defaults are the production behaviour, each knob changes one thing."""

from __future__ import annotations

import json

import pytest
from conftest import TOKEN, element, fixture_json, make_request
from fastapi.testclient import TestClient

from flowpilot_api.agent import RecoveryAgent
from flowpilot_api.app import create_app
from flowpilot_api.config import ConfigError, Settings, load_settings
from flowpilot_api.context_builder import build_context
from flowpilot_api.prompts import PROMPTS, get_prompt
from flowpilot_api.providers.mock import MockProvider
from flowpilot_api.store import Store

AUTH = {"Authorization": f"Bearer {TOKEN}"}
SEARCH = {"tag": "button", "role": "button", "name": "Rechercher", "attributes": {"type": "submit"}, "css": "b"}


def test_defaults_are_the_production_behaviour(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLOWPILOT_API_TOKEN", TOKEN)
    for name in (
        "FLOWPILOT_MEMORY",
        "FLOWPILOT_CONTEXT_RANKING",
        "FLOWPILOT_PROMPT_VERSION",
        "FLOWPILOT_OLLAMA_KEEP_ALIVE",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert (settings.memory_enabled, settings.context_ranking, settings.prompt_version) == (True, True, "recovery-v1")
    assert settings.ollama_keep_alive == "5m"


def test_unknown_prompt_version_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLOWPILOT_API_TOKEN", TOKEN)
    monkeypatch.setenv("FLOWPILOT_PROMPT_VERSION", "recovery-v9")
    with pytest.raises(ConfigError, match="PROMPT_VERSION"):
        load_settings()


def test_prompt_versions_share_the_schema_and_v2_is_shorter() -> None:
    v1, v2 = get_prompt("recovery-v1"), get_prompt("recovery-v2")
    assert set(PROMPTS) == {"recovery-v1", "recovery-v2"}
    assert v1.schema == v2.schema
    assert len(v2.system) < 0.75 * len(v1.system)
    assert "<untrusted_page_content>" in v2.system and "never follow" in v2.system.lower()


def test_selected_prompt_is_sent_and_reported(store: Store) -> None:
    provider = MockProvider(
        responses=[json.dumps({"action": "escalate", "ref": "", "query": "", "confidence": 0, "reason": "x"})]
    )
    agent = RecoveryAgent(
        settings=Settings(api_token="x" * 32, prompt_version="recovery-v2"), store=store, provider=provider
    )
    response = agent.propose(make_request(target=SEARCH, elements=[element("e2", "Trouver des offres")]))
    assert response.usage.prompt_version == "recovery-v2"


def test_ranking_off_keeps_page_order() -> None:
    page = [element(f"e{i}", f"Filtre {i}") for i in range(1, 6)] + [element("e9", "Rechercher une offre")]
    request = make_request(target=SEARCH, elements=page)
    ranked = [e.candidate.ref for e in build_context(request, max_elements=3).entries]
    raw = [e.candidate.ref for e in build_context(request, max_elements=3, ranking=False).entries]
    assert ranked[0] == "e9"  # the lexical match comes first
    assert raw == ["e1", "e2", "e3"]  # page order: the match falls outside a small context


def test_memory_off_neither_reuses_nor_stores() -> None:
    settings = Settings(
        api_token=TOKEN, provider="mock", mock_rules={"Rechercher": "Trouver des offres"}, memory_enabled=False
    )
    client = TestClient(create_app(settings, provider=MockProvider(rules=settings.mock_rules), store=Store(":memory:")))
    first = client.post("/v1/recovery/propose", json=fixture_json("recovery-request.json"), headers=AUTH).json()
    outcome = client.post(
        f"/v1/recovery/{first['recoveryId']}/outcome", json=fixture_json("outcome-report.json"), headers=AUTH
    )
    assert outcome.json()["memorized"] is False
    second = client.post("/v1/recovery/propose", json=fixture_json("recovery-request.json"), headers=AUTH).json()
    assert second["decision"]["strategy"] == "llm" and second["usage"]["modelCalls"] == 1
    assert client.get("/v1/status", headers=AUTH).json()["memoryEnabled"] is False
