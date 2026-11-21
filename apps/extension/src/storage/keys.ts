/**
 * Clés de stockage, partagées entre le service worker (seul écrivain) et le
 * Side Panel (lecture + écoute de `chrome.storage.onChanged`).
 *
 * - `chrome.storage.session` : état volatil (session, brouillon d'enregistrement),
 *   effacé à la fermeture du navigateur, inaccessible aux content scripts.
 * - `chrome.storage.local` : workflows et historique des exécutions.
 */
export const SESSION_KEYS = {
  session: 'flowpilot.session',
  draft: 'flowpilot.draft',
} as const;

export const LOCAL_KEYS = {
  workflows: 'flowpilot.workflows',
  runs: 'flowpilot.runs',
} as const;

/**
 * AI recovery settings (backend URL, token, autonomy mode). Written by the side
 * panel (configuration, not session state), read by the service worker.
 */
export const AI_SETTINGS_KEY = 'flowpilot.ai';
