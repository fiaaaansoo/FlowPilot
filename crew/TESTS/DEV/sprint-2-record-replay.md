# Sprint 2 — tests DEV

À faire dans un vrai Chrome, avec le Side Panel natif (les e2e l'ouvrent comme un onglet).

- [ ] 🖱️ `npm run build`, recharger `apps/extension/dist`, `npm run dev:demo` : enregistrer recherche → offre → Postuler → envoi ; les étapes s'affichent en direct ; Arrêter puis Rejouer depuis une autre page ; confirmer « Postuler » et « Envoyer la candidature » ; résultat « Dernière lecture réussie ».
- [ ] 🖱️ `spa.html` : se connecter (mot de passe) pendant l'enregistrement, vérifier qu'aucune valeur de mot de passe n'apparaît dans le panneau ; au replay, l'invite « Saisie manuelle requise » attend la saisie.
- [ ] 🖱️ Créer deux alertes identiques sauf les mots-clés, enregistrer la suppression de la seconde, recréer une alerte au-dessus, rejouer : c'est bien la bonne ligne qui est supprimée (invite de confirmation avec la ligne affichée).
- [ ] 🖱️ Sur un site réel autorisé (application React ou Vue publique), enregistrer une recherche puis la rejouer : la saisie est prise en compte par le framework.
