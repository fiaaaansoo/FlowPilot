# Sprint 3 — Agentic intelligence and autonomous recovery

Zone: package.json, apps/api/, apps/extension/, apps/demo-site/, packages/shared/, tests/, docs/, .github/, README.md, AGENTS.md, SECURITY.md, CONTRIBUTING.md

Depends on: sprint-2-record-replay (branch `feat/sprint-2-recorder`, not merged into `main` yet).
Branch: `feat/sprint-3-agentic-recovery` (based on `feat/sprint-2-recorder`).

Execution hierarchy: deterministic execution → failure detection → context extraction → AI recovery proposal → validation → controlled execution → outcome verification. The model only proposes; the deterministic engine validates and executes.

- [ ] Versioned recovery contract (`flowpilot.recovery/v1`) shared by TypeScript and Pydantic, with cross-validated JSON fixtures
- [ ] Extension DOM observation: bounded snapshot of visible interactive elements (refs, roles, names, stable attributes, row/section context), no field values, no sensitive fields, sanitized URLs
- [ ] Tool execution gateway in the extension: run/tab/origin/workflow/step binding, stale-snapshot rejection, element revalidation, cross-origin link rejection, sensitive-field rejection, mandatory human confirmation for irreversible actions
- [ ] Recovery agent as an explicit bounded state machine (observe, classify, build context, propose, validate, execute, verify, retry or escalate), eligible failures only, budgets (attempts, model calls, tokens, time, cost), repeated-proposal detection, cancellation
- [ ] FastAPI backend (localhost only, bearer token, restricted CORS): context builder, semantic grounding, read-only tool calling, prompt versions, telemetry
- [ ] Provider-independent model interface: Ollama (first class), OpenAI-compatible local endpoints (llama.cpp, vLLM, LM Studio), optional Anthropic API, mock provider; no silent fallback, no paid provider by default
- [ ] Mode A investigation (Claude subscription / Claude Code CLI) documented from official sources, without workarounds
- [ ] Memory engine (SQLite): verified corrections only, scoped, revalidated before reuse, inspectable and deletable
- [ ] Prompt engineering and caching: versioned prompts, stable prefix, usage accounting (input, output, cache read/write tokens, calls, latency, cost)
- [ ] Prompt injection defense: trust boundaries, strict schemas, origin restrictions, adversarial tests
- [ ] Side panel: AI settings (backend, token, mode), recovery status and confirmation prompts, memory inspection and deletion
- [ ] Demo site interface variations (labels, classes, ids, hierarchy, repeated list items)
- [ ] Tests: pytest, Vitest, e2e on the shipped build with the backend (mock provider), real local-model run (qwen2.5:3b)
- [ ] Benchmark: deterministic baseline vs semantic vs LLM-assisted recovery, with tokens, latency, cost and memory reuse
- [ ] Independent review, fixes and regression tests
- [ ] English documentation: architecture, ADRs, API and configuration, local setup
