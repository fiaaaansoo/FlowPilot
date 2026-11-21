# CONTRIBUTING.md — FlowPilot

## Branches

- `main`: always green (CI `check` + `e2e`).
- Work: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `test/<slug>`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/en/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, with an optional scope (`feat(extension): …`, `fix(shared): …`). Subject in the imperative mood, in English or French, no trailing period.

**No AI attribution trailer**: no `Co-Authored-By: Claude …` line and no "Generated with Claude Code" in commits and PRs. The repository has a single author.

## Pull requests

- One PR = one topic. Description: what, why, how it is verified.
- Before opening: `npm run check` and `npm run test:e2e` pass locally.
- The GitHub Actions CI (`.github/workflows/ci.yml`) must be green before merging.
- Any new Chrome permission is justified in `docs/architecture.md`.
