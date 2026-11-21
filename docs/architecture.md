# Architecture de FlowPilot

État au Sprint 1. Ce document décrit les frontières entre modules et les choix qui les justifient. Les modules à venir (grounding, recovery agent, mémoire) s'y brancheront sans refonte.

## Vue d'ensemble

```text
┌──────────── Side Panel (React) ────────────┐
│ lit : chrome.storage + permissions         │
│ écrit : rien (envoie des Command)          │
│ demande les permissions d'hôte (geste UI)  │
└───────────────┬────────────────────────────┘
                │ chrome.runtime.sendMessage(Command)
                ▼
┌──────────── Service worker ────────────────┐
│ SessionController (seul écrivain)          │
│  ├─ machine d'état (packages/shared)       │
│  ├─ recorder  → brouillon de workflow      │
│  ├─ executor  → StepDriver                 │
│  └─ stores    → chrome.storage.session/local│
│ BrowserEnv = adaptateur chrome.* (injecté) │
└───────────────┬────────────────────────────┘
                │ chrome.scripting.executeScript + tabs.sendMessage
                ▼
┌──────────── Content script (IIFE) ─────────┐
│ Sprint 1 : handshake ping/pong             │
│ Sprint 2 : capture et actions dans la page │
└────────────────────────────────────────────┘
```

## Décisions

### 1. Un seul écrivain : le service worker

Le Side Panel n'écrit jamais l'état de session. Il envoie des commandes typées (`packages/shared/src/messages.ts`) et se redessine sur `chrome.storage.onChanged`. Le panneau peut être fermé, rouvert ou ouvert dans plusieurs fenêtres sans divergence. Le `SessionController` sérialise les commandes dans une file : un double-clic ne lance pas deux enregistrements.

Exception assumée : `chrome.permissions.request` doit être appelé depuis une page, dans le geste utilisateur. Le Side Panel gère donc lui-même les permissions d'hôte.

### 2. Machine d'état pure et partagée

`idle → recording → idle` et `idle → replaying → idle`. La machine vit dans `packages/shared/src/session.ts`, sans dépendance à Chrome. Le service worker l'applique, le Side Panel en dérive les boutons actifs (`availableCommands`). Une transition invalide renvoie une erreur explicite (`INVALID_TRANSITION`), jamais une exception silencieuse.

### 3. État volatil et état persistant séparés

| Zone | Contenu | Pourquoi |
| --- | --- | --- |
| `chrome.storage.session` | session, brouillon, dernier run | Survit aux redémarrages du service worker (MV3 le tue après inactivité). Effacé à la fermeture du navigateur. Inaccessible aux content scripts. |
| `chrome.storage.local` | workflows | Doit survivre à la fermeture de l'extension et du navigateur (critère d'acceptation). |

Au redémarrage du worker, `recover()` reprend un enregistrement tel quel. Un replay orphelin, dont la boucle vivait en mémoire, est marqué en échec et la session est libérée. L'extension ne reste jamais bloquée en « lecture ».

### 4. Dépendances Chrome injectées

`SessionController` reçoit un `BrowserEnv` (onglet actif, permissions, injection, navigation, badge) et des stores construits sur une interface `KeyValueArea`. En production : `chrome-env.ts` et `chromeArea`. En test : `FakeEnv` et `memoryArea`. Toute la logique (permissions refusées, double-clic, arrêt pendant un replay, redémarrage du worker) est testée sans navigateur. Playwright valide ensuite l'intégration réelle.

### 5. Executor indépendant du LLM

`runWorkflow(workflow, driver, { signal })` exécute les étapes dans l'ordre, s'arrête à la première en échec et renvoie un `RunSummary` (`stepIndex`, code, message) : l'étape échouée est toujours identifiée. Chaque type d'étape a son handler dans une table typée : ajouter un `kind` au schéma sans son handler ne compile pas. Le Recovery Agent (Sprint 3) s'insérera entre l'échec d'une étape et l'arrêt du run, derrière la même interface `StepDriver`.

### 6. Schéma de workflow versionné dès le départ

`schemaVersion: 1`. Toute lecture passe par `parseWorkflow`, qui reconstruit un objet typé champ par champ : les champs inconnus sont ignorés, les versions et types d'étape inconnus sont rejetés, seules les URL `http(s)` sont acceptées. Une entrée corrompue n'empêche pas de lire les autres (`invalidCount`, affiché dans le panneau).

### 7. Permissions minimales

- `permissions` : `sidePanel`, `storage`, `scripting`. Rien d'autre.
- `optional_host_permissions` : `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`. Aucun hôte n'est accordé à l'installation. L'utilisateur autorise un domaine, et Chrome affiche sa propre confirmation.
- Pas de permission `tabs` : l'URL d'un onglet n'est visible que sur un site autorisé. Le contrôleur s'en sert comme test d'autorisation, et une URL masquée produit `ORIGIN_NOT_ALLOWED`.
- Le content script n'est pas déclaré dans le manifest. Il est injecté à la demande par `chrome.scripting`, et vérifié par un handshake versionné (`PROTOCOL_VERSION`). L'idempotence se joue côté service worker : `connectContent` pingue d'abord et n'injecte que si personne ne répond. Un script orphelin, laissé par une version précédente de l'extension après rechargement ou mise à jour, ne répond plus et ne bloque donc jamais le nouveau.
- Les commandes ne sont acceptées que si `sender.url` est une page de l'extension. Un content script, et donc une page web, ne peut pas piloter la session.

### 8. Build : un build principal qui déclenche celui du content script

Le service worker est un module ES (`"type": "module"`), qui peut partager des chunks avec le Side Panel. Le content script, injecté via `executeScript({ files })`, doit être un script classique autonome : il ne peut pas partager de chunks, il est donc compilé en IIFE par `vite.content.config.ts`. Le plugin `flowpilot-content-script` lance ce second build après chaque build principal, watch compris : `vite build` et `vite build --watch` produisent toujours un `dist/` complet. Le manifest est émis par un autre plugin, qui injecte la version du `package.json`.

Les tests e2e chargent **le `dist/` distribué** : la fixture Playwright le copie dans un dossier temporaire et n'ajoute `host_permissions: ["http://localhost/*"]` qu'au manifest de la copie, car Playwright ne peut pas valider la boîte de dialogue de permission. Le code testé est celui qui est livré.

## Pistes pour les sprints suivants

- **Sprint 2** : `recorder/` reçoit des événements du content script (clic, saisie, navigation) et les ajoute au brouillon. Les champs sensibles (`type=password`, `autocomplete=cc-*`, etc.) sont filtrés côté content script, avant tout envoi. `WorkflowStep` gagne `click` et `input`, avec un `ElementTarget` multi-indices (rôle, nom accessible, texte, attributs, sélecteur CSS).
- **Sprint 3** : `apps/api` (FastAPI, Pydantic). Le contexte DOM envoyé au modèle est réduit et marqué comme donnée non fiable. Les actions proposées sont validées contre une liste fermée d'outils avant exécution, sans aucun JavaScript arbitraire.
- **Sprint 4** : variantes d'interface du site de démo et banc d'évaluation A/B/C.

## Limites connues (Sprint 1)

- Un enregistrement ne capture que la page de départ.
- Le replay agit sur l'onglet actif de la dernière fenêtre utilisée.
- Une navigation qui ne déclenche pas de chargement (changement d'ancre seul) n'est pas détectée comme terminée : délai de 15 s, puis échec explicite.
- Un replay ne survit pas à un redémarrage du service worker : il est marqué en échec, sans reprise automatique.
- Pas d'icône dédiée : Chrome affiche son icône par défaut.
