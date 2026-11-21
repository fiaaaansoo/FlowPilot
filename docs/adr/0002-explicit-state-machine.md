# ADR 0002: An explicit bounded state machine instead of an agent framework

- Status: accepted (Sprint 3)
- Date: 2026-11-21

## Context

The recovery agent observes, classifies, builds context, proposes, validates,
executes, verifies, and retries or escalates. The task suggested LangGraph "only if
justified".

## Decision

Implement the agent as a plain Python state machine (`agent.py`, `State` enum:
classify → memory → build_context → semantic → model ⇄ tool → validate → decided or
escalated). Each transition is a method; every run keeps a trace of states and
reasons that is stored with the telemetry.

Execution and outcome verification are not part of the backend: they happen in the
extension, which owns the browser and is the only component allowed to act.

## Why not LangGraph

- The graph is linear with one loop (model ⇄ read-only tools). It has no parallel
  branches, no human-in-the-loop checkpointing on the backend (the extension
  handles confirmation), and no long-lived state between requests.
- Budgets (calls, tokens, time, cost) and validation must be enforced at exact
  points; a framework would add indirection around the checks that matter most.
- Fewer dependencies on a security-sensitive path, and tests run without network
  or framework mocks.

## Consequences

- The whole decision path fits in one file and is covered by `tests/test_agent.py`.
- If later sprints need multi-step plans with persistence, this decision can be
  revisited; the provider layer and the contract would not change.
