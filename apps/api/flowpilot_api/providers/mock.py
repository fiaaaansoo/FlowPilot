"""Deterministic mock provider for automated tests (no network, no cost).

Two ways to script it:

* ``responses``: a fixed list of raw replies, returned in order (unit tests can
  feed invalid JSON, wrong refs, injections...).
* ``rules``: mapping from the *recorded* target label to the label of the element
  to propose. The mock reads the element list from the last user message and
  answers with that element's ``ref`` (end-to-end tests do not know refs in
  advance). Without a matching rule it escalates.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

from .base import Message, ModelReply, ProviderError, ProviderUsage

_UNTRUSTED = re.compile(r"<untrusted_page_content>\s*(.*?)\s*</untrusted_page_content>", re.DOTALL)
_TASK = re.compile(r"<task>\s*(.*?)\s*</task>", re.DOTALL)


class MockProvider:
    name = "mock"
    local = True

    def __init__(
        self,
        *,
        responses: Sequence[str | ProviderError] | None = None,
        rules: dict[str, str] | None = None,
        confidence: float = 0.9,
        model: str = "mock-1",
    ) -> None:
        self.model: str | None = model
        self._responses = list(responses or [])
        self._rules = {key.casefold(): value for key, value in (rules or {}).items()}
        self._confidence = confidence
        self.calls: list[list[Message]] = []

    def complete(self, *, system: str, messages: list[Message], schema: dict[str, Any], timeout_s: float) -> ModelReply:
        self.calls.append(list(messages))
        usage = ProviderUsage(input_tokens=len(system + "".join(m.content for m in messages)) // 4, output_tokens=40)
        if self._responses:
            reply = self._responses.pop(0)
            if isinstance(reply, ProviderError):
                raise reply
            return ModelReply(text=reply, usage=usage, latency_ms=1, model=self.model)
        return ModelReply(text=json.dumps(self._apply_rules(messages)), usage=usage, latency_ms=1, model=self.model)

    def _apply_rules(self, messages: list[Message]) -> dict[str, Any]:
        first = messages[0].content
        task_match, page_match = _TASK.search(first), _UNTRUSTED.search(first)
        if not task_match or not page_match:
            return _action("escalate", reason="mock: unexpected prompt layout")
        recorded = json.loads(task_match.group(1)).get("recordedTarget", {})
        label = str(recorded.get("name") or recorded.get("text") or "").casefold()
        wanted = self._rules.get(label)
        if wanted is None:
            return _action("escalate", reason="mock: no rule for this target")
        for element in json.loads(page_match.group(1)).get("elements", []):
            if str(element.get("name") or element.get("text") or "").casefold() == wanted.casefold():
                return _action("propose_target", ref=element["ref"], confidence=self._confidence, reason="mock rule")
        return _action("escalate", reason="mock: rule target not on the page")


def _action(
    action: str, *, ref: str = "", confidence: float = 0.0, reason: str = "", query: str = ""
) -> dict[str, Any]:
    return {"action": action, "ref": ref, "query": query, "confidence": confidence, "reason": reason}
