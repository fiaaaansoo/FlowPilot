# FlowPilot

Extension Chrome open source qui enregistre une procédure réalisée dans le navigateur, puis la rejoue. À terme, un agent IA prendra le relais quand l'interface d'un site aura changé.

> **État : Sprint 1.** L'extension s'installe, le Side Panel pilote l'enregistrement et le replay de bout en bout, et le site de démonstration tourne en local. Un enregistrement capture pour l'instant **uniquement la page de départ**. Les clics et saisies arrivent au Sprint 2, l'agent de récupération au Sprint 3. Voir [Feuille de route](#feuille-de-route).

## Démarrage rapide

Prérequis : Node.js **22.22.2+** ou **24.15+** (exigence de jsdom, utilisé par les tests), npm 10+, Chrome 120+.

```bash
npm install
npm run build              # → apps/extension/dist/ et apps/demo-site/dist/
npm run dev:demo           # site de démo sur http://localhost:5173
```

Charger l'extension :

1. Ouvrir `chrome://extensions` et activer le **mode développeur**.
2. Cliquer sur **Charger l'extension non empaquetée** et choisir `apps/extension/dist`.
3. Cliquer sur l'icône FlowPilot : le Side Panel s'ouvre.

Essayer :

1. Dans **Sites autorisés**, saisir `localhost:5173`, cliquer sur **Autoriser** et accepter la demande de Chrome.
2. Ouvrir `http://localhost:5173`, lancer une recherche.
3. Cliquer sur **Enregistrer**, puis **Arrêter** : le workflow apparaît dans la liste.
4. Naviguer ailleurs, puis cliquer sur **Rejouer** : l'onglet revient à la page enregistrée, et le résultat s'affiche sous le workflow.

Développement de l'extension en continu : `npm run dev:extension` recompile `dist/` (content script compris) à chaque modification. Il faut ensuite recharger l'extension dans `chrome://extensions`.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run lint` | ESLint (typescript-eslint strict, règles React hooks) |
| `npm run typecheck` | `tsc` sur la racine et chaque workspace |
| `npm test` | Vitest : logique partagée, contrôleur, executor, stockage, Side Panel (jsdom), site de démo |
| `npm run test:e2e` | Build de l'extension puis Playwright : le `dist/` distribué, chargé dans Chromium, + site de démo |
| `npm run build` | Build de l'extension et du site de démo |
| `npm run check` | lint + typecheck + tests + build (identique à la CI) |

Première exécution des tests e2e : `npx playwright install chromium`.

## Structure

```text
apps/
  extension/        Extension Chrome MV3 (React + Vite)
    manifest.json   Source du manifest (version injectée au build)
    src/background/ Service worker : SessionController + adaptateur Chrome
    src/content/    Content script injecté à la demande (handshake)
    src/sidepanel/  Interface React du Side Panel
    src/recorder/   Construction des workflows enregistrés
    src/executor/   Exécution séquentielle des étapes
    src/storage/    Accès typé à chrome.storage (session / local)
  demo-site/        Site d'emploi fictif (recherche → résultats → offre)
packages/
  shared/           Types et logique pure : messages, machine d'état, schéma de workflow
tests/e2e/          Tests Playwright
docs/               Architecture et décisions
crew/               Suivi des tâches (backlog, en cours, historique)
```

L'architecture et ses choix sont détaillés dans [docs/architecture.md](docs/architecture.md).

## Sécurité

- **Aucun accès aux sites par défaut.** Les permissions d'hôte sont optionnelles et accordées domaine par domaine depuis le Side Panel. Pas de `<all_urls>`, pas de permission `tabs`.
- Le content script n'est jamais déclaré dans le manifest : il est injecté à la demande, seulement sur un site autorisé.
- Les commandes ne sont acceptées que depuis les pages de l'extension. Un message venant d'une page web est ignoré.
- Toute donnée relue (stockage, messages) est validée à l'exécution. Un workflow d'une version inconnue est rejeté, jamais deviné.
- Ni `eval` ni code distant : compatible avec la CSP par défaut de Manifest V3.

## Feuille de route

| Sprint | Contenu | État |
| --- | --- | --- |
| 1 | Monorepo, MV3, Side Panel, site de démo, lint/tests/CI | ✅ |
| 2 | Capture clics/saisies (hors champs sensibles), sélecteurs multiples, replay multi-pages | à venir |
| 3 | Backend FastAPI, grounding, agent de récupération | à venir |
| 4 | Scénarios de changement d'UI, évaluation A/B/C, mesures | à venir |

Le détail des tâches se trouve dans `crew/TODO/`.

## Licence

MIT, voir [LICENSE](LICENSE).
