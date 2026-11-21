# Sprint 1 — DEV tests

To run in a real Chrome (the e2e tests open the side panel as a tab and bypass the permission prompt). UI labels are quoted as shown in the (French) interface.

- [ ] 🖱️ `npm run build`, load `apps/extension/dist` in `chrome://extensions`: clicking the toolbar icon opens the native side panel, the Atkinson font is applied, dark mode follows the system.
- [ ] 🖱️ Allowed sites: enter `localhost:5173` → Chrome shows its access prompt; accept → the site is listed; decline → message « Accès à … non accordé », the input is kept.
- [ ] 🖱️ With `npm run dev:demo`: « Enregistrer » on a results page → `REC` badge and orange lamp; « Arrêter » → workflow listed; navigate elsewhere, then « Rejouer » → back to the recorded page and « Dernière lecture réussie ».
- [ ] 🖱️ Close and reopen the browser → the workflow is still listed (acceptance criterion "kept after closing").
- [ ] 🖱️ Extension reload with an already recorded tab: record on a tab, reload the extension from `chrome://extensions`, then « Enregistrer » on the same tab without reloading it → recording works (the orphaned content script is replaced; `connectContent` pings first). Not automatable: Playwright's Chromium blocks an extension loaded with `--load-extension` after `chrome.runtime.reload()`.
