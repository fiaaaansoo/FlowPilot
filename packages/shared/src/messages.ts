import { isNonEmptyString, isRecord } from './guards.js';
import type { Result } from './result.js';
import type { SessionState } from './session.js';

/**
 * Protocole de messages typé entre les contextes de l'extension.
 *
 * - `Command` : Side Panel → service worker (seul le SW modifie la session).
 * - `ContentRequest` : service worker → content script.
 *
 * Tout message reçu est validé à l'exécution (`isCommand`, `isContentRequest`) :
 * le typage TypeScript ne protège pas des messages forgés par une page.
 */

export const PROTOCOL_VERSION = 1 as const;

export type Command =
  | { type: 'session/get' }
  | { type: 'record/start' }
  | { type: 'session/stop' }
  | { type: 'replay/start'; workflowId: string }
  | { type: 'workflow/delete'; workflowId: string };

export type CommandType = Command['type'];

/** Réponse du service worker : la session après la commande, ou une erreur affichable. */
export type CommandResponse = Result<SessionState>;

export type ContentRequest = { type: 'content/ping' };

export interface ContentPong {
  type: 'content/pong';
  protocolVersion: typeof PROTOCOL_VERSION;
  url: string;
}

const COMMAND_TYPES: ReadonlySet<string> = new Set<CommandType>([
  'session/get',
  'record/start',
  'session/stop',
  'replay/start',
  'workflow/delete',
]);

export function isCommand(value: unknown): value is Command {
  if (!isRecord(value) || typeof value.type !== 'string' || !COMMAND_TYPES.has(value.type)) return false;
  if (value.type === 'replay/start' || value.type === 'workflow/delete') return isNonEmptyString(value.workflowId);
  return true;
}

export function isContentRequest(value: unknown): value is ContentRequest {
  return isRecord(value) && value.type === 'content/ping';
}

export function isContentPong(value: unknown): value is ContentPong {
  return (
    isRecord(value) &&
    value.type === 'content/pong' &&
    value.protocolVersion === PROTOCOL_VERSION &&
    typeof value.url === 'string'
  );
}
