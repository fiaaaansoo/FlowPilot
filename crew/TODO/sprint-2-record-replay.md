# Sprint 2 — Enregistrement et replay

Zone : apps/extension/src/recorder/, apps/extension/src/executor/, apps/extension/src/content/, apps/extension/src/storage/, packages/shared/src/workflow.ts

Dépend de : sprint-1-extension-scaffold.

- [ ] Capture des clics et saisies autorisées dans le content script (exclusion password, autocomplete cc-*, champs marqués sensibles)
- [ ] Indices d'identification par élément : rôle, nom accessible, texte, attributs, sélecteur CSS
- [ ] Détection des navigations (réinjection du content script après chargement, étape `navigate`)
- [ ] Format workflow JSON v1 complété (étapes typées, validation stricte à la lecture, migration de version)
- [ ] Moteur d'exécution séquentiel : attentes, conditions de réussite, abort/reprise, journal d'exécution
- [ ] Étape échouée identifiée clairement dans le Side Panel
- [ ] Critère : workflow de 5 actions minimum rejoué sur le site de démo avec navigation entre 2 pages
