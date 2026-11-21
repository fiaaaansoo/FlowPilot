# Sprint 2 — AI tests

Not covered by the automatic suite at closure (real MV3 service worker durations). Automated on 2026-11-21 in `tests/e2e/hardening.spec.ts`. Playwright keeps an idle worker alive (measured: no stop in 50 s), so idle stops are simulated with CDP `ServiceWorker.stopAllWorkers`.

- [x] 🤖 A confirmation waiting more than 45 s with the side panel open: the replay resumes after « Confirmer et exécuter ». Test: "a confirmation waiting more than 45 s with the panel open still resumes the replay" (50 s wait).
- [x] 🤖 Same wait, side panel closed, worker stopped: on reopening the panel, the run is failed (« le service worker de l’extension a redémarré »), the session is idle and nothing was clicked. Test: "a confirmation pending when the worker stops (panel closed) is failed and frees the session".
- [x] 🤖 Recording interrupted by a forced worker stop between two interactions: the next click, which navigates, is still captured. This test found a real defect (the click was lost in 4 of 6 runs); fixed in `fix(recorder): keep a click that navigates when the worker was stopped` (recorder liveness port). Test: "a recording survives a forced worker stop between two interactions" (8/8 after the fix).
