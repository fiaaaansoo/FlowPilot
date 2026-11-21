# Sprint 3 — DEV tests

Need a human (native Chrome permission prompt, a real paid API key).

- [ ] 🖱️ Real Chrome, unpacked `apps/extension/dist`, backend started with `python -m flowpilot_api serve`: in the side panel, enable « Récupération IA », paste the token, « Enregistrer les réglages » → Chrome's prompt for `127.0.0.1` appears; accept, then « Tester la connexion » shows the provider. Refusing the prompt shows « Accès au service local non accordé. » and saves nothing.
- [ ] 🖱️ Same setup with Ollama `qwen2.5:3b`: record the demo search, open `http://localhost:5173/?variante=synonymes`, replay → the step shows « récupération IA (modèle de langage) », the run succeeds; replay again → « correction mémorisée ». « Corrections mémorisées » lists it and « Oublier » removes it.
- [ ] 🖱️ Optional, billed: with a Claude Console API key (`FLOWPILOT_PROVIDER=anthropic`, `pip install -e ".[anthropic]"`), one recovery on `?variante=synonymes` succeeds and `GET /v1/metrics` shows a non-zero cost and cache-read tokens on a second recovery within 5 minutes.
