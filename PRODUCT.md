# PRODUCT.md — FlowPilot

## Vision

Transformer une démonstration humaine dans le navigateur en automatisation web réutilisable, assez robuste pour survivre aux changements d'interface grâce à un agent de récupération.

## Target user

Une personne qui répète la même procédure sur un site (rechercher des offres d'emploi avec les mêmes filtres, remplir un formulaire récurrent) et veut la rejouer sans écrire de script. C'est aussi un projet personnel d'ingénierie open source : le code, les tests et les évaluations font partie du produit.

## Current scope

Sprint 1, livré :

- Extension Chrome MV3 installable localement, Side Panel avec Enregistrer, Arrêter et Rejouer.
- Autorisation des sites domaine par domaine depuis le panneau.
- Un enregistrement capture la page de départ ; le replay y renavigue et vérifie que la page répond.
- Workflows persistés (schéma v1), dernier résultat d'exécution affiché avec l'étape en échec.
- Site de démonstration local (recherche d'emploi fictive, 3 pages).

## Out of scope (explicitly)

- **Collecte de données sensibles** (mots de passe, cookies, jetons, paiement) : jamais, quel que soit le sprint.
- **Actions irréversibles sans confirmation** (paiement, publication, suppression, envoi) : toujours derrière une confirmation humaine explicite.
- **JavaScript arbitraire proposé par un modèle** : jamais exécuté. Les actions passent par une liste fermée d'outils validés.
- **LLM obligatoire** : le moteur doit fonctionner sans LLM ni service payant ; l'agent n'est qu'une couche de récupération.
- **Accès global aux sites** (`<all_urls>`) : refusé, l'accès reste par domaine.
- Contournement des vérifications humaines (CAPTCHA) et automatisation des pages protégées de Chrome : hors périmètre.
