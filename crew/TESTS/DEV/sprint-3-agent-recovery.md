# Sprint 3 — DEV tests

Need a human: the native Chrome permission prompt, the native side panel, a real paid API key.

Already verified by the AI on 2026-11-21, in Playwright Chromium with the shipped build (side panel opened as a tab, host access pre-granted on a test copy of the manifest): settings saved through the panel, « Tester la connexion » against the real backend with Ollama `qwen2.5:3b`, model proposal shown, confirmed, executed, replay finished, correction listed. Not covered there: the native permission prompt and the native side panel.

- [ ] 🖱️ Real Chrome, unpacked `apps/extension/dist`, backend started with `python -m flowpilot_api serve`: in the side panel, enable « Récupération IA », paste the token, « Enregistrer les réglages » → Chrome's prompt for `127.0.0.1` appears; accept → « Réglages enregistrés. », then « Tester la connexion » shows the provider. Refusing the prompt shows « Accès au service local non accordé. » and saves nothing.
- [ ] 🖱️ Same setup with Ollama `qwen2.5:3b`, in the native side panel: record the demo search, open `http://localhost:5173/?variante=synonymes`, replay → the proposal « Trouver des offres » is shown; confirm → the run succeeds; replay again → « correction mémorisée » without a prompt. « Corrections mémorisées » lists it and « Oublier » removes it.
- [ ] 🖱️ Native lifecycle: during a replay that waits for the model (stop Ollama's GPU or use `FLOWPILOT_MOCK_DELAY_MS=20000` with the mock provider), close the side panel and wait 60 s → nothing is clicked; reopen → the run shows as interrupted or stopped.
- [ ] 🖱️ Optional, billed, only with explicit approval: with a Claude Console API key (`FLOWPILOT_PROVIDER=anthropic`, `pip install -e ".[anthropic]"`), one recovery on `?variante=synonymes` succeeds and `GET /v1/metrics` shows a non-zero cost and cache-read tokens on a second recovery within 5 minutes.
