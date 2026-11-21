"""Estimated external API cost of a recovery.

Local inference (Ollama, local OpenAI-compatible servers, mock) reports **0 USD
of API charges**. That is not "free": it consumes local hardware and
electricity, which FlowPilot does not measure.

Built-in prices are USD per million tokens for the Claude API, from Anthropic's
published price list (snapshot 2026-11). Always verify current prices; override
them with FLOWPILOT_PRICE_INPUT_PER_MTOK / FLOWPILOT_PRICE_OUTPUT_PER_MTOK.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Price:
    input: float
    output: float
    cache_read: float
    cache_write: float


#: Cache writes are billed at 1.25x input (5-minute TTL), cache reads at 0.1x input unless published otherwise.
CLAUDE_PRICES: dict[str, Price] = {
    "claude-opus-5-5": Price(4.00, 20.00, 0.20, 5.00),
    "claude-sonnet-5-5": Price(2.00, 10.00, 0.10, 2.50),
    "claude-haiku-5-5": Price(0.10, 0.50, 0.01, 0.125),
}


def estimate_cost(
    *,
    provider_local: bool,
    model: str | None,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int | None,
    cache_write_tokens: int | None,
    override_input: float | None = None,
    override_output: float | None = None,
) -> float:
    if provider_local:
        return 0.0
    price = CLAUDE_PRICES.get(model or "")
    if override_input is not None or override_output is not None:
        base = price or Price(0, 0, 0, 0)
        price = Price(
            override_input if override_input is not None else base.input,
            override_output if override_output is not None else base.output,
            (override_input if override_input is not None else base.input) * 0.1,
            (override_input if override_input is not None else base.input) * 1.25,
        )
    if price is None:
        return 0.0
    total = (
        input_tokens * price.input
        + output_tokens * price.output
        + (cache_read_tokens or 0) * price.cache_read
        + (cache_write_tokens or 0) * price.cache_write
    )
    return round(total / 1_000_000, 6)
