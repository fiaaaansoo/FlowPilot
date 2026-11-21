# Sprint 3 — Final validation and integration

Why: Sprint 3 was pushed with its benchmark measured before the review fixes, two documented backend limits (request size, cancellation) and pending manual checks. It must be verified, hardened and opened as PRs before Sprint 4 starts. Branch: `feat/sprint-3-agentic-recovery`. No Sprint 4 work here.

Zone : `package.json`, `playwright.config.ts`, `playwright.benchmark.config.ts`, `apps/api/`, `apps/extension/`, `apps/demo-site/`, `packages/shared/`, `tests/`, `docs/`, `.github/`, `README.md`, `AGENTS.md`, `SECURITY.md`

- [x] Rerun every documented check (lint, typecheck, Vitest, build, e2e on the shipped build, ruff, pytest, contract fixtures) and fix regressions
- [x] Backend request body limit enforced while streaming (no reliance on `Content-Length`), with regression tests
- [x] Bounded cancellation: client disconnect and timeouts stop the agent between steps, release the slot, never produce an action; late or stale responses ignored by the extension; tests
- [x] Service worker lifecycle: tests for a pending recovery when the run is cancelled, the worker is stopped, or a late response arrives
- [x] Side panel controls fit at 320 / 400 / 600 px without overflow or truncation (visual check)
- [x] Independent security regression review of the recovery boundaries; confirmed issues fixed with tests
- [x] Memory bottleneck investigated; benchmark rerun sequentially with autonomous / confirmed / unresolved / incorrect counts, p95 latency, tokens, peak memory; results documented
- [x] Manual integration checks from `crew/TESTS/` done where feasible, the rest marked unverified with reproduction steps
- [x] Documentation updated (architecture, recovery, benchmarks, local setup, known limitations)
- [x] PRs: Sprint 2 → `main`, Sprint 3 → `feat/sprint-2-recorder`; CI results inspected; nothing merged
- [x] Sprint 4 technical handoff (prioritized tasks, dependencies, acceptance criteria, complexity) in `crew/TODO/sprint-4-evaluation.md`

Status 2026-11-21: PR #1 (Sprint 2 → `main`) and PR #2 (Sprint 3 → `feat/sprint-2-recorder`) open, CI green on both, nothing merged. Remaining before closure: owner review and merge of #1 then #2; native Chrome checks in `crew/TESTS/DEV/sprint-3-agent-recovery.md`; `/crew-close-task` (deep size: the `simplify` pass has not been run on this task's diff).

