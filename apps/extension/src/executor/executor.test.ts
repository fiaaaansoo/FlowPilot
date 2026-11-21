import { describe, expect, it, vi } from 'vitest';
import { fail, ok, type Workflow } from '@flowpilot/shared';
import { runWorkflow, type StepDriver } from './executor';

const workflow: Workflow = {
  schemaVersion: 1,
  id: 'wf',
  name: 'Démo',
  origin: 'http://localhost:5173',
  createdAt: '2026-11-21T10:00:00.000Z',
  steps: [
    { id: 'a', kind: 'navigate', url: 'http://localhost:5173/' },
    { id: 'b', kind: 'navigate', url: 'http://localhost:5173/results.html' },
  ],
};

const now = () => 1000;

describe('runWorkflow', () => {
  it('exécute les étapes dans l’ordre', async () => {
    const urls: string[] = [];
    const driver: StepDriver = { navigate: (url) => (urls.push(url), Promise.resolve(ok(undefined))) };
    const onStepStart = vi.fn();
    const summary = await runWorkflow(workflow, driver, { signal: new AbortController().signal, now, onStepStart });
    expect(urls).toEqual(['http://localhost:5173/', 'http://localhost:5173/results.html']);
    expect(onStepStart).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ outcome: 'succeeded', stepsCompleted: 2, totalSteps: 2 });
    expect(summary.failure).toBeUndefined();
  });

  it('s’arrête à la première étape en échec', async () => {
    const driver: StepDriver = {
      navigate: (url) => Promise.resolve(url.endsWith('results.html') ? fail('NAVIGATION_FAILED', '404') : ok(undefined)),
    };
    const summary = await runWorkflow(workflow, driver, { signal: new AbortController().signal, now });
    expect(summary).toMatchObject({
      outcome: 'failed',
      stepsCompleted: 1,
      failure: { stepIndex: 1, code: 'NAVIGATION_FAILED', message: '404' },
    });
  });

  it('convertit une exception du driver en échec explicite', async () => {
    const driver: StepDriver = { navigate: () => Promise.reject(new Error('boom')) };
    const summary = await runWorkflow(workflow, driver, { signal: new AbortController().signal, now });
    expect(summary).toMatchObject({ outcome: 'failed', failure: { stepIndex: 0, code: 'INTERNAL', message: 'boom' } });
  });

  it('n’exécute pas une étape si l’arrêt arrive pendant onStepStart', async () => {
    const abort = new AbortController();
    const navigate = vi.fn(() => Promise.resolve(ok(undefined)));
    const summary = await runWorkflow(workflow, { navigate }, { signal: abort.signal, now, onStepStart: () => abort.abort() });
    expect(navigate).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ outcome: 'aborted', stepsCompleted: 0 });
  });

  it('compte l’étape réussie quand l’arrêt arrive juste après', async () => {
    const abort = new AbortController();
    const driver: StepDriver = {
      navigate: () => {
        abort.abort();
        return Promise.resolve(ok(undefined));
      },
    };
    const summary = await runWorkflow(workflow, driver, { signal: abort.signal, now });
    expect(summary).toMatchObject({ outcome: 'aborted', stepsCompleted: 1 });
  });

  it('un échec dû à l’arrêt est rapporté comme arrêt', async () => {
    const abort = new AbortController();
    const driver: StepDriver = {
      navigate: () => {
        abort.abort();
        return Promise.resolve(fail('NAVIGATION_FAILED', 'Exécution arrêtée.'));
      },
    };
    const summary = await runWorkflow(workflow, driver, { signal: abort.signal, now });
    expect(summary).toMatchObject({ outcome: 'aborted', stepsCompleted: 0 });
    expect(summary.failure).toBeUndefined();
  });
});
