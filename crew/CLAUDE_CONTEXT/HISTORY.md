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
Key files/commits: b27fec5 (scaffold crew), d325456 (Sprint 1). Limites connues : docs/architecture.md § Limites.
Tests: checklists crew/TESTS/IA/sprint-1-extension-scaffold.md (filtre d'origine des messages, rechargement d'extension, arrêt pendant navigation) et crew/TESTS/DEV/sprint-1-extension-scaffold.md (Side Panel natif, dialogue de permission, persistance après redémarrage). Couvert par ailleurs : 115 tests Vitest + 6 e2e Playwright.

## sprint-2-record-replay — 2026-11-21
What: Sprint 2 FlowPilot, recorder et moteur de workflow déterministes, sans IA. Branche `feat/sprint-2-recorder`.
- Schéma v2 (navigate, waitForNavigation, click, input, manualInput, select, check, press, submit), cibles multi-indices (`ElementTarget` : rôle, nom, attributs stables, texte, contexte de ligne, CSS), migration v1.
- Capture dans la page (`isTrusted` uniquement), champs sensibles réduits à `manualInput` avant tout envoi, actions irréversibles marquées `confirm`.
- Compilation pure des événements (`compileSteps`) : ordre chronologique, fusion des saisies, classement des navigations (fenêtre 3 s + `beforeunload`), redirections. SPA via `tabs.onUpdated`. Content script enregistré dynamiquement pendant l'enregistrement (`registerContentScripts`, `document_end`) + `content/hello`.
- Grounding déterministe : indices forts puis contexte de ligne ; CSS et texte jamais pour départager ; ambiguïté = `TARGET_AMBIGUOUS`.
- Replay : attentes d'URL tolérantes (`urlMatches`), vérification des effets, timeouts, arrêt propagé jusque dans la page (`content/cancel`), journal par étape (`RunSummary.log`, `RunStore`), intervention humaine (`awaitingHuman`, `replay/continue`), confirmation rejugée dans la page (`CONFIRMATION_REQUIRED`), keepalive du panneau.
- Side Panel : étapes et statuts par étape, aperçu en direct, invite de confirmation. Site de démo : `spa.html`, boutons homonymes.
Décisions : TS conservé à 6.0 ; URL assainies (`sanitizeUrl`) avant stockage ; contexte de ligne enregistré seulement s'il y a des homonymes ; pas de fusion des doubles-clics (fidélité aux gestes).
Revue : revue indépendante (1 critique, 7 importants, 4 mineurs, tous corrigés) puis contre-vérification (1 trou I2 + 1 régression href + 3 mineurs, corrigés). Passe `simplify` non relancée : la consigne du sprint excluait les refactorings sans bénéfice concret.
Key files/commits: 1654eaa (feat), 1d031ad (fix review), d080251 (docs). Préparation Sprint 3 : docs/architecture.md § Préparation du Sprint 3.
Tests: 248 Vitest + 15 e2e Playwright sur le build distribué, tous passés. Checklists : crew/TESTS/IA/sprint-2-record-replay.md (durée de vie réelle du service worker) et crew/TESTS/DEV/sprint-2-record-replay.md (Side Panel natif, site réel).
