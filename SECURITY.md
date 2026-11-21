# SECURITY.md — FlowPilot

## Secrets

- Sprint 1 : aucun secret (pas de backend, pas de clé d'API).
- À partir du Sprint 3 (backend + LLM) : clés uniquement en variables d'environnement côté `apps/api`, jamais dans l'extension (tout ce qui est empaqueté est lisible par l'utilisateur). `.env` est ignoré par git ; un `.env.example` sans valeur documentera les variables.
- Les clés ne sont jamais journalisées ni renvoyées au client.

## Auth boundaries

- Pas d'authentification utilisateur aux Sprints 1-2.
- Frontières internes de l'extension :
  - Seules les pages de l'extension (`sender.url` sous `chrome-extension://<id>/`) peuvent envoyer des commandes au service worker. Les messages des content scripts, donc des pages web, et des autres extensions sont ignorés.
  - Le content script n'accepte que les messages de sa propre extension et n'exécute jamais de code reçu.
  - `chrome.storage.session` (état de session) est inaccessible aux content scripts (niveau d'accès par défaut).
- Accès aux sites : aucun par défaut, permission optionnelle accordée domaine par domaine avec la confirmation native de Chrome, révocable depuis le Side Panel.

## Sensitive data / PII

- Jamais capturés : `input[type=password]`, champs `autocomplete` de paiement (`cc-*`) ou d'identifiants (`current-password`, `new-password`, `one-time-code`), champs dont le nom, l'id, le label ou le placeholder évoque un mot de passe, une carte, un IBAN, un code de vérification ou un jeton, et tout sous-arbre marqué `data-flowpilot-sensitive` / `data-private` / `data-sensitive`. Le filtrage a lieu dans le content script (`recorder/classify.ts`), **avant tout envoi** : la valeur n'est même pas lue, l'étape devient `manualInput`. Cookies, jetons et en-têtes ne sont jamais accessibles (aucune permission correspondante).
- Les valeurs des autres champs (texte de recherche, nom, e-mail…) sont enregistrées : c'est le but du replay. Les éléments eux-mêmes sont décrits par leur rôle, leur nom accessible et des attributs stables, jamais par leur valeur (sauf cases, radios et boutons, dont la valeur est un libellé).
- Les workflows et l'historique des runs restent en local (`chrome.storage.local`). Rien n'est envoyé à un serveur aux Sprints 1-2.
- Seuls les gestes réels (`isTrusted`) sont capturés ; les événements de capture ne sont acceptés que depuis la frame principale de l'onglet enregistré, puis revalidés.
- Contenu des pages = donnée non fiable : jamais interprété comme une instruction (défense contre l'injection de prompt dès le Sprint 3).

## Pre-production checklist

Avant toute publication sur le Chrome Web Store :

- [ ] Le build distribué ne contient pas `host_permissions` (vérifié par `apps/extension/src/manifest.test.ts` et l'e2e ; seule la copie temporaire des tests en ajoute).
- [ ] Permissions = `sidePanel`, `storage`, `scripting` + optionnelles par domaine. Toute autre est justifiée.
- [ ] Aucune source map ni `console.log` de debug dans `dist/`.
- [ ] Aucun `eval`, `new Function` ou code distant (CSP MV3 par défaut respectée).
- [ ] Politique de confidentialité publiée, même si aucune donnée ne quitte le navigateur.
- [ ] Backend (Sprint 3+) : CORS restreint à l'origine de l'extension, `/docs` FastAPI désactivé en production, rate limiting, validation Pydantic stricte des actions.
