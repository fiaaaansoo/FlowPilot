import { describe, expect, it } from 'vitest';
import { failedRun, isRunSummary } from './run.js';

const base = { workflowId: 'wf', outcome: 'succeeded', startedAt: 1, finishedAt: 2, stepsCompleted: 1, totalSteps: 1, log: [] };
const log = { stepIndex: 0, kind: 'click', status: 'succeeded', startedAt: 1, finishedAt: 2, strategy: 'role' };

describe('isRunSummary', () => {
  it('accepte un run réussi journalisé et un run en échec complet', () => {
    expect(isRunSummary({ ...base, log: [log] })).toBe(true);
    expect(isRunSummary({ ...base, outcome: 'failed', failure: { stepIndex: 0, code: 'INTERNAL', message: 'x' } })).toBe(true);
  });

  it.each([
    ['échec sans cause', { ...base, outcome: 'failed' }],
    ['cause malformée', { ...base, outcome: 'failed', failure: { stepIndex: 'x' } }],
    ['issue inconnue', { ...base, outcome: 'maybe' }],
    ['nombre manquant', { ...base, totalSteps: undefined }],
    ['journal absent (format Sprint 1)', { ...base, log: undefined }],
    ['entrée de journal invalide', { ...base, log: [{ ...log, status: 'bof' }] }],
  ])('rejette : %s', (_label, raw) => {
    expect(isRunSummary(raw)).toBe(false);
  });
});

describe('failedRun', () => {
  it('construit un run en échec cohérent', () => {
    const run = failedRun({ workflowId: 'wf', startedAt: 1, finishedAt: 2, totalSteps: 3, log: [] }, 1, 'TARGET_NOT_FOUND', 'absent');
    expect(run).toEqual({
      workflowId: 'wf',
      startedAt: 1,
      finishedAt: 2,
      totalSteps: 3,
      log: [],
      outcome: 'failed',
      stepsCompleted: 1,
      failure: { stepIndex: 1, code: 'TARGET_NOT_FOUND', message: 'absent' },
    });
    expect(isRunSummary(run)).toBe(true);
  });
});
