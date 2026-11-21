import { describe, expect, it } from 'vitest';
import { isRunSummary } from './run.js';

const base = { workflowId: 'wf', outcome: 'succeeded', startedAt: 1, finishedAt: 2, stepsCompleted: 1, totalSteps: 1 };

describe('isRunSummary', () => {
  it('accepte un run réussi et un run en échec complet', () => {
    expect(isRunSummary(base)).toBe(true);
    expect(isRunSummary({ ...base, outcome: 'failed', failure: { stepIndex: 0, code: 'INTERNAL', message: 'x' } })).toBe(true);
  });

  it.each([
    ['échec sans cause', { ...base, outcome: 'failed' }],
    ['cause malformée', { ...base, outcome: 'failed', failure: { stepIndex: 'x' } }],
    ['issue inconnue', { ...base, outcome: 'maybe' }],
    ['nombre manquant', { ...base, totalSteps: undefined }],
  ])('rejette : %s', (_label, raw) => {
    expect(isRunSummary(raw)).toBe(false);
  });
});
