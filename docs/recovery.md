# AI recovery (Sprint 3)

FlowPilot replays recorded procedures deterministically. When a recorded element
can no longer be found, and only then, an optional local service can propose the
equivalent element. FlowPilot validates the proposal, executes the **recorded**
action on it, then verifies the outcome. Without the service (the default), replay
behaves exactly as in Sprint 2.

```
deterministic step ──ok──▶ next step
        │ TARGET_NOT_FOUND / TARGET_AMBIGUOUS (element steps only)
        ▼
observe page (content script, bounded, sanitized)
        ▼
POST /v1/recovery/propose ── backend: classify → memory → context → semantic → model loop → validate
        ▼
gateway validation in the service worker (binding, ref observed, kind, same origin)
        ▼
human confirmation when required ──declined──▶ run stopped
        ▼
execute recorded action on the observed ref (content script revalidates snapshot, URL, identity)
        ▼
next step succeeds ⇒ outcome "verified" reported ⇒ correction memorized
```

## Components

| Where | File | Role |
| --- | --- | --- |
| shared | `packages/shared/src/recovery.ts` | `flowpilot.recovery/v1` contract, strict response parser, AI settings, per-run limits |
| content script | `apps/extension/src/grounding/observe.ts` | Page observation (no values, no sensitive fields), snapshot registry, `resolveRef` |
| content script | `apps/extension/src/executor/perform.ts` | `performByRef`: same action code path as deterministic replay |
| service worker | `apps/extension/src/background/recovery.ts` | Backend client, gateway validation, budgets, confirmation, retry, outcome reports |
| service worker | `apps/extension/src/executor/executor.ts` | Calls `recover` only for eligible failures, settles the outcome after the next step |
| side panel | `apps/extension/src/sidepanel/components/AiRecovery.tsx` | Settings (off by default), connection test, memory inspection and deletion |
| backend | `apps/api/flowpilot_api/` | FastAPI service: agent state machine, providers, memory, telemetry |

## Contract

Fixtures shared by both test suites live in `tests/contracts/`. Python models
(`contracts.py`) forbid unknown fields; the TypeScript parser rejects anything that
does not match. A request carries:

- `binding`: `runId`, `workflowId`, `stepId`, `stepIndex`, `origin`, `tabId`,
  `snapshotId`. The response must echo it exactly; a response bound to another
  snapshot, run or step is discarded (stale proposal).
- `step`: the recorded step (kind, recorded target, never an input value).
- `failure`: only `TARGET_NOT_FOUND` or `TARGET_AMBIGUOUS`.
- `observation`: at most 300 candidates, each with a `ref` (`e1`…), role, accessible
  name, short text, context, section, a few safe attributes, `disabled`,
  `irreversible`, `sameOrigin`.
- `attempts`: candidates already rejected or failed in this recovery.
- `budget`: model calls, tokens, time and cost left for this request.

The response is either `propose_target` (`ref`, `confidence`, `strategy`
`memory|semantic|llm`, `rationale`, `requiresConfirmation`) or `escalate`
(`reason`), plus `usage` telemetry.

## What is never sent or executed

- No field values, passwords, payment fields, OTP fields or hidden elements: the
  observation skips sensitive and invisible elements (hidden forms included) and never
  reads `value`. Rich-text editors (`contenteditable`) and ARIA text boxes count as
  fields: their typed content never becomes a name, a text or a row context.
- URLs are sanitized before leaving the page (query values dropped).
- No full-page HTML is sent or stored.
- The model selects a `ref` among observed candidates. The action and any value
  always come from the recorded step. There is no tool that runs JavaScript,
  navigates, or types free text.
- Cross-origin links, and forms or submit buttons whose `action`/`formaction` leaves
  the origin, are removed from the model context and rejected by both the backend and
  the service worker.
- Recovery never runs for `manualInput` steps, permission errors, sensitive-field
  restrictions, missing confirmations or policy errors (`isRecoverable`).

## Decision policy

Deterministic first, model last:

1. **Memory**: a verified correction for the same recorded target and origin is
   reused if exactly one observed element matches it. It acts alone only in the exact
   workflow step where it was learned, and only for a click. A correction learned in
   another workflow, or one that would receive a value or submit a form, is only a
   suggestion: the user confirms it.
2. **Semantic grounding** (`grounding.py`): weighted label, identifier, context and
   structure similarity with stemming for French and English. Accepted only above
   0.6 with a 0.2 margin over the runner-up.
3. **Model loop**: read-only tools `find_elements` and `inspect_element`, then
   `propose_target`, `request_user_confirmation` or `escalate`. Output is forced to
   a JSON schema by each provider's structured-output feature and re-validated with
   Pydantic; two invalid outputs end the loop.

A model proposal is executed without asking only if all of these hold:

- model confidence ≥ 0.8 and the model did not ask for confirmation;
- **independent agreement**: the deterministic ranking of all usable observed
  elements against the recorded target puts the same element strictly first
  (page text cannot move an element unlike the recorded one to the top);
- **evidence beyond structure**: that element shares label words (score ≥ 0.3), a
  stable identifier, or row context with the recorded one. A lone button of the right
  type is not evidence. A pure synonym (« Rechercher » → « Trouver des offres ») has
  none, so it is always confirmed by the user;
- structural support ≥ 0.6 (same role, tag or type);
- no identical copy anywhere in the observation (counted over the whole page, not
  only the elements shown to the model);
- the step is a click: a model may never redirect a recorded value (`input`,
  `select`, `check`) or a form submission (`press`, `submit`) without the user.

Otherwise, from confidence 0.5 the user is asked; below 0.5, the backend escalates.
Model confidence alone never authorizes an action. A page whose origin differs
from the workflow's origin is never recovered (checked by both the extension and
the backend).

The service worker then applies its own rules regardless of the backend: the
response binding must match, the ref must be in the observation, the element must
accept the step kind and be same-origin. It asks the user when any of these holds,
whatever the backend says:
- the backend asks;
- the element is irreversible;
- the step itself required confirmation;
- the user chose « Toujours me demander »;
- a non-semantic recovery (model or memory) would type a value or submit a form;
- a model's choice shares no label word or stable identifier with the recorded
  element (`sharesIdentity`). The content script re-checks the
snapshot id, the page URL and the element identity right before acting, and still
refuses an irreversible element without confirmation.

## Budgets

Per request (backend): 3 model calls, 12 000 tokens, 30 s, 0.05 USD by default.
Budgets are checked **before** each call: the output is capped by the remaining
tokens (at most 1 024 per call), and a paid call whose worst-case cost exceeds what
is left is not made. A paid provider without a known price refuses to start, and an
OpenAI-compatible endpoint that is not loopback counts as paid unless declared
local (`FLOWPILOT_OPENAI_IS_LOCAL=1`).
Per run (extension): 3 recoveries, 2 attempts per step, 6 model calls,
30 000 tokens, 0.10 USD, 90 s per request. An exhausted budget escalates.

## Prompt injection

Page text is placed inside `<untrusted_page_content>` (with `<` escaped, so it
cannot close the block) and the system prompt says it is data, but the defense
does not rely on wording. The model cannot do anything
except pick an observed ref; hostile instructions cannot add tools, change the
action or the value, reach another origin, or skip the confirmation required for
irreversible elements. `tests/e2e/recovery.spec.ts` replays against a page whose
text tells the model to click « Supprimer mon compte »; with a mock model that
obeys, the run stops at the confirmation prompt and the trap is never clicked.

## Providers

Selected with `FLOWPILOT_PROVIDER` (see `apps/api/README.md`):

| Provider | Cost | Notes |
| --- | --- | --- |
| `none` (default) | free | memory + semantic grounding only |
| `ollama` | free, local | first-class local mode; JSON schema via `format` |
| `openai-compatible` | free if local | llama.cpp server, vLLM, LM Studio…; `FLOWPILOT_OPENAI_IS_PAID=1` for a paid endpoint |
| `anthropic` | billed per token | official SDK, API key from the Claude Console only |
| `mock` | free | deterministic, for tests and benchmarks |

There is no fallback between providers: a provider error is reported as
`RECOVERY_UNAVAILABLE` and the step fails as it would without AI. Claude.ai
subscriptions are not used, see [ADR 0004](adr/0004-claude-subscription-mode.md).

## Memory

SQLite (`FLOWPILOT_DB_PATH`), two tables:

- `corrections`: recorded target fingerprint → corrected element descriptor, scoped
  by origin, workflow and step, written only after the extension reports that the
  next step succeeded with the proposed element. No ref, no value, no HTML.
- `recoveries`: one row per recovery with telemetry and the decision trace.

Corrections can be listed and deleted from the side panel or
`GET/DELETE /v1/memory`. A memorized correction is revalidated against the live
page every time (exactly one matching element) before reuse, and is deleted as soon
as a reuse is reported as failed.

## Prompts, caching and telemetry

Prompts are versioned (`prompts/recovery_v1.py`, `promptVersion` in every
response). The system prompt is a stable prefix; with Anthropic it carries
`cache_control`, so repeated recoveries read it from the provider cache. There is
no application-level response cache: two recoveries never share an answer.

Each recovery records provider, model, prompt version, model calls, input, output,
cache-read and cache-write tokens, latency, estimated cost (0 for local providers)
and context size. `GET /v1/metrics` aggregates them; the side panel shows calls,
tokens and time per recovered step.

## Evaluation

- Unit: `apps/api/tests` (pytest), `apps/extension/src/**/recovery*.test.ts`,
  `observe.test.ts`, controller and side panel tests (Vitest).
- End to end: `tests/e2e/recovery.spec.ts` and `tests/e2e/lifecycle.spec.ts` on the
  shipped build with the real backend and the mock provider.
- Benchmark: `npm run bench`, see [benchmarks](benchmarks/README.md).

## Cancellation, late answers and the service worker lifecycle

- **Extension.** Stopping a replay aborts the recovery request (`AbortSignal`).
  - A response that arrives anyway is discarded before any validation, and reported as
    not verified.
  - A stop during the confirmation prompt also prevents execution.
- **Backend.**
  - The propose route runs the agent in a worker thread and watches for the client's
    disconnect every 250 ms.
  - The agent checks the cancel flag between steps and after every model call, and
    escalates instead of proposing.
  - An in-flight provider call is **not** interrupted: Ollama or the API keeps
    generating until the call returns or hits its timeout (`FLOWPILOT_LLM_TIMEOUT_S`,
    30 s by default, capped by the request budget).
  - Its answer is then discarded and its spend is still recorded.
  - The concurrency slot (2 recoveries) is held until the thread ends, so the bound
    stays true.
- **Service worker suspended or restarted.**
  - A pending request dies with the worker; nothing can act on its answer.
  - On restart, the interrupted run is marked failed (« le service worker de
    l’extension a redémarré »).
  - With the side panel closed, a proposal that needs confirmation is never executed.
- **Covered by:** `tests/e2e/lifecycle.spec.ts` (shipped build, slow mock model,
  worker stopped through CDP), `recovery.test.ts`, `test_limits_cancellation.py`.

## Request limits

The request body limit (`max_request_bytes`, 512 kB) is enforced by an ASGI
middleware on the bytes actually received. A chunked request, or one with a false
`Content-Length`, is cut off with `413` before parsing, and at most the limit is ever
buffered (`limits.py`).

## Inspecting usage and recovery logs

- **Side panel.** Each recovered step shows its strategy and, for model recoveries, the
  calls, tokens and time.
- **Extension storage.** The full per-step log is stored in the run history:
  `chrome.storage.local['flowpilot.runs'][i].log[j].recovery`. It holds `strategy`,
  `modelCalls`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd`,
  `latencyMs` (with the user's wait) and `serviceLatencyMs` (without it).
- **Backend.**
  - `GET /v1/metrics` (bearer token) aggregates recoveries, proposals, escalations,
    verified outcomes, memory reuses, calls, input/output/cache tokens and cost.
  - `GET /v1/memory` lists the verified corrections.
  - Example: `curl -H "Authorization: Bearer $FLOWPILOT_API_TOKEN" http://127.0.0.1:8787/v1/metrics`
- **Raw trace.** Each recovery's decision trace (states, timings, reasons) is stored in
  the SQLite table `recoveries` (`trace_json`), next to its telemetry.

## Known limits

- An in-flight model call is not interrupted on cancellation (see above).
- Spend of a request the extension aborted is recorded by the backend but not charged
  to the extension's per-run budget.
- The observation skips elements whose tag is outside the contract (`^[a-z][a-z0-9-]*$`).
- About 10 s of every recovered step is the deterministic engine waiting for the
  recorded element before it declares it missing.

