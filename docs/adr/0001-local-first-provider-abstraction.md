# ADR 0001: Local-first, provider-independent model layer without fallback

- Status: accepted (Sprint 3)
- Date: 2026-11-21

## Context

AI recovery needs a language model only for the cases deterministic and semantic
grounding cannot settle. Users must be able to run FlowPilot at zero cost, offline,
and switch models without code changes. Paid use must never happen by accident.

## Decision

- A small `ModelProvider` protocol (`apps/api/flowpilot_api/providers/base.py`):
  one `complete(messages, schema, max_tokens, timeout)` call returning a parsed
  reply and token usage, plus typed `ProviderError(code, retryable)`.
- Implementations: `ollama` (first-class local mode), `openai-compatible`
  (llama.cpp server, vLLM, LM Studio, or a paid endpoint flagged with
  `FLOWPILOT_OPENAI_IS_PAID=1`), `anthropic` (official SDK, optional extra), and
  `mock` for tests. Selection by `FLOWPILOT_PROVIDER`; the default is `none`.
- Every provider enforces the same JSON action schema through its native
  structured-output feature; the backend re-validates every reply.
- **No fallback.** A provider error surfaces as an explicit escalation; the step
  then fails exactly as without AI. The backend never switches to another provider.
- Local providers report an estimated cost of 0 USD; paid providers use the price
  table in `pricing.py`, overridable by environment variables.
- No LangChain, LiteLLM or similar framework: three providers fit in a few hundred
  lines and keep the request, the timeout and the cost visible.

## Consequences

- Deterministic replay never depends on the backend or on a model.
- Adding a provider means one new file and one entry in `create_provider`.
- Users of a paid provider pay only after setting both the provider and its key.
- Provider-specific features (prompt caching) are used where available but are not
  required for correctness.
