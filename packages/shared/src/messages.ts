import { isFiniteNumber, isNonEmptyString, isRecord } from './guards.js';
import { isErrorCode, type Result } from './result.js';
import { parseRecordedEvent, type PageEvent, type RecordedEvent } from './recording.js';
import type { SessionState } from './session.js';
import { MAX_OBSERVATION_ELEMENTS, isObservedRef, type Candidate, type Observation } from './recovery.js';
import type { ElementStep } from './workflow.js';

/**
 * Protocole de messages typé entre les contextes de l'extension.
 *
 * - `Command` : Side Panel → service worker (seul le SW modifie la session).
 * - `ContentRequest` : service worker → content script.
 * - `ContentEventMessage` : content script → service worker (capture).
 *
 * Tout message reçu est validé à l'exécution : le typage TypeScript ne protège
 * pas des données issues d'une page web.
 */

export const PROTOCOL_VERSION = 2 as const;

/**
 * Port held by the content script of the recorded tab: it keeps the service worker
 * alive during a recording, and its disconnection tells the page the worker stopped.
 */
export const RECORDER_PORT = 'flowpilot.recorder';
/** Heartbeat interval on that port, below the ~30 s after which Chrome stops an idle worker. */
export const RECORDER_HEARTBEAT_MS = 20_000;

export type Command =
  | { type: 'session/get' }
  | { type: 'record/start' }
  | { type: 'session/stop' }
  | { type: 'replay/start'; workflowId: string }
  /** Réponse humaine à une étape en attente (confirmation ou saisie manuelle faite). */
  | { type: 'replay/continue'; stepIndex: number }
  | { type: 'workflow/delete'; workflowId: string };

export type CommandType = Command['type'];

/** Réponse du service worker : la session après la commande, ou une erreur affichable. */
export type CommandResponse = Result<SessionState>;

export type ContentRequest =
  | { type: 'content/ping' }
  /** Active ou coupe la capture. À l'arrêt, la réponse contient les saisies encore en attente. */
  | { type: 'content/record'; recording: boolean }
  /**
   * Localise la cible de l'étape (en attendant au plus `timeoutMs`) puis exécute l'action.
   * `confirmed` : un humain a validé l'étape ; sinon la page refuse une action qu'elle juge irréversible.
   */
  | { type: 'content/perform'; step: ElementStep; timeoutMs: number; confirmed: boolean; settleMs?: number }
  /** Annule l'action en cours (arrêt du replay pendant l'attente d'un élément). */
  | { type: 'content/cancel' }
  /** AI recovery: bounded, sanitized snapshot of the visible interactive elements. */
  | { type: 'content/observe' }
  /** AI recovery: run the recorded step on an element of the latest snapshot, revalidated first. */
  | { type: 'content/perform-ref'; step: ElementStep; snapshotId: string; ref: string; confirmed: boolean };

export interface ContentPong {
  type: 'content/pong';
  protocolVersion: typeof PROTOCOL_VERSION;
  url: string;
  recording: boolean;
}

export interface RecordAck {
  type: 'content/record-ack';
  /** Événements en attente vidés à l'arrêt de la capture (saisie non encore validée). */
  flushed: RecordedEvent[];
}

/** Résultat d'une action dans la page : stratégie de grounding retenue, ou erreur. */
export type PerformResponse = Result<{ strategy: string }>;

/** Content script → SW au chargement d'une page : « dois-je capturer ? » (seul l'onglet enregistré répond oui). */
export interface ContentHello {
  type: 'content/hello';
}

export interface ContentHelloReply {
  recording: boolean;
}

export const isContentHello = (value: unknown): value is ContentHello => isRecord(value) && value.type === 'content/hello';

export interface ContentEventMessage {
  type: 'recorder/event';
  event: PageEvent;
}

const COMMAND_TYPES: ReadonlySet<string> = new Set<CommandType>([
  'session/get',
  'record/start',
  'session/stop',
  'replay/start',
  'replay/continue',
  'workflow/delete',
]);

export function isCommand(value: unknown): value is Command {
  if (!isRecord(value) || typeof value.type !== 'string' || !COMMAND_TYPES.has(value.type)) return false;
  if (value.type === 'replay/start' || value.type === 'workflow/delete') return isNonEmptyString(value.workflowId);
  if (value.type === 'replay/continue') return isFiniteNumber(value.stepIndex);
  return true;
}

export function isContentRequest(value: unknown): value is ContentRequest {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'content/ping':
      return true;
    case 'content/record':
      return typeof value.recording === 'boolean';
    case 'content/perform':
      return (
        isRecord(value.step) &&
        isFiniteNumber(value.timeoutMs) &&
        typeof value.confirmed === 'boolean' &&
        (value.settleMs === undefined || isFiniteNumber(value.settleMs))
      );
    case 'content/cancel':
    case 'content/observe':
      return true;
    case 'content/perform-ref':
      return (
        isRecord(value.step) &&
        isNonEmptyString(value.snapshotId) &&
        isObservedRef(value.ref) &&
        typeof value.confirmed === 'boolean'
      );
    default:
      return false;
  }
}

export function isContentPong(value: unknown): value is ContentPong {
  return (
    isRecord(value) &&
    value.type === 'content/pong' &&
    value.protocolVersion === PROTOCOL_VERSION &&
    typeof value.url === 'string' &&
    typeof value.recording === 'boolean'
  );
}

/** Valide un message de capture et son événement ; `null` si invalide. */
export function parseContentEvent(value: unknown): PageEvent | null {
  if (!isRecord(value) || value.type !== 'recorder/event') return null;
  const raw = value.event;
  if (isRecord(raw) && raw.kind === 'leave') return isFiniteNumber(raw.at) ? { kind: 'leave', at: raw.at } : null;
  const event = parseRecordedEvent(raw);
  return event.ok ? event.value : null;
}

export function parseRecordAck(value: unknown): RecordedEvent[] | null {
  if (!isRecord(value) || value.type !== 'content/record-ack' || !Array.isArray(value.flushed)) return null;
  const events: RecordedEvent[] = [];
  for (const raw of value.flushed as unknown[]) {
    const event = parseRecordedEvent(raw);
    if (event.ok) events.push(event.value);
  }
  return events;
}

/** Validates the observation returned by the content script (bounded, well-formed candidates only). */
export function parseObservation(value: unknown): Observation | null {
  if (!isRecord(value) || !isNonEmptyString(value.snapshotId) || typeof value.url !== 'string' || !Array.isArray(value.elements)) {
    return null;
  }
  const elements: Candidate[] = [];
  for (const raw of (value.elements as unknown[]).slice(0, MAX_OBSERVATION_ELEMENTS)) {
    if (!isRecord(raw) || !isObservedRef(raw.ref) || !isNonEmptyString(raw.tag)) return null;
    if (!isRecord(raw.attributes)) return null;
    elements.push(raw as unknown as Candidate);
  }
  return { snapshotId: value.snapshotId, url: value.url, title: typeof value.title === 'string' ? value.title.slice(0, 200) : '', elements };
}

export function parsePerformResponse(value: unknown): PerformResponse | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    return isRecord(value.value) && typeof value.value.strategy === 'string'
      ? { ok: true, value: { strategy: value.value.strategy } }
      : null;
  }
  const error = value.error;
  if (!isRecord(error) || !isErrorCode(error.code) || typeof error.message !== 'string') return null;
  return { ok: false, error: { code: error.code, message: error.message } };
}
