# Architecture de FlowPilot

État au Sprint 2 (recorder et moteur de workflow déterministes, sans IA). Ce document décrit les frontières entre modules et les choix qui les justifient. Les modules à venir (grounding sémantique, Recovery Agent, mémoire, évaluation) s'y brancheront sans refonte : voir [Préparation du Sprint 3](#préparation-du-sprint-3).

## Vue d'ensemble

```text
┌──────────── Side Panel (React) ─────────────┐
│ lit : chrome.storage + permissions          │
│ écrit : rien (envoie des Command)           │
│ demande les permissions d'hôte (geste UI)   │
│ keepalive du SW pendant un replay           │
└───────────────┬─────────────────────────────┘
                │ Command (record/start, session/stop, replay/start, replay/continue…)
                ▼
┌──────────── Service worker ─────────────────┐
│ SessionController (seul écrivain)           │
│  ├─ machine d'état (packages/shared)        │
│  ├─ recorder  → brouillon d'événements      │
│  │              → compileSteps (shared)     │
│  ├─ executor  → StepDriver (navigate, wait, │
│  │              perform, requestHuman)      │
│  └─ stores    → session / workflows / runs  │
│ tabs.onUpdated → navigations (SPA comprises)│
│ BrowserEnv = adaptateur chrome.* (injecté)  │
└───────┬───────────────────────▲─────────────┘
        │ content/ping, record, │ recorder/event (capture)
        │ perform               │ content/hello (dois-je capturer ?)
        ▼                       │
┌──────────── Content script (IIFE, frame principale) ─┐
│ InteractionCapture : gestes isTrusted, filtre        │
│   des champs sensibles AVANT tout envoi              │
│ grounding : describeElement / resolveTarget          │
│ performStep : actions DOM prédéfinies + vérification │
└──────────────────────────────────────────────────────┘
```

## Décisions

### 1. Un seul écrivain : le service worker

Le Side Panel n'écrit jamais l'état de session. Il envoie des commandes typées (`packages/shared/src/messages.ts`) et se redessine sur `chrome.storage.onChanged`. Le `SessionController` sérialise **commandes et événements** dans une file : un double-clic ne lance pas deux enregistrements, deux événements de capture n'écrasent pas le brouillon l'un de l'autre.

Exception assumée : `chrome.permissions.request` doit être appelé depuis une page, dans le geste utilisateur. Le Side Panel gère donc lui-même les permissions d'hôte.

### 2. Machine d'état pure et partagée

```text
idle ──RECORD_STARTED──▶ recording ──STOPPED──▶ idle
idle ──REPLAY_STARTED──▶ replaying ──STOPPED | REPLAY_FINISHED──▶ idle
replaying ──HUMAN_REQUESTED──▶ replaying (awaitingHuman) ──HUMAN_RESOLVED──▶ replaying
```

`packages/shared/src/session.ts`, sans dépendance Chrome. Une transition invalide renvoie `INVALID_TRANSITION`, jamais une exception silencieuse.

### 3. État volatil et état persistant séparés

| Zone | Contenu | Pourquoi |
| --- | --- | --- |
| `chrome.storage.session` | session, brouillon d'enregistrement | Survit aux redémarrages du service worker. Effacé à la fermeture du navigateur. Inaccessible aux content scripts. |
| `chrome.storage.local` | workflows, historique des runs (50 derniers) | Doit survivre à la fermeture de l'extension et du navigateur. Base de la future mémoire et de l'évaluation. |

Au redémarrage du worker, `recover()` reprend un enregistrement tel quel (brouillon et capture persistent). Un replay orphelin, dont la boucle vivait en mémoire, est marqué en échec et la session est libérée.

### 4. Dépendances Chrome injectées

`SessionController` reçoit un `BrowserEnv` et des stores construits sur `KeyValueArea`. En production : `chrome-env.ts` et `chromeArea`. En test : `FakeEnv` et `memoryArea`. Toute la logique (permissions, onglets, confirmations, arrêts, redémarrages) est testée sans navigateur ; Playwright valide ensuite l'intégration réelle sur le build distribué.

### 5. Enregistrement en deux temps : capture brute, compilation pure

1. **Capture.** Le content script émet des `RecordedEvent` horodatés ; le service worker ajoute des `NavigationEvent` observés via `tabs.onUpdated` (`changeInfo.url` couvre aussi `history.pushState`, donc les SPA). Tout est stocké brut dans le brouillon (1 000 événements au plus).
2. **Compilation.** `compileSteps` (`packages/shared/src/recording.ts`, pure) trie par horodatage, puis :
   - fusionne les saisies successives dans le même champ (et sélections, cases) ;
   - réduit un double-clic à un clic ;
   - garde tous les clics, même rapprochés (deux clics sur « + » en sont deux) ;
   - ignore une navigation vers l'URL courante (rechargement) ;
   - fusionne les navigations rapprochées (chaîne de redirections) ;
   - classe une navigation `waitForNavigation` si elle est causée par une interaction : moins de 3 s après, ou plus tard si la page a signalé son départ (`beforeunload`) juste après l'interaction (formulaire lent) ; `navigate` sinon (URL saisie, historique).

Le tri par horodatage règle la course entre le message de clic (content script) et l'événement de navigation (service worker) : l'ordre d'arrivée n'a pas d'importance. Le Side Panel compile le même brouillon pour afficher les étapes en direct.

**Ce que la capture retient** : uniquement les événements `isTrusted` (un script de la page ne peut pas fabriquer d'étape) ; clics ramenés à l'élément interactif le plus proche, ou à défaut au plus haut ancêtre affiché comme cliquable (`cursor: pointer`) — les clics de mise au focus, sur une case ou son label, et sur du texte inerte sont ignorés ; saisies émises à la validation (`change`) ou avant toute action qui peut quitter la page ; Entrée : soumission (`submit`) seulement sans bouton déclencheur, sinon étape `press` transmise aux scripts de la page (recherche d'application monopage).

**Confidentialité à la capture** : la valeur d'un champ, d'une liste ou d'une case sensibles n'est jamais lue (étape `manualInput`). Les URL (page de départ, navigations, `href` des liens) sont assainies avant tout stockage : paramètres de type jeton, code, session, signature et fragments `#…=` (OAuth) sont retirés.

**Réinjection.** Pendant un enregistrement, le content script est enregistré dynamiquement (`chrome.scripting.registerContentScripts`, domaine enregistré uniquement, `document_end`, non persistant) : il est présent dès le chargement de chaque page, sans attendre le chargement complet. Au démarrage, il demande au service worker (`content/hello`) s'il doit capturer : seul l'onglet enregistré répond oui. L'enregistrement dynamique est retiré à l'arrêt, et au démarrage du worker si aucune session n'est active.

### 6. Schéma de workflow v2

`schemaVersion: 2`, étapes typées : `navigate`, `waitForNavigation`, `click`, `input`, `manualInput`, `select`, `check`, `submit`. Les étapes d'interaction portent une `ElementTarget` multi-indices :

| Indice | Exemple | Fiabilité |
| --- | --- | --- |
| `attributes` (data-testid, id non généré, name, aria-label, placeholder, type, href, value des cases) | `{ name: 'contrat', type: 'checkbox', value: 'CDI' }` | forte |
| `role` + `name` (nom accessible) | `button` / « Rechercher » | forte |
| `css` (sélecteur unique à l'enregistrement) | `#search > button` | fragile (structure) |
| `text` (texte visible) | « Sauvegarder » | fragile (contenu) |

S'y ajoute `context` : le texte de la ligne qui contient l'élément (élément de liste, rangée, carte), enregistré seulement quand d'autres éléments de la page ont le même rôle et le même nom. Il départage des boutons identiques (« Supprimer l'alerte ») sans dépendre de leur position, et il est affiché dans les invites de confirmation pour savoir quelle ligne est visée.

Toute lecture passe par `parseWorkflow`, qui reconstruit l'objet champ par champ, borne les tailles, rejette les types et versions inconnus et migre les workflows v1. Les ids générés par les frameworks (`:r1:`, `ember123`, hash) ne sont pas retenus comme indices.

### 7. Grounding déterministe, qui refuse l'ambiguïté

`resolveTarget` (`apps/extension/src/grounding/resolve.ts`) ne garde que des candidats **visibles** et sépare deux familles d'indices :

1. **Indices forts** (identifiant de test, id, rôle + nom, attributs) : ceux qui ne trouvent rien sont ignorés, l'élément retenu est dans l'intersection des autres ; s'ils divergent, `TARGET_AMBIGUOUS`.
2. **Plusieurs candidats forts** : départagés uniquement par la ligne (`context`) ; jamais par la position (CSS) ni le texte, qui désigneraient l'élément situé au même endroit après l'insertion ou la suppression d'une ligne. Ligne disparue → `TARGET_NOT_FOUND`.
3. **Indices fragiles** (CSS, texte) : utilisés seuls uniquement si la cible n'avait aucun indice fort. Si elle en avait et qu'ils ne trouvent plus rien, l'élément a changé : `TARGET_NOT_FOUND` (cas que traitera le Recovery Agent), plutôt qu'un clic sur ce qui occupe sa place.

Rien de visible → `TARGET_NOT_INTERACTABLE` (présent mais masqué) ou `TARGET_NOT_FOUND`. `waitForTarget` réessaie jusqu'à 10 s (éléments chargés en différé), sauf ambiguïté, renvoyée tout de suite ; l'arrêt du replay interrompt l'attente.

### 8. Replay : executor indépendant, effets vérifiés

`runWorkflow` exécute les étapes dans l'ordre via un `StepDriver`, ne rejette jamais (toute exception devient un échec d'étape) et produit un `RunSummary` avec un **journal par étape** (statut, durée, stratégie de grounding, code et message d'erreur). Chaque type d'étape a son handler dans une table typée : un `kind` sans handler ne compile pas.

- `navigate` / `waitForNavigation` : l'état de l'onglet est interrogé (`status: complete`, 15 s max) plutôt qu'écouté, ce qui évite toute course avec une navigation déjà terminée. L'URL est comparée par `urlMatches` : même origine et même chemin, paramètres enregistrés identiques sauf paramètres volatils (suivi, horodatage) ou secrets, fragment pris en compte seulement pour le routage `#/`. Puis le content script doit répondre depuis la bonne origine.
- Interactions : `performStep` dans la page, via les setters natifs + événements `input`/`change` (compatibles React/Vue), puis vérification de l'effet (valeur conservée, case cochée, option existante). Avant un clic ou une soumission, la page répond au service worker, puis agit : un port fermé signifie qu'elle a disparu **avant** d'agir, c'est un échec.
- Arrêt : un `AbortSignal` traverse l'executor, les attentes et les actions ; le service worker envoie aussi `content/cancel`, pour que la page n'agisse pas quand l'élément attendu finit par apparaître. Un nouveau replay est refusé tant que le précédent n'a pas fini son étape. Un échec provoqué par l'arrêt est journalisé `aborted`, pas `failed`.

### 9. Intervention humaine (human-in-the-loop)

Deux cas suspendent le replay avant l'étape (`awaitingHuman`), le Side Panel affiche une invite :

- **action potentiellement irréversible** (`confirm: true`, posé à la capture par une heuristique large : envoyer, payer, supprimer, publier, postuler, confirmer…) : rien n'est exécuté sans « Confirmer et exécuter » ;
- **champ sensible** (`manualInput`) : la valeur n'a jamais été enregistrée ; l'utilisateur la saisit dans la page puis continue, et FlowPilot vérifie seulement que le champ n'est plus vide.

Défense en profondeur : au moment d'agir, la page rejuge l'élément **effectivement trouvé**. S'il paraît irréversible alors que l'étape n'était pas marquée (heuristique d'enregistrement prise en défaut, mauvais élément), elle refuse (`CONFIRMATION_REQUIRED`) ; l'executor demande alors l'accord humain et réessaie une seule fois.

Pendant un replay, le Side Panel envoie un `session/get` toutes les 20 s : le service worker MV3 serait sinon arrêté après ~30 s d'inactivité pendant une attente de confirmation.

### 10. Permissions minimales et provenance des messages

- `permissions` : `sidePanel`, `storage`, `scripting`. Rien d'autre (vérifié par `manifest.test.ts`).
- `optional_host_permissions` : `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`. Aucun hôte à l'installation ; accès accordé domaine par domaine.
- Pas de permission `tabs` ni `webNavigation` : l'URL d'un onglet n'est visible que sur un site autorisé. Les navigations hors des sites autorisés ne sont ni vues ni enregistrées.
- **Commandes** : acceptées seulement si `sender.url` est une page de l'extension.
- **Événements de capture** : acceptés seulement depuis un content script de l'extension, frame principale (`frameId === 0`), et retenus seulement pour l'onglet en cours d'enregistrement. Chaque événement est revalidé (`parseRecordedEvent`), ses horodatages bornés.
- **Étapes envoyées à la page** : revalidées par le content script ; seules des actions DOM prédéfinies existent, aucun code reçu n'est évalué.

### 11. Build : un build principal qui déclenche celui du content script

Le service worker est un module ES, qui partage des chunks avec le Side Panel. Le content script doit être un script classique autonome : il est compilé en IIFE par `vite.content.config.ts`, lancé par le plugin `flowpilot-content-script` après chaque build principal, watch compris. Les tests e2e chargent **le `dist/` distribué** : la fixture Playwright le copie et n'ajoute `host_permissions` (localhost) qu'au manifest de la copie.

## Préparation du Sprint 3

| Brique | Point d'insertion existant |
| --- | --- |
| Recovery Agent | `runWorkflow` : un échec d'étape (`TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`, `VERIFICATION_FAILED`) est typé et journalisé ; l'agent s'insère entre l'échec et l'arrêt du run, derrière `StepDriver`, avec une limite de tentatives. |
| Tool Calling | Les actions possibles sont déjà une liste fermée (`ElementStep` + `performStep`) validée par `parseWorkflowStep` : l'agent proposera une étape typée, revalidée avant exécution, jamais du JavaScript. |
| Grounding sémantique | `resolveTarget` renvoie des codes distincts et les candidats par stratégie ; l'`ElementTarget` (rôle, nom, texte, attributs) est la description à rapprocher sémantiquement. |
| Context Engineering | `describeElement` / `accessibleName` produisent déjà une vue compacte et sans valeurs saisies d'un élément ; à étendre en résumé du DOM autour de la cible. |
| Prompt Injection Defense | Le contenu de la page n'entre que comme donnée (textes bornés, revalidés) ; les instructions de l'agent viendront du workflow et de l'extension, jamais de la page. |
| Mémoire des corrections | `RunStore` (historique borné, journaux par étape et stratégie) + workflows versionnés : une correction validée deviendra une mise à jour de l'`ElementTarget` (nouvelle version de schéma si nécessaire). |
| Prompt Caching | Le préfixe stable (consignes, schéma des outils, description du workflow) est séparé du contexte variable (DOM de l'étape) dans les messages construits côté backend. |
| Évaluation | `RunSummary.log` donne déjà réussite, étape en échec, durée et stratégie par étape ; il manque le coût (requêtes, tokens) et les variantes d'interface du site de démo (Sprint 4). |

## Limites connues (Sprint 2)

- Frame principale uniquement : les interactions dans des iframes ne sont ni capturées ni rejouées.
- Shadow DOM non parcouru par le grounding ; `contenteditable` non capturé.
- Pas de capture des glisser-déposer, survols, défilements, raccourcis clavier (hors Entrée) ni des téléversements de fichiers. Les clics sur des éléments sans rôle ni `cursor: pointer` sont ignorés.
- Les navigations vers un site non autorisé ne sont pas observables (pas de permission `tabs`) : le replay échouera explicitement à l'étape correspondante.
- `waitForNavigation` tolère les paramètres volatils connus, mais pas un identifiant dynamique dans le chemin (`/commande/12345`) ni un paramètre métier qui change à chaque visite.
- La classification `navigate` / `waitForNavigation` reste heuristique (fenêtre de 3 s et départ de page) : une URL saisie moins de 3 s après une interaction peut être prise pour une conséquence de celle-ci.
- Un élément dont les indices forts ont changé (libellé modifié) est déclaré introuvable : c'est volontaire, le Recovery Agent du Sprint 3 traitera ce cas.
- Un élément sans aucun indice fort ni texte (icône cliquable sans nom) n'est retrouvé que par son sélecteur CSS, donc par sa position.
- L'heuristique « irréversible » sur-confirme (« Annuler », « Mes commandes », « Order by ») : c'est le compromis choisi.
- Les paramètres d'URL `code` et `state` ne sont retirés qu'ensemble (retour OAuth) ; seuls, ce sont souvent des paramètres métier.
- Si la sauvegarde d'un workflow échoue (stockage plein), le brouillon est conservé, mais le prochain enregistrement le remplace : aucune reprise n'est proposée.
- L'heuristique « irréversible » est volontairement large (ex. « Postuler ») : quelques confirmations superflues.
- Le replay agit sur l'onglet actif de la dernière fenêtre utilisée et ne survit pas à un redémarrage du service worker (marqué en échec). Sans Side Panel ouvert, une attente de confirmation de plus de ~30 s peut être interrompue par l'arrêt du worker.
- Les workflows ne sont ni renommables ni modifiables depuis le panneau.
