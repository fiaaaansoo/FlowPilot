# Sprint 1 — tests IA

Zones à risque non couvertes par un test automatisé au moment de la clôture.

- [ ] 🤖 Une page web autorisée ne peut pas piloter la session : depuis le content script (ou `chrome.runtime.sendMessage` exécuté dans le monde isolé), envoyer `{ type: 'record/start' }` → aucune réponse, session toujours `idle` (filtre `isFromExtensionPage`, `apps/extension/src/background/index.ts`).
- [ ] 🤖 Rechargement de l'extension avec un onglet déjà enregistré : recharger via `chrome.runtime.reload()` (ou rechargement de l'extension en e2e), puis Enregistrer sur le même onglet → succès sans recharger la page (script orphelin remplacé par `connectContent`, ping d'abord).
- [ ] 🤖 Arrêter pendant un replay en cours de navigation (page lente) → session `idle` immédiatement, dernier run `aborted`, aucune attente de 15 s.
