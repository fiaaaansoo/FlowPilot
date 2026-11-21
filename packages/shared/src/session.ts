import { isFiniteNumber as isNum, isNonEmptyString as isStr, isRecord } from './guards.js';
import { fail, ok, type Result } from './result.js';

/**
 * Machine d'état de la session FlowPilot. Pure et sans dépendance Chrome :
 * le service worker l'applique, le Side Panel en dérive les boutons actifs.
 *
 *   idle ──RECORD_STARTED──▶ recording ──STOPPED──▶ idle
 *   idle ──REPLAY_STARTED──▶ replaying ──STOPPED | REPLAY_FINISHED──▶ idle
 *   replaying ──HUMAN_REQUESTED──▶ replaying (awaitingHuman) ──HUMAN_RESOLVED──▶ replaying
 */

export interface IdleSession {
  status: 'idle';
}

export interface RecordingSession {
  status: 'recording';
  tabId: number;
  origin: string;
  workflowId: string;
  /** Epoch ms. */
  startedAt: number;
}

export interface ReplayingSession {
  status: 'replaying';
  tabId: number;
  workflowId: string;
  startedAt: number;
  /** Index (0-based) de l'étape en cours d'exécution. */
  stepIndex: number;
  /** Présent quand le replay attend une intervention humaine sur l'étape `stepIndex`. */
  awaitingHuman?: true;
  /** Set when the pending human decision is about an AI recovery proposal, or needs an explanation. */
  humanPrompt?: HumanPromptInfo;
}

/** What the side panel shows before executing an AI-recovered step. Texts come from the page or the model: display only. */
export interface AiProposalPrompt {
  kind: 'ai-proposal';
  /** Description of the proposed element (e.g. « Trouver des offres » (button)). */
  proposed: string;
  strategy: 'memory' | 'semantic' | 'llm' | 'none';
  confidence: number;
  rationale: string;
  /** Why the user must decide, from the extension or the page (irreversible, data sent elsewhere). Never from the model. */
  warning?: string;
}

/** Why a plain confirmation is needed, when it is not just "this step may be irreversible". */
export interface WarningPrompt {
  kind: 'warning';
  /** Shown as is (e.g. "Ce formulaire envoie des données vers https://… : confirmation humaine requise."). */
  message: string;
}

export type HumanPromptInfo = AiProposalPrompt | WarningPrompt;

export type SessionState = IdleSession | RecordingSession | ReplayingSession;
export type SessionStatus = SessionState['status'];

export type SessionEvent =
  | { type: 'RECORD_STARTED'; tabId: number; origin: string; workflowId: string; startedAt: number }
  | { type: 'REPLAY_STARTED'; tabId: number; workflowId: string; startedAt: number }
  | { type: 'STEP_STARTED'; stepIndex: number }
  | { type: 'HUMAN_REQUESTED'; stepIndex: number; prompt?: HumanPromptInfo }
  | { type: 'HUMAN_RESOLVED' }
  | { type: 'STOPPED' }
  | { type: 'REPLAY_FINISHED' };

export const IDLE: IdleSession = Object.freeze({ status: 'idle' });

export function transition(state: SessionState, event: SessionEvent): Result<SessionState> {
  switch (event.type) {
    case 'RECORD_STARTED':
      if (state.status !== 'idle') return invalid(state, event);
      return ok({
        status: 'recording',
        tabId: event.tabId,
        origin: event.origin,
        workflowId: event.workflowId,
        startedAt: event.startedAt,
      });
    case 'REPLAY_STARTED':
      if (state.status !== 'idle') return invalid(state, event);
      return ok({
        status: 'replaying',
        tabId: event.tabId,
        workflowId: event.workflowId,
        startedAt: event.startedAt,
        stepIndex: 0,
      });
    case 'STEP_STARTED':
      if (state.status !== 'replaying') return invalid(state, event);
      return ok(replaying(state, event.stepIndex, false));
    case 'HUMAN_REQUESTED':
      if (state.status !== 'replaying' || state.awaitingHuman) return invalid(state, event);
      return ok(replaying(state, event.stepIndex, true, event.prompt));
    case 'HUMAN_RESOLVED':
      if (state.status !== 'replaying' || !state.awaitingHuman) return invalid(state, event);
      return ok(replaying(state, state.stepIndex, false));
    case 'STOPPED':
      if (state.status === 'idle') return invalid(state, event);
      return ok(IDLE);
    case 'REPLAY_FINISHED':
      if (state.status !== 'replaying') return invalid(state, event);
      return ok(IDLE);
  }
}

function replaying(state: ReplayingSession, stepIndex: number, awaitingHuman: boolean, prompt?: HumanPromptInfo): ReplayingSession {
  const { status, tabId, workflowId, startedAt } = state;
  return {
    status,
    tabId,
    workflowId,
    startedAt,
    stepIndex,
    ...(awaitingHuman ? { awaitingHuman: true as const } : {}),
    ...(awaitingHuman && prompt ? { humanPrompt: prompt } : {}),
  };
}

function parsePrompt(raw: unknown): HumanPromptInfo | undefined {
  if (isRecord(raw) && raw.kind === 'warning' && typeof raw.message === 'string') {
    return { kind: 'warning', message: raw.message.slice(0, 300) };
  }
  if (!isRecord(raw) || raw.kind !== 'ai-proposal') return undefined;
  const { proposed, strategy, confidence, rationale, warning } = raw;
  if (typeof proposed !== 'string' || typeof rationale !== 'string' || !isNum(confidence)) return undefined;
  if (strategy !== 'memory' && strategy !== 'semantic' && strategy !== 'llm' && strategy !== 'none') return undefined;
  const prompt: AiProposalPrompt = { kind: 'ai-proposal', proposed: proposed.slice(0, 300), strategy, confidence, rationale: rationale.slice(0, 300) };
  if (typeof warning === 'string' && warning) prompt.warning = warning.slice(0, 300);
  return prompt;
}

function invalid(state: SessionState, event: SessionEvent): Result<never> {
  return fail('INVALID_TRANSITION', `Action « ${event.type} » impossible depuis l'état « ${state.status} ».`);
}

export interface AvailableCommands {
  canRecord: boolean;
  canStop: boolean;
  canReplay: boolean;
}

/** Boutons actifs du Side Panel. `hasWorkflow` : au moins un workflow sélectionnable. */
export function availableCommands(state: SessionState, hasWorkflow: boolean): AvailableCommands {
  return {
    canRecord: state.status === 'idle',
    canStop: state.status !== 'idle',
    canReplay: state.status === 'idle' && hasWorkflow,
  };
}

/** Lecture défensive depuis le stockage : toute donnée inattendue redevient `idle`. */
export function parseSession(raw: unknown): SessionState {
  if (!isRecord(raw)) return IDLE;
  const s = raw;
  if (s.status === 'recording' && isNum(s.tabId) && isStr(s.origin) && isStr(s.workflowId) && isNum(s.startedAt)) {
    return { status: 'recording', tabId: s.tabId, origin: s.origin, workflowId: s.workflowId, startedAt: s.startedAt };
  }
  const prompt = parsePrompt(s.humanPrompt);
  if (s.status === 'replaying' && isNum(s.tabId) && isStr(s.workflowId) && isNum(s.startedAt) && isNum(s.stepIndex)) {
    return {
      status: 'replaying',
      tabId: s.tabId,
      workflowId: s.workflowId,
      startedAt: s.startedAt,
      stepIndex: s.stepIndex,
      ...(s.awaitingHuman === true ? { awaitingHuman: true as const } : {}),
      ...(s.awaitingHuman === true && prompt ? { humanPrompt: prompt } : {}),
    };
  }
  return IDLE;
}
