# Sprint 4 — DEV tests

Native Chrome checks for the Phase A fixes (2026-11-21). Playwright cannot reproduce a real idle stop of the worker nor drive the native side panel. Setup: `npm run build`, load or reload `apps/extension/dist` unpacked, `npm run dev:demo`, `localhost:5173` allowed.

- [ ] 🖱️ Idle worker during a recording: « Enregistrer » on `http://localhost:5173/`, close the side panel, type « python » in « Mots-clés », wait 60 s without touching anything, click « Rechercher ». Reopen the panel, « Arrêter »: the steps include « Cliquer sur « Rechercher » » and the replay succeeds. Optional: `chrome://serviceworker-internals` shows the worker still running during the 60 s.
- [ ] 🖱️ AI prompt warning: with the backend and Ollama `qwen2.5:3b` (see `crew/TESTS/DEV/sprint-3-agent-recovery.md`), replay a recorded « Supprimer » on a page variant where the label changed: the native panel's proposal prompt shows « Attention : Cette action semble irréversible. » above the model's rationale, and nothing is clicked before « Confirmer et exécuter ».
- [ ] 🖱️ Sensitive text: on a test page with `<td data-sensitive>FR76 …</td><td><button>Copier</button></td>` and a changed « Copier » label, trigger a recovery; the SQLite `recoveries` table (`apps/api/.data/flowpilot.sqlite3`) contains no « FR76 ».
