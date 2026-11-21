/**
 * Clés de stockage, partagées entre le service worker (seul écrivain) et le
 * Side Panel (lecture + écoute de `chrome.storage.onChanged`).
 *
 * - `chrome.storage.session` : état volatil (session, brouillon, dernier run),
 *   effacé à la fermeture du navigateur, inaccessible aux content scripts.
 * - `chrome.storage.local` : workflows persistés.
 */
export const SESSION_KEYS = {
  session: 'flowpilot.session',
  draft: 'flowpilot.draft',
  lastRun: 'flowpilot.lastRun',
} as const;

export const LOCAL_KEYS = {
  workflows: 'flowpilot.workflows',
} as const;
