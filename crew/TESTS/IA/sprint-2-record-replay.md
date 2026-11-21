# Sprint 2 — tests IA

Non couverts par la suite automatique (durées réelles du service worker MV3, trop longues pour la CI).

- [ ] 🤖 Attente de confirmation de plus de 45 s avec le Side Panel ouvert (Playwright, build distribué) : le replay reprend après « Confirmer et exécuter » (keepalive du panneau).
- [ ] 🤖 Même attente, Side Panel fermé : au-delà de ~30 s le worker s'arrête ; à la réouverture du panneau, le run est marqué en échec (« service worker redémarré ») et la session est libre.
- [ ] 🤖 Enregistrement interrompu par un arrêt forcé du service worker (CDP `ServiceWorker.stopAllWorkers`) entre deux clics : les clics suivants sont toujours capturés et le workflow est complet à l'arrêt.
