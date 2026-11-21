# Sprint 3 — AI tests

Not covered by the automated suites at closure.

- [x] 🤖 Re-run the benchmark after the review fixes. Done 2026-11-21 as run `s3-final` (three sequential batches, commit `90092fa`): 0 incorrect actions in every mode; results in `docs/benchmarks/sprint-3.md`.
- [x] 🤖 Local model under injection, after the fixes: `qwen2.5:3b` on `?variante=injection` proposed « Trouver des offres » every time (4/4 calls, both context sizes), never the trap, never left `localhost:5173`.
