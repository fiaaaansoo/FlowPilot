# History of completed tasks

One entry per finished task (code complete): what, when, key files/commits.
Project context memory — do not summarize, keep the details that would help a
future session understand why a decision was made.

<!-- Example:
## <task slug> — YYYY-MM-DD
What: ...
Key files/commits: ...
-->

## sprint-1-extension-scaffold — 2026-11-21
What: Sprint 1 FlowPilot. Monorepo npm workspaces (packages/shared, apps/extension, apps/demo-site), extension Chrome MV3 + React 19 + Vite 8, Side Panel Enregistrer/Arrêter/Rejouer, site de démo (recherche d'emploi fictive, 3 pages, port 5173), ESLint strict, Vitest, Playwright, CI GitHub Actions, docs.
Décisions clés (détail : docs/architecture.md) :
- Service worker = seul écrivain de la session (SessionController, commandes sérialisées) ; Side Panel en lecture + Commands ; permissions d'hôte demandées depuis le panneau (geste utilisateur).
- Machine d'état pure partagée ; `CommandResponse = Result<SessionState>`.
- Permissions : sidePanel, storage, scripting + optional_host_permissions (https, localhost, 127.0.0.1). Pas de `tabs` : URL masquée = site non autorisé.
- Content script injecté à la demande, ping d'abord (pas de drapeau global → un script orphelin après rechargement ne bloque pas).
- Executor indépendant du LLM, table de handlers typée par `kind` ; ne rejette jamais (exception → échec d'étape).
- Build : le plugin `flowpilot-content-script` lance le build IIFE du content script après chaque build principal (watch compris). E2e = copie du dist/ distribué + host_permissions localhost sur la copie seulement.
- TypeScript 6.0 (typescript-eslint 8 ne supporte pas TS 7). Chrome injecte `body { font-size: 75% }` dans les pages d'extension → typo déclarée sur `body`.
Revue : requesting-code-review (0 critique, 6 importants corrigés : arrêt avant étape, `complete` d'un chargement antérieur + vérif origine du pong, script orphelin, watch qui effaçait content.js, permission rejetée silencieuse, live region bavarde) puis simplify (gardes partagées, failedRun, stores réutilisés par le panneau, build/e2e simplifiés).
Key files/commits: 864586a (scaffold crew), e864439 (Sprint 1). Limites connues : docs/architecture.md § Limites.
Tests: checklists crew/TESTS/IA/sprint-1-extension-scaffold.md (filtre d'origine des messages, rechargement d'extension, arrêt pendant navigation) et crew/TESTS/DEV/sprint-1-extension-scaffold.md (Side Panel natif, dialogue de permission, persistance après redémarrage). Couvert par ailleurs : 115 tests Vitest + 6 e2e Playwright.
