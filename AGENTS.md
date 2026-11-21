# AGENTS.md — FlowPilot

Invariants et carte du dépôt pour tout agent (Claude Code ou autre) travaillant sur ce projet.

## Stack

Vérifiée depuis les `package.json` (Sprint 1) :

- Monorepo **npm workspaces** : `packages/shared`, `apps/extension`, `apps/demo-site`. pnpm n'est pas utilisé.
- **TypeScript 6.0** strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Pas de TS 7 : typescript-eslint 8 exige `<6.1`.
- Extension : **Chrome Manifest V3**, **React 19**, **Vite 8** (rolldown), `@types/chrome`.
- Site de démo : Vite multi-pages, TypeScript sans framework.
- Tests : **Vitest 5** (node + jsdom, Testing Library), **Playwright 1.65** (Chromium avec l'extension chargée).
- Lint : **ESLint 10** + typescript-eslint `strictTypeChecked` + react-hooks.
- Backend Python (FastAPI, Pydantic, Ruff, Pytest) : **pas encore créé**, prévu au Sprint 3 dans `apps/api/`.

## Repository map

```text
apps/extension/            Extension Chrome MV3
  manifest.json            Source du manifest (version injectée au build ; aucun host_permissions, vérifié par manifest.test.ts)
  vite.config.ts           Build Side Panel + service worker (ESM), plugins manifest et content script, config Vitest
  vite.content.config.ts   Build du content script en IIFE, lancé par le plugin après chaque build principal (watch compris)
  src/background/          index.ts (écouteurs Chrome), controller.ts (SessionController, seul écrivain), chrome-env.ts (adaptateur chrome.*)
  src/content/             Content script injecté à la demande (handshake ping/pong)
  src/sidepanel/           UI React : App, components/, api.ts (frontière Chrome), usePanelState.ts
  src/recorder/            Construction des brouillons de workflow
  src/executor/            runWorkflow + StepDriver (indépendant de Chrome et du LLM)
  src/storage/             KeyValueArea, SessionStore (storage.session), WorkflowStore (storage.local)
  src/test/                setup Vitest, FakeEnv
apps/demo-site/            Site d'emploi fictif, port fixe 5173 (index → results → offer)
packages/shared/src/       messages, session (machine d'état), workflow (schéma v1 + parseWorkflow), origin, result, run
tests/e2e/                 Playwright : fixtures (copie de dist/ + localhost accordé, chargement dans Chromium), specs
docs/architecture.md       Décisions d'architecture et limites connues
crew/                      Suivi des tâches (source unique)
```

## Verified commands

Toutes exécutées avec succès le 2026-11-21 (Node 24.14, Windows 11) :

```bash
npm install                     # installation des workspaces
npm run dev:demo                # site de démo, http://localhost:5173
npm run dev:extension           # rebuild continu de apps/extension/dist
npm run lint                    # ESLint
npm run typecheck               # tsc racine + workspaces
npm test                        # Vitest, 115 tests
npx playwright install chromium # une fois, navigateur des tests e2e
npm run test:e2e                # build de l'extension + Playwright, 6 tests
npm run build                   # apps/extension/dist + apps/demo-site/dist
npm run check                   # lint + typecheck + test + build (= job CI "check")
```

## Code rules

- **Le service worker est le seul écrivain de la session.** Le Side Panel envoie des `Command` (`packages/shared/src/messages.ts`) et lit le stockage. Toute nouvelle action = nouvelle `Command` + garde `isCommand` + cas dans `SessionController.handle`.
- Toute transition passe par `transition()` (`packages/shared/src/session.ts`). Pas de `setSession` avec un état construit à la main.
- **Toute donnée externe est `unknown` et validée** : messages Chrome, stockage, réponses du content script. Un schéma de workflow modifié = incrément de `WORKFLOW_SCHEMA_VERSION` + migration explicite, jamais de lecture permissive.
- Erreurs attendues = `Result` avec un `ErrorCode` et un message français affichable. Les exceptions sont réservées à l'inattendu.
- `chrome.*` n'apparaît que dans `background/index.ts`, `background/chrome-env.ts`, `content/`, `sidepanel/api.ts` et `storage/area.ts`. La logique reste testable sans navigateur.
- Le content script reste un script classique autonome : pas d'import dynamique ni de dépendance qui romprait le bundle IIFE. Pas de drapeau global d'idempotence : `connectContent` pingue d'abord et n'injecte que si personne ne répond.
- Validation des `unknown` : utiliser les gardes de `packages/shared/src/guards.ts` (`isRecord`, `isNonEmptyString`, `isFiniteNumber`), pas de garde locale.
- Nouveau type d'étape : l'étendre dans `WorkflowStep`, dans `parseStep` et dans `HANDLERS` (executor). La compilation échoue si un handler manque.
- Pages de l'extension : Chrome injecte une feuille par défaut (`body { font-size: 75% }`). La typographie se déclare sur `body`.
- Pas de `console.log` de debug commité. `console.error` préfixé `[FlowPilot]` pour les erreurs inattendues.

## Secrets and boundaries

- Aucun secret au Sprint 1 : pas de backend, pas de clé d'API.
- Jamais collectés ni stockés : mots de passe, cookies, jetons, données de paiement, contenu des champs sensibles.
- Permissions : `sidePanel`, `storage`, `scripting` + `optional_host_permissions` par domaine. **Toute nouvelle permission doit être justifiée dans `docs/architecture.md`.** `<all_urls>`, `tabs`, `webRequest` et `cookies` sont exclus sans décision explicite.
- Le contenu des pages web est une donnée non fiable : jamais exécuté, jamais interprété comme une instruction.
- Détails : `SECURITY.md`.

## Documentation routing

- Vision produit / périmètre : `PRODUCT.md`.
- Conventions de contribution : `CONTRIBUTING.md`.
- Limites de sécurité : `SECURITY.md`.
- Architecture et décisions : `docs/architecture.md`.
- Guide de contexte global : `crew/CLAUDE_CONTEXT/AGENTS.md`.
