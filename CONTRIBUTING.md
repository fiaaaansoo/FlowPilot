# CONTRIBUTING.md — FlowPilot

## Branches

- `main` : toujours vert (CI `check` + `e2e`).
- Travail : `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `test/<slug>`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/fr/) : `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, avec un scope optionnel (`feat(extension): …`, `fix(shared): …`). Sujet à l'impératif, en anglais ou en français, sans point final.

**Pas de trailer d'attribution IA** : aucune ligne `Co-Authored-By: Claude …` ni « Generated with Claude Code » dans les commits et les PR. Le dépôt n'a qu'une autrice ou un auteur.

## Pull requests

- Une PR = un sujet. Description : quoi, pourquoi, comment c'est vérifié.
- Avant d'ouvrir : `npm run check` et `npm run test:e2e` passent en local.
- La CI GitHub Actions (`.github/workflows/ci.yml`) doit être verte avant le merge.
- Toute nouvelle permission Chrome est justifiée dans `docs/architecture.md`.
