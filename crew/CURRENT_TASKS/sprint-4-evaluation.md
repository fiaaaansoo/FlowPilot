# Sprint 4 — Reproducible evaluation and optimization

Why: Sprint 3 proved the recovery pipeline is safe (0 incorrect actions) on one small demo, with one local model and single-sample cells. Sprint 4 turns this into a reproducible, statistically meaningful evaluation, and uses it to tune context, prompts and inference without weakening the confirmation policy.

Zone : `apps/demo-site/`, `apps/api/`, `apps/extension/src/`, `packages/evaluation/`, `packages/shared/`, `tests/`, `docs/`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `playwright.benchmark.config.ts`, `.gitignore`, `.github/`

Depends on: `sprint-3-validation.md` (paused, awaiting merge of PRs #1 and #2). Branch `feat/sprint-4-evaluation`, stacked on `feat/sprint-3-agentic-recovery`.

Starting point (Sprint 3 handoff):
- benchmark harness: `tests/benchmark/benchmark.spec.ts`;
- method: `docs/benchmarks/README.md`;
- baseline: run `s3-final`, raw data in `docs/benchmarks/results/`;
- telemetry: `StepLog.recovery`, including `serviceLatencyMs`, and `GET /v1/metrics`.

Hard rules carried over:
- never weaken the confirmation policy to improve a score;
- no paid API without the owner's explicit approval;
- run benchmarks one mode per process on this 16 GB machine.

Tasks are listed in priority order. Complexity: S < 1 day, M 1–3 days, L > 3 days.

- [x] **P1 · Evaluation dataset as data (M).** Move variants, workflows and expected elements out of the spec into versioned scenario files (`tests/benchmark/scenarios/*.json`): page mutation, recorded workflow, expected element or expected refusal.
  - Depends on: nothing.
  - Accept when:
    - the existing 9 variants are reproduced from data and give the same verdicts as `s3-final`;
    - a scenario is added without code changes;
    - the scenario schema is validated at load.
- [x] **P2 · Expanded mutation scenarios (L).** At least 40 scenarios on 3+ page types (search form, results list, settings/destructive page, multi-step form).
  - Cover:
    - label rewording and synonyms in FR/EN;
    - moved, wrapped or reordered elements;
    - duplicated rows with and without distinguishing context;
    - icon-only buttons;
    - disabled and hidden decoys;
    - dialogs (« OK », « Oui »);
    - destructive look-alikes;
    - prompt injection in text, `aria-label`, `title` and `alt`;
    - cross-origin form targets;
    - rich-text fields.
  - Depends on: P1.
  - Accept when:
    - each scenario documents its expected verdict;
    - the deterministic baseline runs on all of them;
    - at least 25% of the scenarios expect a refusal or a confirmation.
- [x] **P3 · Statistical protocol and reporting (M).** Repeated runs with seeds and fixed configurations; Wilson confidence intervals for success, autonomy and refusal rates; latency percentiles (p50/p95/p99) when n ≥ 20; a run manifest with git SHA, model digest, Ollama version, prompt version, context limits and hardware.
  - Depends on: P1.
  - Accept when:
    - a report states n and the confidence interval for every rate;
    - two runs of the same manifest give identical verdicts with a temperature-0 model;
    - the method doc is updated.
- [x] **P4 · Model comparison, local first (M).** Same scenarios on at least 3 local models through Ollama (e.g. qwen2.5:3b, qwen2.5:7b, llama3.2:3b) and one OpenAI-compatible runtime (llama.cpp or vLLM).
  - Optional: one Anthropic model, only after explicit approval and with a cost cap.
  - Depends on: P2, P3.
  - Accept when, per model:
    - the correct-proposal rate is reported, separate from the policy outcome;
    - the incorrect-action rate is reported (target 0);
    - service latency, tokens and peak memory are reported;
    - memory is measured one model at a time and the model is unloaded between runs.
- [x] **P5 · Context engineering comparisons (M).** Vary the max elements (6/12/24/80), the ranking on or off, deduplication, and the context or section fields; measure accuracy, tokens and latency on the noisy and injection scenarios.
  - Depends on: P2, P3.
  - Accept when:
    - a documented recommendation for the default context size is backed by the data;
    - there is a context-rot curve (accuracy and tokens versus context size).
- [x] **P6 · Memory effectiveness (S).** Measure reuse rate, stale-correction rate after further page changes, and the effect of the scope rules (same step vs other workflow) over sequences of runs.
  - Depends on: P2.
  - Accept when:
    - a report shows model calls saved by memory and incorrect reuses (target 0);
    - forgetting after a failed reuse is exercised in the benchmark.
- [x] **P7 · Prompt and inference optimization (M).** Tune the prompt wording (`recovery-v2`), output size, `num_ctx`, keep-alive and the deterministic wait before recovery (about 10 s of every recovered step today).
  - Depends on: P3, P4, P5.
  - Accept when:
    - every change is measured against `recovery-v1` on the same manifest;
    - no increase in incorrect actions;
    - end-to-end time of a recovered step is reduced, and the reduction is reported.
- [x] **P8 · Observability and evaluation dashboard (M).** A static report page generated from benchmark JSONL: per-scenario verdicts, rates with CIs, latency distributions, tokens and cost, memory, plus a recovery-trace viewer for the `recoveries` table.
  - Depends on: P3.
  - Accept when:
    - the report is generated by one command;
    - it renders offline;
    - it is linked from `docs/benchmarks/`;
    - it never shows field values or page HTML.
- [x] **P9 · Experimental write-up (S).** Method, threats to validity, results, and limitations in `docs/benchmarks/sprint-4.md`, plus a short demo recording of the side panel flow.
  - Depends on: P4–P8.
  - Accept when every figure in the write-up is reproducible from a committed manifest and raw data.

## Status (2026-11-21)

All actions done on `feat/sprint-4-evaluation` (up to `49ccd18`); final runs `s4-final`, `s4f-rot`, `s4f-settle*`; report `docs/research/sprint-4-report.md`.
Done differently from the plan: P2 has 47 scenarios on 7 workflows of the demo site (2 held out), not several page types beyond it; P4 compared 3 local models (no OpenAI-compatible runtime run); P9 has no demo recording.
Before closure: owner review and merge of PRs #1 → #2 → #3, then `/crew-close-task`.

## Phase A stabilization (2026-11-21)

- `simplify` pass done (reuse, simplification, efficiency, altitude): duplicated metric checks removed, report correct-proposal rate aligned with `proposalMatches`; regenerated `s4-final` and `s4f-rot` reports are unchanged.
- Security review of Sprints 2–4: no critical or high finding. Fixed with regression tests: fields of a cross-origin form offered to the model again (Sprint 4 regression); text of sensitive-marked subtrees and link query values sent to the model; AI prompt not saying why confirmation is needed; `resolveRef` identity check too weak (row, section, destination); hidden loading indicator holding the wait; provider base-URL credentials in error messages.
- Deferred (low, documented in the integration report): unverified correction memorized when the recovered step is the last one; no server-side spending ceiling; token readable by content scripts; confirmation matched by step index only.
- Sprint 1–2 AI checklist items automated in `tests/e2e/hardening.spec.ts`; the extension-reload item is manual (`crew/TESTS/DEV/sprint-1-extension-scaffold.md`).
- An independent review of these fixes found 1 high (dropping link query values merged distinct links for identity checks; replaced by digests) and 2 medium issues (ancestor sensitive marker; recorder port kept alive after the recording); all fixed with tests.
- Regression benchmark `s4-phase-a` (commit `2d7986c`, clean tree, raw data `docs/research/data/s4-phase-a.jsonl`): deterministic and `qwen2.5:3b`, 47 scenarios each. All 94 verdicts match `s4-final`; 0 incorrect, 0 unsafe; qwen2.5:3b completion 95 % [85–99], autonomous 57 % (n=44).
- Still open from the plan: P4 OpenAI-compatible runtime run, P9 demo recording, native Chrome checks.
