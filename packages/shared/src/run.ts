import { isFiniteNumber, isRecord } from './guards.js';
import type { ErrorCode } from './result.js';
import type { StepKind } from './workflow.js';

/**
 * Résultat d'une exécution et journal structuré par étape. Persistés
 * (historique borné) : base de la future évaluation (Sprint 4) et de la
 * mémoire des corrections (Sprint 3).
 */
export type RunOutcome = 'succeeded' | 'aborted' | 'failed';
export type StepStatus = 'succeeded' | 'failed' | 'aborted';

/** What AI recovery did for a step whose deterministic grounding failed. */
export interface RecoveryLog {
  /** recovered: executed and checked; escalated: refused safely; unavailable: no backend; aborted: stopped by the user. */
  outcome: 'recovered' | 'escalated' | 'unavailable' | 'aborted';
  strategy?: 'memory' | 'semantic' | 'llm' | 'none';
  attempts: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** Whole recovery as seen by the extension, including any wait for the user's confirmation. */
  latencyMs: number;
  /** Time spent in the recovery service (memory, grounding and model inference), without the user's wait. */
  serviceLatencyMs?: number;
  costUsd: number;
  provider?: string;
  model?: string;
  recoveryId?: string;
  reason?: string;
}

export interface StepLog {
  stepIndex: number;
  kind: StepKind;
  status: StepStatus;
  startedAt: number;
  finishedAt: number;
  /** Stratégie de grounding qui a résolu la cible (`testid`, `role`, `css`...). */
  strategy?: string;
  /** Renseignés en cas d'échec. */
  code?: ErrorCode;
  message?: string;
  /** Present when AI recovery was attempted for this step. */
  recovery?: RecoveryLog;
}

export interface RunSummary {
  workflowId: string;
  outcome: RunOutcome;
  startedAt: number;
  finishedAt: number;
  stepsCompleted: number;
  totalSteps: number;
  /** Renseigné si `outcome === 'failed'` : étape (0-based) en échec et cause. */
  failure?: { stepIndex: number; code: ErrorCode; message: string };
  log: StepLog[];
}

/** Run en échec à l'étape `stepIndex` (les étapes précédentes sont réussies). */
export function failedRun(
  base: Pick<RunSummary, 'workflowId' | 'startedAt' | 'finishedAt' | 'totalSteps' | 'log'>,
  stepIndex: number,
  code: ErrorCode,
  message: string,
): RunSummary {
  return { ...base, outcome: 'failed', stepsCompleted: stepIndex, failure: { stepIndex, code, message } };
}

const OUTCOMES: ReadonlySet<unknown> = new Set<RunOutcome>(['succeeded', 'aborted', 'failed']);
const STEP_STATUSES: ReadonlySet<unknown> = new Set<StepStatus>(['succeeded', 'failed', 'aborted']);

const RECOVERY_OUTCOMES: ReadonlySet<unknown> = new Set(['recovered', 'escalated', 'unavailable', 'aborted']);

function isRecoveryLog(raw: unknown): raw is RecoveryLog {
  return (
    isRecord(raw) &&
    RECOVERY_OUTCOMES.has(raw.outcome) &&
    isFiniteNumber(raw.attempts) &&
    isFiniteNumber(raw.modelCalls) &&
    isFiniteNumber(raw.inputTokens) &&
    isFiniteNumber(raw.outputTokens) &&
    isFiniteNumber(raw.latencyMs) &&
    (raw.serviceLatencyMs === undefined || isFiniteNumber(raw.serviceLatencyMs)) &&
    isFiniteNumber(raw.costUsd)
  );
}

function isStepLog(raw: unknown): raw is StepLog {
  return (
    isRecord(raw) &&
    isFiniteNumber(raw.stepIndex) &&
    typeof raw.kind === 'string' &&
    STEP_STATUSES.has(raw.status) &&
    isFiniteNumber(raw.startedAt) &&
    isFiniteNumber(raw.finishedAt) &&
    (raw.strategy === undefined || typeof raw.strategy === 'string') &&
    (raw.code === undefined || typeof raw.code === 'string') &&
    (raw.message === undefined || typeof raw.message === 'string') &&
    (raw.recovery === undefined || isRecoveryLog(raw.recovery))
  );
}

/** Garde d'exécution pour un `RunSummary` relu depuis le stockage. */
export function isRunSummary(raw: unknown): raw is RunSummary {
  if (!isRecord(raw)) return false;
  if (
    typeof raw.workflowId !== 'string' ||
    !OUTCOMES.has(raw.outcome) ||
    !isFiniteNumber(raw.startedAt) ||
    !isFiniteNumber(raw.finishedAt) ||
    !isFiniteNumber(raw.stepsCompleted) ||
    !isFiniteNumber(raw.totalSteps) ||
    !Array.isArray(raw.log) ||
    !(raw.log as unknown[]).every(isStepLog)
  ) {
    return false;
  }
  if (raw.failure === undefined) return raw.outcome !== 'failed';
  const f = raw.failure;
  return isRecord(f) && isFiniteNumber(f.stepIndex) && typeof f.code === 'string' && typeof f.message === 'string';
}
