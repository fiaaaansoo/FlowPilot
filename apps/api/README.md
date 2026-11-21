# FlowPilot recovery backend (`apps/api`)

Local FastAPI service that helps the FlowPilot extension recover a workflow step whose target element changed. It never drives the browser: it receives a bounded, sanitized observation of the page and returns a structured decision (pick one observed element, or escalate). The extension validates and executes that decision with its deterministic engine.

FlowPilot works without this backend (deterministic record and replay). Without a model, the backend still provides memory reuse and semantic grounding.

## Quick start (local model, no API key, no cost)

```bash
cd apps/api
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"      # Windows; use .venv/bin/python on Linux/macOS
cp .env.example .env
.venv/Scripts/python -m flowpilot_api token          # paste into FLOWPILOT_API_TOKEN in .env

# Optional: a local open-weight model through Ollama
ollama pull qwen2.5:3b
# in .env: FLOWPILOT_PROVIDER=ollama and FLOWPILOT_MODEL=qwen2.5:3b

.venv/Scripts/python -m flowpilot_api serve           # http://127.0.0.1:8787
```

Then, in the extension side panel: allow `http://127.0.0.1`, enable AI recovery, and paste the same token.

## Providers

| `FLOWPILOT_PROVIDER` | Runs where | Cost | Notes |
| --- | --- | --- | --- |
| `none` (default) | - | 0 | Memory + semantic grounding only. Uncertain cases escalate to the user. |
| `ollama` | local | 0 API cost | First-class. Structured output through Ollama's JSON-schema `format`. |
| `openai-compatible` | local on a loopback URL | 0 on loopback; any other URL counts as paid unless `FLOWPILOT_OPENAI_IS_LOCAL=1` | llama.cpp `llama-server`, vLLM, LM Studio. Needs `response_format: json_schema` support. |
| `anthropic` | Claude API | billed per token | Optional. `pip install -e ".[anthropic]"` and `ANTHROPIC_API_KEY` from the Claude Console. |
| `mock` | in process | 0 | Deterministic test double (`FLOWPILOT_MOCK_RULES`). |

There is no automatic fallback between providers, and no paid provider is ever selected implicitly. A paid provider whose price is unknown (not in `pricing.py` and no `FLOWPILOT_PRICE_*`) refuses to start, so the cost budget always applies. A Claude.ai subscription (Pro/Max) is not a supported way to power FlowPilot; see `docs/adr/0004-claude-subscription-mode.md`.

## API (`flowpilot.recovery/v1`)

All routes except `GET /healthz` require `Authorization: Bearer <FLOWPILOT_API_TOKEN>`.

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | Liveness, no data. |
| `GET /v1/status` | Contract id, prompt version, provider and model. |
| `POST /v1/recovery/propose` | `RecoveryRequest` → `RecoveryResponse` (decision + usage). |
| `POST /v1/recovery/{id}/outcome` | `OutcomeReport`; a verified outcome stores the correction in memory. |
| `GET /v1/memory?origin=` | Inspect memorized corrections. |
| `DELETE /v1/memory/{id}`, `DELETE /v1/memory?origin=` | Delete corrections. |
| `GET /v1/metrics` | Aggregated recoveries, tokens, cache tokens, latency, cost, memory reuse. |

Request bodies above 512 kB are rejected with `413` while they stream in. A client that disconnects (the extension stopped the replay) cancels its recovery at the next agent step; an in-flight model call still runs to completion or timeout, and its answer is discarded. Details: `docs/recovery.md`.

Schemas: `flowpilot_api/contracts.py` (Pydantic) and `packages/shared/src/recovery.ts` (TypeScript). Canonical examples: `tests/contracts/*.json`.

## Development

```bash
.venv/Scripts/python -m pytest
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
```

All tests run offline with the mock provider; none calls a paid API.
