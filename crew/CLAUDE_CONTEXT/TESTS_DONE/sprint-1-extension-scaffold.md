# Sprint 1 — AI tests

Risky zones not covered by an automated test at closure. Automated on 2026-11-21 in `tests/e2e/hardening.spec.ts` (shipped build, Chromium).

- [x] 🤖 An allowed web page cannot drive the session: the page's main world has no `chrome.runtime` channel, and `{ type: 'record/start' }` sent from the content script's isolated world gets no command response; the session stays idle (`isFromExtensionPage`, `apps/extension/src/background/index.ts`). Test: "neither a web page nor a content script can drive the session".
- [x] 🤖 Extension reload with an already recorded tab: not automatable (Playwright's Chromium blocks an extension loaded with `--load-extension` after `chrome.runtime.reload()`, `ERR_BLOCKED_BY_CLIENT`). Moved to `crew/TESTS/DEV/sprint-1-extension-scaffold.md`.
- [x] 🤖 « Arrêter » during a replay that is navigating to a slow page (response delayed 12 s): the session is idle in under 3 s and the last run is `aborted`. Test: "stopping a replay during a slow navigation is immediate and marks the run aborted".
