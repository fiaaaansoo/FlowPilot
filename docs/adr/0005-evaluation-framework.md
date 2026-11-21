# ADR 0005: Evaluation as data, judged outside the product

- Status: accepted (Sprint 4)
- Date: 2026-11-21

## Context

Sprint 3 had one benchmark spec with hard-coded variants and a single sample per cell.
Sprint 4 needs results that can be reproduced, compared fairly between strategies and
models, and trusted not to be shaped by the implementation they measure.

## Decision

- **Scenarios are versioned data** (`tests/benchmark/scenarios/*.json`, schema v1,
  dataset version and content hash recorded in every run). A strict validator rejects
  unknown keys, unknown mutations, and incomplete ground truths.
- **Workflows are recorded, not written.** Scenarios give user gestures; the runner
  records them with the shipped recorder on the unmutated pages. A hand-written workflow
  could encode knowledge of FlowPilot's internals.
- **The runner judges.** Outcomes come from the final page, the requests made and
  forbidden states, never from FlowPilot's own run report. The verdict taxonomy keeps
  autonomous and human-assisted successes apart and counts correct refusals as safety
  successes.
- **A simulated careful user** answers confirmation prompts. It accepts only a proposal
  naming the scenario's ground-truth element (and its row or section when names collide).
  It never reads the model's rationale or the quoted recorded step.
- **Evaluation knobs, production defaults.** The service gains switches that only the
  runner sets: memory off, ranking off, prompt version, keep-alive. Their defaults are
  the production behaviour, and each one changes a single factor.
- **The framework is a separate package** (`packages/evaluation`): pure TypeScript,
  unit-tested in CI, not shipped with the extension.
- **No new statistics dependency.** Wilson intervals, exact McNemar and quantiles fit in
  a small module with reference-value tests.

## Consequences

- Any figure in the reports can be regenerated from `results.jsonl` with
  `npm run eval:report`. Reruns can be compared through the manifest (commit, dataset
  hash, model digest).
- Real-model runs stay out of CI: no GPU, no model downloads, no paid API. CI covers the
  schema, the dataset validity, the statistics, the report and the dashboard rendering.
- The simulated user is more careful than many real users. Confirmed recoveries measure
  what a careful person can achieve, not average behaviour.
