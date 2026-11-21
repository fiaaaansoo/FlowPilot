# ADR 0003: Verified corrections in SQLite, no vector database

- Status: accepted (Sprint 3)
- Date: 2026-11-21

## Context

A correction that worked once should be reused without calling a model again, but
memory must not turn a lucky guess into a permanent mistake, leak page content, or
grow into an opaque store.

## Decision

- Store corrections in SQLite (standard library, one file, `FLOWPILOT_DB_PATH`).
- Key: origin, workflow id, step id and a fingerprint of the recorded target.
  Value: a descriptor of the corrected element (role, name, a few attributes) —
  never a ref, an input value or HTML.
- Write a correction only when the extension reports that the step *after* the
  recovered one succeeded, and only for the candidate the backend proposed
  (a mismatching report is rejected).
- On reuse, revalidate against the live observation: exactly one element must
  match the stored descriptor; otherwise fall through to semantic grounding.
- Corrections are listable and deletable (one or all) from the side panel and the
  API.
- No embeddings or vector store: exact scoped lookups answer the actual question
  ("did this step on this site move?") and stay inspectable.

## Consequences

- Repeated replays of a changed page cost zero model calls (measured in the
  benchmark, pass 2).
- A correction never crosses origins and is scoped to one workflow step, with one
  fallback: same origin and same recorded target, still revalidated.
- Similar-but-different pages do not benefit from memory; that is intended.
