# Batching — parallel workstreams

One batch = one Claude. See § Batching in `crew/CLAUDE_CONTEXT/LIFECYCLE.md` for the rules
(impact zone, disjointness invariant between active batches).

## Unsorted

_Aucune tâche non classée._

## Batch A — Fondations extension (séquentiel : chaque sprint dépend du précédent)

Zone : package.json, apps/extension/, apps/demo-site/, packages/shared/, tests/, docs/, .github/, README.md, AGENTS.md

- `sprint-1-extension-scaffold.md`
- `sprint-2-record-replay.md`

## Batch B — Backend agentique et évaluation

Zone : apps/api/, tests/, docs/

- `sprint-3-agent-recovery.md`
- `sprint-4-evaluation.md`
