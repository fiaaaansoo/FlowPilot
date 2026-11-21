# ADR 0004: No Claude.ai subscription mode

- Status: accepted (Sprint 3)
- Date: 2026-11-21

## Context

Section 16 of the Sprint 3 brief asked to investigate whether FlowPilot could use a
user's Claude subscription (Free, Pro, Max) or the Claude Code CLI instead of a
separately billed API key, without assuming API access, reusing OAuth or session
tokens, or building proxies or bypasses.

## Findings

- Anthropic's Claude Code legal and compliance documentation
  (code.claude.com, "Legal and compliance") states that Anthropic does not permit
  third-party developers to offer Claude.ai login in their own applications or to
  route requests through Free, Pro, Max or other plan credentials on behalf of their
  users, and that such developers may not collect, store or intermediate Claude.ai
  credentials or session tokens.
- A subscription does not include Claude API access; the API is billed separately
  through the Claude Console.
- Driving the Claude Code CLI as a hidden inference backend for another product
  would route FlowPilot's requests through the user's plan credentials, which is the
  case described above. No documented, supported integration exists for it.

## Decision

- FlowPilot does not implement a subscription or CLI provider, does not read Claude
  credentials, and does not expose Claude login.
- The supported Claude path is the `anthropic` provider with an API key created in
  the Claude Console, set explicitly by the user (`ANTHROPIC_API_KEY`).
- Zero-cost use is served by local models (`ollama`, `openai-compatible`) and by the
  model-free `none` mode.

## Consequences

- Users with only a Claude subscription use a local model or no model.
- If Anthropic publishes a supported way for third-party apps to use subscription
  credentials, this ADR should be revisited.
