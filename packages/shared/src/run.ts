import { isFiniteNumber, isRecord } from './guards.js';
import type { ErrorCode } from './result.js';

/**
 * Résumé de la dernière exécution, conservé pour l'affichage et, plus tard,
 * pour la journalisation / l'évaluation (Sprint 4).
 */
export type RunOutcome = 'succeeded' | 'aborted' | 'failed';

export interface RunSummary {
  workflowId: string;
  outcome: RunOutcome;
  startedAt: number;
  finishedAt: number;
  stepsCompleted: number;
  totalSteps: number;
  /** Renseigné si `outcome === 'failed'` : étape (0-based) en échec et cause. */
  failure?: { stepIndex: number; code: ErrorCode; message: string };
}

/** Run en échec à l'étape `stepIndex` (les étapes précédentes sont réussies). */
export function failedRun(
  base: Pick<RunSummary, 'workflowId' | 'startedAt' | 'finishedAt' | 'totalSteps'>,
  stepIndex: number,
  code: ErrorCode,
  message: string,
): RunSummary {
  return { ...base, outcome: 'failed', stepsCompleted: stepIndex, failure: { stepIndex, code, message } };
}

const OUTCOMES: ReadonlySet<unknown> = new Set<RunOutcome>(['succeeded', 'aborted', 'failed']);

/** Garde d'exécution pour un `RunSummary` relu depuis le stockage. */
export function isRunSummary(raw: unknown): raw is RunSummary {
  if (!isRecord(raw)) return false;
  if (
    typeof raw.workflowId !== 'string' ||
    !OUTCOMES.has(raw.outcome) ||
    !isFiniteNumber(raw.startedAt) ||
    !isFiniteNumber(raw.finishedAt) ||
    !isFiniteNumber(raw.stepsCompleted) ||
    !isFiniteNumber(raw.totalSteps)
  ) {
    return false;
  }
  if (raw.failure === undefined) return raw.outcome !== 'failed';
  const f = raw.failure;
  return isRecord(f) && isFiniteNumber(f.stepIndex) && typeof f.code === 'string' && typeof f.message === 'string';
}
