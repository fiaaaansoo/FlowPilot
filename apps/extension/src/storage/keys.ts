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
  /** AI recovery settings (backend URL, token, autonomy mode): written by the panel, read by the worker. */
  ai: 'flowpilot.ai',
} as const;

export const AI_SETTINGS_KEY = LOCAL_KEYS.ai;
