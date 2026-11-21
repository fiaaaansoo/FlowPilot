# FlowPilot architecture

State as of Sprint 3: deterministic recorder and workflow engine (Sprint 2) plus optional AI recovery through a local service. This document describes the boundaries between modules and the choices that justify them; AI recovery is detailed in [recovery.md](recovery.md) and summarized in [decision 12](#12-optional-ai-recovery-behind-a-validating-gateway-sprint-3).

## Overview

```text
┌──────────── Side Panel (React) ─────────────┐
│ reads: chrome.storage + permissions         │
│ writes: nothing (sends Commands)            │
│ requests host permissions (UI gesture)      │
│ SW keepalive during a replay                │
└───────────────┬─────────────────────────────┘
                │ Command (record/start, session/stop, replay/start, replay/continue…)
                ▼
┌──────────── Service worker ─────────────────┐
│ SessionController (sole writer)             │
│  ├─ state machine (packages/shared)         │
│  ├─ recorder  → event draft                 │
│  │              → compileSteps (shared)     │
│  ├─ executor  → StepDriver (navigate, wait, │
│  │              perform, requestHuman)      │
│  └─ stores    → session / workflows / runs  │
│ tabs.onUpdated → navigations (SPA included) │
│ BrowserEnv = chrome.* adapter (injected)    │
└───────┬───────────────────────▲─────────────┘
        │ content/ping, record, │ recorder/event (capture)
        │ perform               │ content/hello (should I capture?)
        ▼                       │
┌──────────── Content script (IIFE, main frame) ───────┐
│ InteractionCapture: isTrusted gestures, filtering    │
│   of sensitive fields BEFORE anything is sent        │
│ grounding: describeElement / resolveTarget           │
│ performStep: predefined DOM actions + verification   │
└──────────────────────────────────────────────────────┘
```

## Decisions

### 1. A single writer: the service worker

The Side Panel never writes the session state. It sends typed commands (`packages/shared/src/messages.ts`) and redraws itself on `chrome.storage.onChanged`. The `SessionController` serializes **commands and events** in a queue: a double click does not start two recordings, and two capture events do not overwrite each other's draft.

Accepted exception: `chrome.permissions.request` must be called from a page, within the user gesture. The Side Panel therefore manages host permissions itself.

### 2. Pure, shared state machine

```text
idle ──RECORD_STARTED──▶ recording ──STOPPED──▶ idle
idle ──REPLAY_STARTED──▶ replaying ──STOPPED | REPLAY_FINISHED──▶ idle
replaying ──HUMAN_REQUESTED──▶ replaying (awaitingHuman) ──HUMAN_RESOLVED──▶ replaying
```

`packages/shared/src/session.ts`, with no Chrome dependency. An invalid transition returns `INVALID_TRANSITION`, never a silent exception.

### 3. Volatile and persistent state kept separate

| Area | Content | Why |
| --- | --- | --- |
| `chrome.storage.session` | session, recording draft | Survives service worker restarts. Cleared when the browser closes. Inaccessible to content scripts. |
| `chrome.storage.local` | workflows, run history (last 50) | Must survive closing the extension and the browser. Basis for the future memory and evaluation. |

When the worker restarts, `recover()` resumes a recording as is (draft and capture persist). An orphaned replay, whose loop lived in memory, is marked as failed and the session is released.

### 4. Injected Chrome dependencies

`SessionController` receives a `BrowserEnv` and stores built on `KeyValueArea`. In production: `chrome-env.ts` and `chromeArea`. In tests: `FakeEnv` and `memoryArea`. All the logic (permissions, tabs, confirmations, stops, restarts) is tested without a browser; Playwright then validates the real integration on the shipped build.

### 5. Two-phase recording: raw capture, pure compilation

1. **Capture.** The content script emits timestamped `RecordedEvent`s; the service worker adds `NavigationEvent`s observed via `tabs.onUpdated` (`changeInfo.url` also covers `history.pushState`, hence SPAs). Everything is stored raw in the draft (1,000 events at most).
2. **Compilation.** `compileSteps` (`packages/shared/src/recording.ts`, pure) sorts by timestamp, then:
   - merges successive inputs in the same field (and selections, checkboxes);
   - reduces a double click to a single click;
   - keeps all clicks, even close together (two clicks on « + » stay two clicks);
   - ignores a navigation to the current URL (reload);
   - merges navigations close together (redirect chain);
   - classifies a navigation as `waitForNavigation` if it is caused by an interaction: less than 3 s after it, or later if the page signaled its departure (`beforeunload`) right after the interaction (slow form); `navigate` otherwise (typed URL, history).

Sorting by timestamp settles the race between the click message (content script) and the navigation event (service worker): arrival order does not matter. The Side Panel compiles the same draft to display the steps live.

**What capture keeps**: only `isTrusted` events (a page script cannot fabricate a step); clicks reduced to the nearest interactive element, or failing that to the topmost ancestor displayed as clickable (`cursor: pointer`) — focus clicks, clicks on a checkbox or its label, and clicks on inert text are ignored; inputs emitted on commit (`change`) or before any action that may leave the page; Enter: submission (`submit`) only when there is no triggering button, otherwise a `press` step passed to the page scripts (single-page application search).

**Privacy at capture**: the value of a sensitive field, list or checkbox is never read (`manualInput` step). URLs (start page, navigations, link `href`s) are sanitized before any storage: token-, code-, session- and signature-type parameters and `#…=` fragments (OAuth) are removed.

**Reinjection.** During a recording, the content script is registered dynamically (`chrome.scripting.registerContentScripts`, recorded domain only, `document_end`, non-persistent): it is present as soon as each page loads, without waiting for the full load. At startup, it asks the service worker (`content/hello`) whether it should capture: only the recorded tab answers yes. The dynamic registration is removed on stop, and at worker startup if no session is active.

### 6. Workflow schema v2

`schemaVersion: 2`, typed steps: `navigate`, `waitForNavigation`, `click`, `input`, `manualInput`, `select`, `check`, `submit`. Interaction steps carry a multi-cue `ElementTarget`:

| Cue | Example | Reliability |
| --- | --- | --- |
| `attributes` (data-testid, non-generated id, name, aria-label, placeholder, type, href, checkbox value) | `{ name: 'contrat', type: 'checkbox', value: 'CDI' }` | strong |
| `role` + `name` (accessible name) | `button` / « Rechercher » (Search) | strong |
| `css` (selector unique at recording time) | `#search > button` | fragile (structure) |
| `text` (visible text) | « Sauvegarder » (Save) | fragile (content) |

`context` is added to these: the text of the row that contains the element (list item, row, card), recorded only when other elements on the page have the same role and the same name. It tells identical buttons apart (« Supprimer l'alerte », "Delete the alert") without depending on their position, and it is shown in confirmation prompts so the user knows which row is targeted.

Every read goes through `parseWorkflow`, which rebuilds the object field by field, bounds sizes, rejects unknown types and versions and migrates v1 workflows. Ids generated by frameworks (`:r1:`, `ember123`, hashes) are not kept as cues.

### 7. Deterministic grounding that refuses ambiguity

`resolveTarget` (`apps/extension/src/grounding/resolve.ts`) keeps only **visible** candidates and separates two families of cues:

1. **Strong cues** (test id, id, role + name, attributes): those that find nothing are ignored, and the chosen element lies in the intersection of the others; if they diverge, `TARGET_AMBIGUOUS`.
2. **Several strong candidates**: told apart only by the row (`context`); never by position (CSS) or text, which would designate the element located at the same place after a row is inserted or removed. Row gone → `TARGET_NOT_FOUND`.
3. **Fragile cues** (CSS, text): used alone only if the target had no strong cue. If it had some and they find nothing anymore, the element has changed: `TARGET_NOT_FOUND` (the case the Recovery Agent will handle), rather than a click on whatever occupies its place.

Nothing visible → `TARGET_NOT_INTERACTABLE` (present but hidden) or `TARGET_NOT_FOUND`. `waitForTarget` retries for up to 10 s (lazily loaded elements), except for ambiguity, which is returned immediately; stopping the replay interrupts the wait.

### 8. Replay: independent executor, verified effects

`runWorkflow` executes the steps in order through a `StepDriver`, never rejects (any exception becomes a step failure) and produces a `RunSummary` with a **per-step log** (status, duration, grounding strategy, error code and message). Each step type has its handler in a typed table: a `kind` without a handler does not compile.

- `navigate` / `waitForNavigation`: the tab state is polled (`status: complete`, 15 s max) rather than listened to, which avoids any race with a navigation that has already finished. The URL is compared with `urlMatches`: same origin and same path, recorded parameters identical except volatile parameters (tracking, timestamp) or secrets, fragment taken into account only for `#/` routing. Then the content script must answer from the right origin.
- Interactions: `performStep` in the page, via the native setters + `input`/`change` events (React/Vue compatible), then verification of the effect (value kept, checkbox checked, option exists). Before a click or a submission, the page answers the service worker, then acts: a closed port means it disappeared **before** acting, which is a failure.
- Stop: an `AbortSignal` goes through the executor, the waits and the actions; the service worker also sends `content/cancel`, so that the page does not act if the awaited element eventually appears. A new replay is refused until the previous one has finished its step. A failure caused by the stop is logged as `aborted`, not `failed`.

### 9. Human intervention (human-in-the-loop)

Two cases suspend the replay before the step (`awaitingHuman`), and the Side Panel displays a prompt:

- **potentially irreversible action** (`confirm: true`, set at capture by a broad heuristic: send, pay, delete, publish, apply, confirm…): nothing is executed without « Confirmer et exécuter » (Confirm and run);
- **sensitive field** (`manualInput`): the value was never recorded; the user types it in the page then continues, and FlowPilot only checks that the field is no longer empty.

Defense in depth: when acting, the page re-judges the element **actually found**. If it looks irreversible although the step was not marked (recording heuristic missed, wrong element), it refuses (`CONFIRMATION_REQUIRED`); the executor then asks for human approval and retries once.

During a replay, the Side Panel sends a `session/get` every 20 s: the MV3 service worker would otherwise be stopped after ~30 s of inactivity while waiting for a confirmation.

### 10. Minimal permissions and message provenance

- `permissions`: `sidePanel`, `storage`, `scripting`. Nothing else (verified by `manifest.test.ts`).
- `optional_host_permissions`: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`. No host at install time; access granted domain by domain.
- No `tabs` or `webNavigation` permission: a tab's URL is visible only on an allowed site. Navigations outside the allowed sites are neither seen nor recorded.
- **Commands**: accepted only if `sender.url` is an extension page.
- **Capture events**: accepted only from an extension content script, main frame (`frameId === 0`), and kept only for the tab being recorded. Each event is revalidated (`parseRecordedEvent`), its timestamps bounded.
- **Steps sent to the page**: revalidated by the content script; only predefined DOM actions exist, no received code is evaluated.

### 11. Build: a main build that triggers the content script build

The service worker is an ES module, which shares chunks with the Side Panel. The content script must be a standalone classic script: it is compiled as an IIFE by `vite.content.config.ts`, launched by the `flowpilot-content-script` plugin after each main build, watch included. The e2e tests load **the shipped `dist/`**: the Playwright fixture copies it and adds `host_permissions` (localhost) only to the copy's manifest.

### 12. Optional AI recovery behind a validating gateway (Sprint 3)

Details: [AI recovery](recovery.md). Decisions: [ADR 0001](adr/0001-local-first-provider-abstraction.md)
(local-first providers, no fallback), [ADR 0002](adr/0002-explicit-state-machine.md) (explicit state
machine), [ADR 0003](adr/0003-verified-memory-sqlite.md) (verified memory in SQLite),
[ADR 0004](adr/0004-claude-subscription-mode.md) (no Claude.ai subscription mode).

- A separate local service (`apps/api`, FastAPI) proposes a replacement element when a deterministic
  step fails with `TARGET_NOT_FOUND` or `TARGET_AMBIGUOUS`. It never receives browser privileges: it
  answers with a `ref` chosen among the elements the extension observed.
- The executor calls an optional `recover` hook through `StepDriver`; with AI recovery disabled (the
  default) the hook returns nothing and replay is identical to Sprint 2.
- The service worker validates every response (binding to run, step and snapshot; observed ref; step
  kind; same origin), asks the user when required, and executes the **recorded** action through the
  same `actOn` code path as deterministic replay. The content script revalidates snapshot, URL and
  element identity just before acting.
- A recovery counts as verified only when the next step succeeds; only then is the correction memorized.
- Budgets bound every request and every run (model calls, tokens, time, cost).

| Sprint 2 insertion point | Sprint 3 implementation |
| --- | --- |
| `runWorkflow` failure path | `StepDriver.recover` / `reportOutcome`, `background/recovery.ts` |
| Closed action list | The model picks a ref; action and value come from the recorded step |
| `ElementTarget` description | Semantic grounding (`grounding.py`) before any model call |
| `describeElement` / `accessibleName` | `grounding/observe.ts` (bounded, sanitized observation) |
| Page content as data | `<untrusted_page_content>`, schema-forced output, gateway checks |
| `RunStore` | `StepLog.recovery` telemetry; corrections stored by the backend |
| Stable prompt prefix | Versioned prompt, `cache_control` on the system prompt with Anthropic |
| Evaluation | Demo-site variants (`?variante=`), `tests/e2e/recovery.spec.ts`, `npm run bench` |

## Known limitations

- Main frame only: interactions inside iframes are neither captured nor replayed.
- Shadow DOM is not traversed by grounding; `contenteditable` is not captured.
- No capture of drag and drop, hovers, scrolls, keyboard shortcuts (other than Enter) or file uploads. Clicks on elements with no role and no `cursor: pointer` are ignored.
- Navigations to a non-allowed site cannot be observed (no `tabs` permission): the replay will fail explicitly at the corresponding step.
- `waitForNavigation` tolerates the known volatile parameters, but not a dynamic identifier in the path (`/commande/12345`) nor a business parameter that changes on every visit.
- The `navigate` / `waitForNavigation` classification remains heuristic (3 s window and page departure): a URL typed less than 3 s after an interaction may be mistaken for a consequence of it.
- An element whose strong cues have changed (label modified) is declared not found by the deterministic engine; with AI recovery enabled, the Sprint 3 recovery flow handles it.
- An element with no strong cue and no text (clickable icon without a name) is found only by its CSS selector, hence by its position.
- The "irreversible" heuristic over-confirms (« Annuler » (Cancel), « Mes commandes » (My orders), « Order by »): this is the chosen trade-off.
- The `code` and `state` URL parameters are removed only together (OAuth return); on their own, they are often business parameters.
- If saving a workflow fails (storage full), the draft is kept, but the next recording replaces it: no recovery is offered.
- The "irreversible" heuristic is deliberately broad (e.g. « Postuler » (Apply)): a few superfluous confirmations.
- Replay acts on the active tab of the last used window and does not survive a service worker restart (marked as failed). Without an open Side Panel, a confirmation wait of more than ~30 s may be interrupted by the worker stopping.
- Workflows can be neither renamed nor edited from the panel.
- AI recovery handles element steps only (not navigations, URL waits or manual input), on the main
  frame, and needs the local service to be running; it does not edit the recorded workflow (corrections
  live in the service's memory).
- Recovery confidence comes from heuristics and the model: thresholds are conservative, so some
  correct proposals still ask for confirmation.
