from __future__ import annotations

import asyncio
import json
import threading
from typing import Any

import pytest
from conftest import element, make_request

from flowpilot_api.agent import RecoveryAgent
from flowpilot_api.app import watch_disconnect
from flowpilot_api.config import Settings
from flowpilot_api.contracts import Escalate
from flowpilot_api.limits import BodyLimitMiddleware
from flowpilot_api.providers import Message, ModelReply
from flowpilot_api.providers.mock import MockProvider
from flowpilot_api.store import Store

SEARCH = {"tag": "button", "role": "button", "name": "Rechercher", "attributes": {"type": "submit"}, "css": "b"}
PAGE = [element("e2", "Trouver des offres", attributes={"type": "submit"})]
PROPOSE = json.dumps({"action": "propose_target", "ref": "e2", "query": "", "confidence": 0.9, "reason": "synonym"})


# --- request body limit, enforced on the bytes actually received ------------------------


async def _run_limited(chunks: list[bytes], headers: list[tuple[bytes, bytes]]) -> tuple[list[dict[str, Any]], bool]:
    reached = False

    async def app(_scope: Any, receive: Any, _send: Any) -> None:
        nonlocal reached
        reached = True
        await receive()

    messages = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1} for i, c in enumerate(chunks)]
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {"type": "http", "method": "POST", "headers": headers}
    await BodyLimitMiddleware(app, max_bytes=100)(scope, receive, send)
    return sent, reached


@pytest.mark.parametrize(
    "headers",
    [[], [(b"content-length", b"10")]],
    ids=["chunked-without-content-length", "understated-content-length"],
)
def test_oversized_body_is_rejected_while_streaming(headers: list[tuple[bytes, bytes]]) -> None:
    sent, reached = asyncio.run(_run_limited([b"x" * 60, b"x" * 60, b"x" * 60], headers))
    assert sent[0]["status"] == 413
    assert json.loads(sent[1]["body"])["error"] == "payload_too_large"
    assert reached is False  # the application never sees the body


def test_body_within_the_limit_is_replayed_intact() -> None:
    received: list[bytes] = []

    async def scenario() -> None:
        async def app(_scope: Any, receive: Any, _send: Any) -> None:
            received.append((await receive())["body"])

        chunks = [{"type": "http.request", "body": b"ab", "more_body": True}, {"type": "http.request", "body": b"cd"}]

        async def receive() -> dict[str, Any]:
            return chunks.pop(0)

        async def send(_message: dict[str, Any]) -> None:
            return None

        await BodyLimitMiddleware(app, max_bytes=100)({"type": "http", "method": "POST", "headers": []}, receive, send)

    asyncio.run(scenario())
    assert received == [b"abcd"]


def test_declared_oversize_is_rejected_without_reading() -> None:
    sent, reached = asyncio.run(_run_limited([b"x"], [(b"content-length", b"5000")]))
    assert sent[0]["status"] == 413 and reached is False


# --- cooperative cancellation -----------------------------------------------------------------


def _agent(store: Store, provider: MockProvider) -> RecoveryAgent:
    return RecoveryAgent(settings=Settings(api_token="x" * 32, provider="mock"), store=store, provider=provider)


def test_cancelled_before_the_model_call_makes_no_call(store: Store) -> None:
    provider = MockProvider(responses=[PROPOSE])
    cancel = threading.Event()
    cancel.set()
    decision = _agent(store, provider).propose(make_request(target=SEARCH, elements=PAGE), cancel=cancel).decision
    assert isinstance(decision, Escalate) and "cancelled" in decision.reason
    assert provider.calls == []


def test_answer_arriving_after_cancellation_is_discarded(store: Store) -> None:
    cancel = threading.Event()

    class SlowThenCancelled(MockProvider):
        def complete(self, **kwargs: Any) -> ModelReply:
            reply = super().complete(**kwargs)
            cancel.set()  # the client left while the model was answering
            return reply

    provider = SlowThenCancelled(responses=[PROPOSE])
    response = _agent(store, provider).propose(make_request(target=SEARCH, elements=PAGE), cancel=cancel)
    assert isinstance(response.decision, Escalate) and "cancelled" in response.decision.reason
    assert response.usage.model_calls == 1  # the spend is still accounted for


def test_disconnect_watcher_sets_the_cancel_flag() -> None:
    class Request:
        def __init__(self) -> None:
            self.polls = 0

        async def is_disconnected(self) -> bool:
            self.polls += 1
            return self.polls >= 3

    cancel = threading.Event()
    asyncio.run(watch_disconnect(Request(), cancel, interval_s=0))  # type: ignore[arg-type]
    assert cancel.is_set()


def test_mock_delay_is_bounded_by_the_call_timeout() -> None:
    provider = MockProvider(responses=[PROPOSE], delay_s=30)
    reply = provider.complete(system="s", messages=[Message("user", "u")], schema={}, timeout_s=0.01)
    assert reply.text == PROPOSE
