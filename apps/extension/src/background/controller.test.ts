import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE, fail, ok, type CommandResponse, type Result } from '@flowpilot/shared';
import { memoryArea } from '../storage/area';
import { SessionStore } from '../storage/session-store';
import { WorkflowStore } from '../storage/workflow-store';
import { FakeEnv, deferred } from '../test/fakes';
import { SessionController } from './controller';

let env: FakeEnv;
let sessions: SessionStore;
let workflows: WorkflowStore;
let controller: SessionController;
let clock: number;

function setup(envOptions?: ConstructorParameters<typeof FakeEnv>[0]) {
  env = new FakeEnv(envOptions);
  sessions = new SessionStore(memoryArea());
  workflows = new WorkflowStore(memoryArea());
  clock = Date.parse('2026-11-21T10:00:00Z');
  let seq = 0;
  controller = new SessionController({
    env,
    sessions,
    workflows,
    now: () => clock,
    newId: () => `id-${++seq}`,
  });
}

const expectError = (response: CommandResponse, code: string) => {
  expect(response.ok).toBe(false);
  if (!response.ok) expect(response.error.code).toBe(code);
};

async function recordOnce(): Promise<string> {
  await controller.handle({ type: 'record/start' });
  await controller.handle({ type: 'session/stop' });
  const { workflows: list } = await workflows.list();
  const first = list[0];
  if (!first) throw new Error('aucun workflow enregistré');
  return first.id;
}

describe('SessionController — enregistrement', () => {
  beforeEach(() => setup());

  it('Enregistrer puis Arrêter persiste un workflow avec l’étape de départ', async () => {
    const started = await controller.handle({ type: 'record/start' });
    expect(started).toMatchObject({ ok: true, value: { status: 'recording', tabId: 7, origin: 'http://localhost:5173' } });
    expect(env.indicator).toBe('recording');

    const stopped = await controller.handle({ type: 'session/stop' });
    expect(stopped).toEqual({ ok: true, value: IDLE });
    expect(env.indicator).toBe('idle');

    const { workflows: list } = await workflows.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      schemaVersion: 1,
      origin: 'http://localhost:5173',
      steps: [{ kind: 'navigate', url: 'http://localhost:5173/' }],
    });
    expect(await sessions.getDraft()).toBeNull();
  });

  it('refuse un second enregistrement simultané (double clic)', async () => {
    const [a, b] = await Promise.all([
      controller.handle({ type: 'record/start' }),
      controller.handle({ type: 'record/start' }),
    ]);
    expect(a.ok).toBe(true);
    expectError(b, 'INVALID_TRANSITION');
  });

  it('refuse sans onglet actif', async () => {
    setup({ tab: null });
    expectError(await controller.handle({ type: 'record/start' }), 'NO_ACTIVE_TAB');
  });

  it('refuse un onglet dont l’URL est masquée (site non autorisé ou page Chrome)', async () => {
    setup({ tab: { id: 1, url: undefined } });
    expectError(await controller.handle({ type: 'record/start' }), 'ORIGIN_NOT_ALLOWED');
  });

  it('refuse une page non http(s)', async () => {
    setup({ tab: { id: 1, url: 'chrome://extensions/' } });
    expectError(await controller.handle({ type: 'record/start' }), 'UNSUPPORTED_PAGE');
  });

  it('refuse un site sans permission', async () => {
    setup({ allowed: [] });
    const response = await controller.handle({ type: 'record/start' });
    expectError(response, 'ORIGIN_NOT_ALLOWED');
    expect(await sessions.getSession()).toEqual(IDLE);
  });

  it('remonte l’échec d’injection du content script sans changer d’état', async () => {
    env.connectResult = fail('INJECTION_FAILED', 'Cannot access contents of the page');
    expectError(await controller.handle({ type: 'record/start' }), 'INJECTION_FAILED');
    expect(await sessions.getSession()).toEqual(IDLE);
  });

  it('Arrêter au repos est refusé', async () => {
    expectError(await controller.handle({ type: 'session/stop' }), 'INVALID_TRANSITION');
  });
});

describe('SessionController — replay', () => {
  beforeEach(() => setup());

  it('rejoue le workflow puis revient au repos avec un run réussi', async () => {
    const id = await recordOnce();
    const response = await controller.handle({ type: 'replay/start', workflowId: id });
    expect(response).toMatchObject({ ok: true, value: { status: 'replaying', workflowId: id } });

    await controller.settled();
    expect(env.navigations).toEqual(['http://localhost:5173/']);
    expect(await sessions.getSession()).toEqual(IDLE);
    expect(await sessions.getLastRun()).toMatchObject({ workflowId: id, outcome: 'succeeded', stepsCompleted: 1, totalSteps: 1 });
    expect(env.indicator).toBe('idle');
  });

  it('identifie l’étape en échec', async () => {
    const id = await recordOnce();
    env.navigateImpl = () => Promise.resolve(fail('NAVIGATION_FAILED', 'timeout'));
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.settled();
    expect(await sessions.getLastRun()).toMatchObject({
      outcome: 'failed',
      failure: { stepIndex: 0, code: 'NAVIGATION_FAILED', message: 'timeout' },
    });
    expect(await sessions.getSession()).toEqual(IDLE);
  });

  it('Arrêter interrompt proprement un replay en cours', async () => {
    const id = await recordOnce();
    const gate = deferred<Result<void>>();
    env.navigateImpl = () => gate.promise;

    await controller.handle({ type: 'replay/start', workflowId: id });
    const stopped = await controller.handle({ type: 'session/stop' });
    expect(stopped).toEqual({ ok: true, value: IDLE });

    // Comme le vrai driver : une navigation interrompue par l'arrêt se solde par un échec.
    gate.resolve(fail('NAVIGATION_FAILED', 'Exécution arrêtée.'));
    await controller.settled();
    const run = await sessions.getLastRun();
    expect(run).toMatchObject({ outcome: 'aborted', stepsCompleted: 0 });
    expect(run?.failure).toBeUndefined();
    expect(await sessions.getSession()).toEqual(IDLE);
  });

  it('refuse un workflow inconnu', async () => {
    expectError(await controller.handle({ type: 'replay/start', workflowId: 'nope' }), 'WORKFLOW_NOT_FOUND');
  });

  it('refuse si l’accès au site du workflow a été retiré', async () => {
    const id = await recordOnce();
    env.allowed.clear();
    expectError(await controller.handle({ type: 'replay/start', workflowId: id }), 'ORIGIN_NOT_ALLOWED');
  });

  it('refuse de supprimer le workflow en cours de lecture', async () => {
    const id = await recordOnce();
    const gate = deferred<Result<void>>();
    env.navigateImpl = () => gate.promise;
    await controller.handle({ type: 'replay/start', workflowId: id });
    expectError(await controller.handle({ type: 'workflow/delete', workflowId: id }), 'INVALID_TRANSITION');
    gate.resolve(ok(undefined));
    await controller.settled();
  });
});

describe('SessionController — suppression et reprise', () => {
  beforeEach(() => setup());

  it('supprime un workflow', async () => {
    const id = await recordOnce();
    expect((await controller.handle({ type: 'workflow/delete', workflowId: id })).ok).toBe(true);
    expect((await workflows.list()).workflows).toHaveLength(0);
    expectError(await controller.handle({ type: 'workflow/delete', workflowId: id }), 'WORKFLOW_NOT_FOUND');
  });

  it('au redémarrage du worker, un replay orphelin est marqué échoué et la session libérée', async () => {
    await sessions.setSession({ status: 'replaying', tabId: 1, workflowId: 'wf', startedAt: 1, stepIndex: 0 });
    await controller.recover();
    expect(await sessions.getSession()).toEqual(IDLE);
    expect(await sessions.getLastRun()).toMatchObject({ workflowId: 'wf', outcome: 'failed' });
  });

  it('au redémarrage du worker, un enregistrement continue', async () => {
    await controller.handle({ type: 'record/start' });
    await controller.recover();
    expect((await sessions.getSession()).status).toBe('recording');
    expect(env.indicator).toBe('recording');
  });
});
