# Sprint 1 — tests DEV

À faire dans un vrai Chrome (les e2e ouvrent le Side Panel comme un onglet et contournent la boîte de dialogue de permission).

- [ ] 🖱️ `npm run build`, charger `apps/extension/dist` dans `chrome://extensions` : clic sur l'icône → le Side Panel natif s'ouvre, police Atkinson appliquée, mode sombre suivant le système.
- [ ] 🖱️ Sites autorisés : saisir `localhost:5173` → Chrome affiche sa demande d'accès ; accepter → le site apparaît ; refuser → message « Accès à … non accordé », saisie conservée.
- [ ] 🖱️ Avec `npm run dev:demo` : Enregistrer sur une page de résultats → badge `REC` et voyant orange ; Arrêter → workflow listé ; naviguer ailleurs puis Rejouer → retour à la page enregistrée et « Dernière lecture réussie ».
- [ ] 🖱️ Fermer puis rouvrir le navigateur → le workflow est toujours listé (critère « conservé après fermeture »).
