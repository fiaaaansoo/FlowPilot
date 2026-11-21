# FlowPilot

Open source Chrome extension that records a procedure performed in the browser, then replays it. Eventually, an AI agent will take over when a site's interface has changed.

> **Status: Sprint 3.** FlowPilot records a real procedure (clicks, text input, lists, checkboxes, form submissions, classic and SPA navigations), saves it and replays it deterministically. Sensitive fields are never recorded, irreversible actions require confirmation, and every run is logged step by step. When a recorded element has changed, an **optional** local service can propose the equivalent element; FlowPilot validates every proposal before acting and works fully without it. See [Roadmap](#roadmap).

## Quick start

Prerequisites: Node.js **22.22.2+** or **24.15+** (required by jsdom, used by the tests), npm 10+, Chrome 120+.

```bash
npm install
npm run build              # → apps/extension/dist/ and apps/demo-site/dist/
npm run dev:demo           # demo site on http://localhost:5173
```

Load the extension:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Click the FlowPilot icon: the Side Panel opens.

Try it:

1. Under **Sites autorisés** (allowed sites), enter `localhost:5173`, click **Autoriser** (Allow) and accept Chrome's prompt.
2. Open `http://localhost:5173`, then click **Enregistrer** (Record) in the panel.
3. Run a search (keywords, city, contract type), open an offer, click **Postuler** (Apply), fill in and send the application. The steps appear live in the panel.
4. Click **Arrêter** (Stop): the workflow is saved, with its steps.
5. Navigate elsewhere, then click **Rejouer** (Replay). FlowPilot performs the procedure again and stops before every potentially irreversible action (« Postuler », « Envoyer la candidature ») to ask for confirmation.
6. The result of each step (succeeded, failed with the cause, strategy that found the element) is shown under the workflow.

The page `http://localhost:5173/spa.html` (single-page application, lazily loaded content, password field) lets you try SPA navigations and manual entry of sensitive fields.

### Optional: AI recovery (local, free by default)

Requires Python 3.11+. Details and every setting: [apps/api/README.md](apps/api/README.md); design: [docs/recovery.md](docs/recovery.md).

```bash
cd apps/api
python -m venv .venv && .venv/Scripts/activate      # Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"
python -m flowpilot_api token                       # prints a random access token
cp .env.example .env                                # set FLOWPILOT_API_TOKEN (and a provider, see below)
python -m flowpilot_api serve                       # http://127.0.0.1:8787
```

- Without a model (`FLOWPILOT_PROVIDER=none`, the default): memory and semantic matching only.
- Local model, no cost: install [Ollama](https://ollama.com), `ollama pull qwen2.5:3b`, then `FLOWPILOT_PROVIDER=ollama` and `FLOWPILOT_MODEL=qwen2.5:3b`.
- Claude API (billed per token, optional): `pip install -e ".[anthropic]"`, `FLOWPILOT_PROVIDER=anthropic` and an `ANTHROPIC_API_KEY` from the Claude Console. A Claude.ai subscription cannot be used ([ADR 0004](docs/adr/0004-claude-subscription-mode.md)).

In the Side Panel, under **Récupération IA** (AI recovery), tick **Activer la récupération IA**, paste the token, click **Enregistrer les réglages** (Save settings), accept Chrome's prompt for `127.0.0.1`, then **Tester la connexion** (Test connection). The demo site has controlled interface changes for trying it: `http://localhost:5173/?variante=synonymes` (others: `classes`, `ids`, `hierarchie`, `libelles`, `bruit`, `liste`, `injection`; `?variante=aucune` restores the original).

Without the service, or with **Activer la récupération IA** unticked (the default), FlowPilot records and replays exactly as before: deterministic, no network call. To compare the modes on the demo site, run the benchmark (`npm run bench`, see [docs/benchmarks](docs/benchmarks/README.md); on a busy machine run it in batches with `FLOWPILOT_BENCH_MODES`). Token usage, cost and recovery logs: each recovered step in the panel, `GET /v1/metrics` on the service, and the per-step `recovery` log in the run history ([docs/recovery.md](docs/recovery.md#inspecting-usage-and-recovery-logs)).

Continuous extension development: `npm run dev:extension` rebuilds `dist/` (content script included) on every change. You then need to reload the extension in `chrome://extensions`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint (strict typescript-eslint, React hooks rules) |
| `npm run typecheck` | `tsc` on the root and each workspace |
| `npm test` | Vitest: shared logic, controller, executor, storage, Side Panel (jsdom), demo site |
| `npm run test:e2e` | Extension build then Playwright: the shipped `dist/`, loaded in Chromium, + demo site + recovery backend (mock provider) |
| `npm run bench` | Recovery benchmark on the shipped build ([docs/benchmarks](docs/benchmarks/README.md)) |
| `cd apps/api && python -m pytest` | Backend tests (no model, no network) |
| `npm run build` | Build of the extension and the demo site |
| `npm run check` | lint + typecheck + tests + build (same as CI) |

First run of the e2e tests: `npx playwright install chromium`. The e2e tests also start the backend from `apps/api/.venv` (set `FLOWPILOT_PYTHON` to use another interpreter).

## Structure

```text
apps/
  extension/        Chrome MV3 extension (React + Vite)
    manifest.json   Manifest source (version injected at build)
    src/background/ Service worker: SessionController + Chrome adapter
    src/content/    Content script injected on demand (handshake)
    src/sidepanel/  React interface of the Side Panel
    src/recorder/   Gesture capture in the page, sensitive-field filter
    src/grounding/  Deterministic description and resolution of elements
    src/executor/   Sequential execution of steps, in-page actions
    src/storage/    Typed access to chrome.storage (session / local)
  demo-site/        Fictional job board (search → results → offer), with interface variants
  api/              Optional local recovery service (FastAPI): agent, providers, memory, telemetry
packages/
  shared/           Types and pure logic: messages, state machine, workflow schema, event compilation
tests/e2e/          Playwright tests
tests/benchmark/    Recovery benchmark (Playwright, shipped build)
tests/contracts/    Recovery contract fixtures shared by TypeScript and Python tests
docs/               Architecture, AI recovery, ADRs, benchmarks
crew/               Task tracking (backlog, in progress, history)
```

The architecture and its rationale are detailed in [docs/architecture.md](docs/architecture.md).

## Security

- **No access to sites by default.** Host permissions are optional and granted domain by domain from the Side Panel. No `<all_urls>`, no `tabs` permission.
- The content script is never declared in the manifest: it is injected on demand, only on an allowed site.
- Commands are accepted only from extension pages. A message coming from a web page is ignored.
- Any data read back (storage, messages) is validated at runtime. A workflow of an unknown version is rejected, never guessed.
- No `eval` and no remote code: compatible with the default Manifest V3 CSP. The page only receives predefined DOM actions.
- **Sensitive fields** (passwords, bank cards, one-time codes, fields marked `data-flowpilot-sensitive`): their value is never read or recorded. At replay, FlowPilot asks you to enter it yourself.
- **Irreversible actions** (send, pay, delete, publish…): replayed only after your confirmation in the panel.
- Only real gestures are recorded (`isTrusted` events): a page script cannot inject steps.
- **AI recovery is off by default** and only talks to a loopback service with a bearer token. The service never drives the browser: it proposes one of the observed elements, and the extension validates it, executes the recorded action, and asks you first when the element is irreversible or the proposal is uncertain. Field values, sensitive fields and full-page HTML are never sent. See [docs/recovery.md](docs/recovery.md).

## Roadmap

| Sprint | Content | Status |
| --- | --- | --- |
| 1 | Monorepo, MV3, Side Panel, demo site, lint/tests/CI | ✅ |
| 2 | Click/input capture (excluding sensitive fields), multi-cue grounding, multi-page and SPA replay, confirmations, logs | ✅ |
| 3 | Local FastAPI backend, semantic grounding, bounded recovery agent, local/cloud providers, verified memory, telemetry, benchmark | ✅ |
| 4 | UI change scenarios, A/B/C evaluation, measurements | upcoming |

Task details are in `crew/TODO/`.

## License

MIT, see [LICENSE](LICENSE).
