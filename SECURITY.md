# SECURITY.md — FlowPilot

## Secrets

- Provider keys (`ANTHROPIC_API_KEY`, `FLOWPILOT_OPENAI_API_KEY`) exist only as environment variables of `apps/api`, never in the extension (everything that is packaged is readable by the user). `apps/api/.env` is ignored by git; `apps/api/.env.example` documents the variables without values.
- `FLOWPILOT_API_TOKEN` (24+ random characters, `python -m flowpilot_api token`) is the bearer token between the extension and the backend. The user pastes it in the Side Panel; it is stored in `chrome.storage.local` and sent only to the configured loopback endpoint.
- Claude.ai credentials or session tokens are never read, stored or used ([ADR 0004](docs/adr/0004-claude-subscription-mode.md)).
- Keys are never logged or sent back to the client.

## Auth boundaries

- Recovery backend: loopback only by default (refuses a non-loopback host without `FLOWPILOT_ALLOW_REMOTE=1`); every route except `/healthz` requires the bearer token (constant-time comparison); CORS closed unless `FLOWPILOT_ALLOWED_ORIGINS` is set, never with credentials; request body size limit; at most 2 concurrent recoveries; `/docs` and `/openapi.json` disabled.
- The extension accepts only a loopback endpoint (`isLoopbackEndpoint`), requests host access to it with Chrome's prompt, and calls it with `credentials: 'omit'` and `redirect: 'error'`.
- The backend has no browser privilege: it returns a proposal (a ref among observed elements) that the extension validates, may submit to the user, and executes with the recorded action.
- Internal boundaries of the extension:
  - Only extension pages (`sender.url` under `chrome-extension://<id>/`) can send commands to the service worker. Messages from content scripts, hence from web pages, and from other extensions are ignored.
  - The content script only accepts messages from its own extension and never executes received code.
  - `chrome.storage.session` (session state) is inaccessible to content scripts (default access level).
- Site access: none by default, optional permission granted domain by domain with Chrome's native confirmation, revocable from the Side Panel.

## Sensitive data / PII

- Never captured: `input[type=password]`, payment `autocomplete` fields (`cc-*`) or credential fields (`current-password`, `new-password`, `one-time-code`), fields whose name, id, label or placeholder suggests a password, a card, an IBAN, a verification code or a token, and any subtree marked `data-flowpilot-sensitive` / `data-private` / `data-sensitive`. Filtering happens in the content script (`recorder/classify.ts`), **before anything is sent**: the value is not even read, and the step becomes `manualInput`. Cookies, tokens and headers are never accessible (no corresponding permission).
- The values of other fields (search text, name, e-mail…) are recorded: that is the point of replay. The elements themselves are described by their role, accessible name and stable attributes, never by their value (except checkboxes, radios and buttons, whose value is a label).
- Workflows and run history stay local (`chrome.storage.local`). With AI recovery enabled, the only data sent (to the local backend) is the failed step without its value, and a bounded observation: role, accessible name, short text and context, a few safe attributes of visible non-sensitive elements (link `href`s without query values), and the URL without query values. Text inside a subtree marked sensitive is never sent. No field value, no full-page HTML.
- The backend stores verified corrections (element descriptors, no value, no ref) and recovery telemetry in a local SQLite file; both are inspectable and deletable (`GET/DELETE /v1/memory`, Side Panel).
- Only real gestures (`isTrusted`) are captured; capture events are accepted only from the main frame of the recorded tab, then revalidated.
- Page content = untrusted data: never interpreted as an instruction. Prompt injection defense does not rely on the prompt: the model can only pick an observed same-origin ref, cannot change the action or the value, and cannot skip the confirmation of an irreversible element (adversarial tests in `apps/api/tests/test_agent.py` and `tests/e2e/recovery.spec.ts`).

## Pre-production checklist

Before any publication on the Chrome Web Store:

- [ ] The shipped build does not contain `host_permissions` (verified by `apps/extension/src/manifest.test.ts` and the e2e tests; only the tests' temporary copy adds them).
- [ ] Permissions = `sidePanel`, `storage`, `scripting` + optional per-domain ones. Any other is justified.
- [ ] No source map or debug `console.log` in `dist/`.
- [ ] No `eval`, `new Function` or remote code (default MV3 CSP respected).
- [ ] Privacy policy published, even if no data leaves the browser.
- [x] Backend: loopback by default, bearer token, CORS closed by default, `/docs` disabled, body limit and concurrency cap, strict Pydantic validation (`extra="forbid"`).
- [ ] Backend exposed beyond loopback (`FLOWPILOT_ALLOW_REMOTE`): not supported for production; would need TLS, per-user tokens and rate limiting.
