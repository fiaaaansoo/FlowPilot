from __future__ import annotations

import json

import pytest
from conftest import TOKEN, fixture_json
from fastapi.testclient import TestClient

from flowpilot_api.app import create_app
from flowpilot_api.config import Settings
from flowpilot_api.providers.mock import MockProvider
from flowpilot_api.store import Store

AUTH = {"Authorization": f"Bearer {TOKEN}"}
EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"


def proposal(ref: str = "e2", confidence: float = 0.9) -> str:
    return json.dumps(
        {"action": "propose_target", "ref": ref, "query": "", "confidence": confidence, "reason": "synonym"}
    )


@pytest.fixture
def client() -> TestClient:
    settings = Settings(api_token=TOKEN, provider="mock", allowed_origins=(EXTENSION,), max_request_bytes=50_000)
    provider = MockProvider(responses=[proposal(), proposal()])
    return TestClient(create_app(settings, provider=provider, store=Store(":memory:")))


def test_health_is_public_but_everything_else_requires_the_token(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}
    for method, path in [
        ("get", "/v1/status"),
        ("post", "/v1/recovery/propose"),
        ("get", "/v1/memory"),
        ("get", "/v1/metrics"),
    ]:
        response = getattr(client, method)(path)
        assert response.status_code == 401
        assert response.json()["error"] == "unauthorized"
    wrong = client.get("/v1/status", headers={"Authorization": "Bearer nope"})
    assert wrong.status_code == 401


def test_status_reports_the_provider_without_secrets(client: TestClient) -> None:
    body = client.get("/v1/status", headers=AUTH).json()
    assert body == {
        "contract": "flowpilot.recovery/v1",
        "promptVersion": "recovery-v1",
        "provider": "mock",
        "model": "mock-1",
        "local": True,
        "llmEnabled": True,
    }


def test_cors_only_for_the_configured_extension(client: TestClient) -> None:
    allowed = client.options("/v1/status", headers={"Origin": EXTENSION, "Access-Control-Request-Method": "GET"})
    assert allowed.headers.get("access-control-allow-origin") == EXTENSION
    denied = client.options(
        "/v1/status", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert denied.headers.get("access-control-allow-origin") is None


def test_rejects_invalid_and_oversized_payloads(client: TestClient) -> None:
    bad = fixture_json("recovery-request.json")
    bad["observation"]["elements"][0]["ref"] = "<script>"
    response = client.post("/v1/recovery/propose", json=bad, headers=AUTH)
    assert response.status_code == 422 and response.json()["error"] == "invalid_request"

    extra = fixture_json("recovery-request.json")
    extra["execute"] = "alert(1)"
    assert client.post("/v1/recovery/propose", json=extra, headers=AUTH).status_code == 422

    huge = fixture_json("recovery-request.json")
    huge["failure"]["message"] = "x" * 60_000
    assert client.post("/v1/recovery/propose", json=huge, headers=AUTH).status_code == 413


def test_propose_then_verified_outcome_feeds_memory(client: TestClient) -> None:
    response = client.post("/v1/recovery/propose", json=fixture_json("recovery-request.json"), headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["decision"]["ref"] == "e2" and body["decision"]["strategy"] == "llm"
    recovery_id = body["recoveryId"]

    outcome = client.post(f"/v1/recovery/{recovery_id}/outcome", json=fixture_json("outcome-report.json"), headers=AUTH)
    assert outcome.json() == {"contract": "flowpilot.recovery/v1", "memorized": True}
    again = client.post(f"/v1/recovery/{recovery_id}/outcome", json=fixture_json("outcome-report.json"), headers=AUTH)
    assert again.status_code == 409

    memory = client.get("/v1/memory", headers=AUTH).json()
    assert len(memory) == 1 and memory[0]["corrected"]["name"] == "Trouver des offres"
    assert "ref" not in json.dumps(memory[0]["corrected"]) or memory[0]["corrected"]["ref"] == "e0"

    # Second run: the verified correction is reused without calling the model.
    second = client.post("/v1/recovery/propose", json=fixture_json("recovery-request.json"), headers=AUTH).json()
    assert second["decision"]["strategy"] == "memory" and second["usage"]["modelCalls"] == 0

    metrics = client.get("/v1/metrics", headers=AUTH).json()
    assert metrics["recoveries"] == 2 and metrics["verified"] == 1 and metrics["memoryReuses"] == 1

    assert client.delete(f"/v1/memory/{memory[0]['id']}", headers=AUTH).json() == {"deleted": 1}
    assert client.get("/v1/memory", headers=AUTH).json() == []


def test_outcome_cannot_inject_another_element_into_memory(client: TestClient) -> None:
    recovery_id = client.post("/v1/recovery/propose", json=fixture_json("recovery-request.json"), headers=AUTH).json()[
        "recoveryId"
    ]
    forged = fixture_json("outcome-report.json")
    forged["correctedTarget"]["name"] = "Supprimer mon compte"
    response = client.post(f"/v1/recovery/{recovery_id}/outcome", json=forged, headers=AUTH)
    assert response.status_code == 400 and response.json()["error"] == "target_mismatch"
    assert client.get("/v1/memory", headers=AUTH).json() == []


def test_failed_outcome_is_recorded_but_not_memorized(client: TestClient) -> None:
    recovery_id = client.post("/v1/recovery/propose", json=fixture_json("recovery-request.json"), headers=AUTH).json()[
        "recoveryId"
    ]
    report = fixture_json("outcome-report.json") | {"verified": False, "detail": "next step failed"}
    assert client.post(f"/v1/recovery/{recovery_id}/outcome", json=report, headers=AUTH).json()["memorized"] is False
    assert client.get("/v1/metrics", headers=AUTH).json()["incorrectOrRejected"] == 1
    assert client.post("/v1/recovery/unknown/outcome", json=report, headers=AUTH).status_code == 404
