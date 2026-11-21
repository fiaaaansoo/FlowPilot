# Sprint 2 — DEV tests

To run in a real Chrome, with the native side panel (the e2e tests open it as a tab). UI labels are quoted as shown in the (French) interface.

- [ ] 🖱️ `npm run build`, reload `apps/extension/dist`, `npm run dev:demo`: record search → offer → « Postuler » → submit; steps appear live; « Arrêter », then « Rejouer » from another page; confirm « Postuler » and « Envoyer la candidature »; result « Dernière lecture réussie ».
- [ ] 🖱️ `spa.html`: sign in (password) while recording, check that no password value appears in the panel; on replay, the « Saisie manuelle requise » prompt waits for the input.
- [ ] 🖱️ Create two alerts identical except for their keywords, record the deletion of the second one, create another alert above them, replay: the right row is deleted (confirmation prompt shows the row).
- [ ] 🖱️ On a real allowed site (public React or Vue application), record a search then replay it: the framework takes the typed value into account.
