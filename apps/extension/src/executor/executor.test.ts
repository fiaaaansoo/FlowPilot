import { describe, expect, it, vi } from 'vitest';
import { fail, ok, type ElementStep, type Result } from '@flowpilot/shared';
import { makeWorkflow, target } from '../test/fakes';
import { runWorkflow, type StepDriver } from './executor';

const workflow = makeWorkflow([
  { id: 'a', kind: 'navigate', url: 'http://localhost:5173/' },
  { id: 'b', kind: 'input', target: target('q', { tag: 'input' }), value: 'data' },
  { id: 'c', kind: 'click', target: target('Rechercher') },
  { id: 'd', kind: 'waitForNavigation', url: 'http://localhost:5173/results.html' },
]);

const now = () => 1000;

function driver(overrides: Partial<StepDriver> = {}): StepDriver & { order: string[] } {
  const order: string[] = [];
  return {
    order,
    navigate: (url) => (order.push(`navigate ${url}`), Promise.resolve(ok(undefined))),
    waitForNavigation: (url) => (order.push(`wait ${url}`), Promise.resolve(ok(undefined))),
    perform: (step: ElementStep) => (order.push(`${step.kind} ${step.target.name ?? ''}`), Promise.resolve(ok({ strategy: 'role' }))),
    requestHuman: () => Promise.resolve(true),
    ...overrides,
  };
}

const signal = () => new AbortController().signal;

describe('runWorkflow', () => {
  it('exécute chaque type d’étape dans l’ordre et journalise la stratégie', async () => {
    const d = driver();
    const onStepStart = vi.fn();
    const summary = await runWorkflow(workflow, d, { signal: signal(), now, onStepStart });
    expect(d.order).toEqual([
      'navigate http://localhost:5173/',
      'input q',
      'click Rechercher',
      'wait http://localhost:5173/results.html',
    ]);
    expect(onStepStart).toHaveBeenCalledTimes(4);
    expect(summary).toMatchObject({ outcome: 'succeeded', stepsCompleted: 4, totalSteps: 4 });
    expect(summary.log.map((l) => l.strategy)).toEqual([undefined, 'role', 'role', undefined]);
    expect(summary.failure).toBeUndefined();
  });

  it('s’arrête à la première étape en échec et l’identifie', async () => {
    const d = driver({ perform: () => Promise.resolve(fail('TARGET_NOT_FOUND', 'introuvable')) });
    const summary = await runWorkflow(workflow, d, { signal: signal(), now });
    expect(summary).toMatchObject({
      outcome: 'failed',
      stepsCompleted: 1,
      failure: { stepIndex: 1, code: 'TARGET_NOT_FOUND', message: 'introuvable' },
    });
    expect(summary.log.at(-1)).toMatchObject({ stepIndex: 1, status: 'failed', code: 'TARGET_NOT_FOUND' });
  });

  it('convertit une exception du driver en échec explicite', async () => {
    const d = driver({ navigate: () => Promise.reject(new Error('boom')) });
    const summary = await runWorkflow(workflow, d, { signal: signal(), now });
    expect(summary).toMatchObject({ outcome: 'failed', failure: { stepIndex: 0, code: 'INTERNAL', message: 'boom' } });
  });

  it('ne rejette jamais, même si onStepStart lève', async () => {
    const summary = await runWorkflow(workflow, driver(), {
      signal: signal(),
      now,
      onStepStart: () => {
        throw new Error('stockage indisponible');
      },
    });
    expect(summary).toMatchObject({ outcome: 'failed', failure: { code: 'INTERNAL', message: 'stockage indisponible' } });
  });

  it('demande une intervention humaine avant une étape à confirmer, puis l’exécute', async () => {
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const d = driver({ requestHuman });
    const confirmFlow = makeWorkflow([{ id: 'x', kind: 'click', target: target('Envoyer'), confirm: true }]);
    const summary = await runWorkflow(confirmFlow, d, { signal: signal(), now });
    expect(requestHuman).toHaveBeenCalledWith(0, expect.any(AbortSignal));
    expect(d.order).toEqual(['click Envoyer']);
    expect(summary.outcome).toBe('succeeded');
  });

  it('demande une saisie humaine pour un champ sensible', async () => {
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const d = driver({ requestHuman });
    const manual = makeWorkflow([{ id: 'x', kind: 'manualInput', target: target('Mot de passe', { tag: 'input' }) }]);
    await runWorkflow(manual, d, { signal: signal(), now });
    expect(requestHuman).toHaveBeenCalledOnce();
    expect(d.order).toEqual(['manualInput Mot de passe']);
  });

  it('si la page juge l’élément irréversible, demande l’accord humain puis réessaie confirmé', async () => {
    const calls: boolean[] = [];
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const d = driver({
      requestHuman,
      perform: (_step, _signal, confirmed) => {
        calls.push(confirmed);
        return Promise.resolve(confirmed ? ok({ strategy: 'role' }) : fail('CONFIRMATION_REQUIRED', 'irréversible'));
      },
    });
    const flow = makeWorkflow([{ id: 'x', kind: 'click', target: target('Payez') }]);
    const summary = await runWorkflow(flow, d, { signal: signal(), now });
    expect(calls).toEqual([false, true]);
    expect(requestHuman).toHaveBeenCalledOnce();
    expect(summary.outcome).toBe('succeeded');
  });

  it('un refus humain (arrêt) n’exécute pas l’action', async () => {
    const d = driver({ requestHuman: () => Promise.resolve(false) });
    const confirmFlow = makeWorkflow([{ id: 'x', kind: 'submit', target: target('form', { tag: 'form' }), confirm: true }]);
    const summary = await runWorkflow(confirmFlow, d, { signal: signal(), now });
    expect(d.order).toEqual([]);
    expect(summary).toMatchObject({ outcome: 'aborted', log: [{ status: 'aborted' }] });
  });

  it('n’exécute pas une étape si l’arrêt arrive pendant onStepStart', async () => {
    const abort = new AbortController();
    const d = driver();
    const summary = await runWorkflow(workflow, d, { signal: abort.signal, now, onStepStart: () => abort.abort() });
    expect(d.order).toEqual([]);
    expect(summary).toMatchObject({ outcome: 'aborted', stepsCompleted: 0 });
  });

  it('compte l’étape réussie quand l’arrêt arrive juste après', async () => {
    const abort = new AbortController();
    const d = driver({
      navigate: () => {
        abort.abort();
        return Promise.resolve(ok(undefined));
      },
    });
    expect(await runWorkflow(workflow, d, { signal: abort.signal, now })).toMatchObject({ outcome: 'aborted', stepsCompleted: 1 });
  });

  it('un échec dû à l’arrêt est rapporté comme arrêt', async () => {
    const abort = new AbortController();
    const d = driver({
      navigate: (): Promise<Result<void>> => {
        abort.abort();
        return Promise.resolve(fail('NAVIGATION_FAILED', 'Exécution arrêtée.'));
      },
    });
    const summary = await runWorkflow(workflow, d, { signal: abort.signal, now });
    expect(summary).toMatchObject({ outcome: 'aborted', stepsCompleted: 0 });
    expect(summary.failure).toBeUndefined();
  });
});
