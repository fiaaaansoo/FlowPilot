from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from flowpilot_api.config import Settings
from flowpilot_api.contracts import RecoveryRequest
from flowpilot_api.store import Store

CONTRACTS = Path(__file__).resolve().parents[3] / "tests" / "contracts"
TOKEN = "test-token-0123456789abcdefghij"

os.environ.setdefault("FLOWPILOT_API_TOKEN", TOKEN)


def fixture_json(name: str) -> dict[str, Any]:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def element(ref: str, name: str, *, role: str = "button", tag: str = "button", **extra: Any) -> dict[str, Any]:
    return {"ref": ref, "tag": tag, "role": role, "name": name, "attributes": extra.pop("attributes", {}), **extra}


def make_request(
    *,
    target: dict[str, Any] | None = None,
    elements: list[dict[str, Any]] | None = None,
    kind: str = "click",
    attempts: list[dict[str, Any]] | None = None,
    budget: dict[str, Any] | None = None,
    code: str = "TARGET_NOT_FOUND",
    workflow_id: str = "wf-1",
    step_id: str = "s5",
) -> RecoveryRequest:
    raw = fixture_json("recovery-request.json")
    raw["binding"]["workflowId"] = workflow_id
    raw["binding"]["stepId"] = step_id
    raw["failure"]["code"] = code
    raw["step"]["kind"] = kind
    if target is not None:
        raw["step"]["target"] = target
    if elements is not None:
        raw["observation"]["elements"] = elements
    raw["attempts"] = attempts or []
    if budget is not None:
        raw["budget"].update(budget)
    return RecoveryRequest.model_validate(raw)


@pytest.fixture
def settings() -> Settings:
    return Settings(api_token=TOKEN, provider="mock")


@pytest.fixture
def store() -> Store:
    return Store(":memory:")
