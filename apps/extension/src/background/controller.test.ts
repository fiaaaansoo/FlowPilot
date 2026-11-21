import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE, fail, ok, type CommandResponse, type Result, type Workflow } from '@flowpilot/shared';
import { memoryArea } from '../storage/area';
import { RunStore } from '../storage/run-store';
import { SessionStore } from '../storage/session-store';
import { WorkflowStore } from '../storage/workflow-store';
import { FakeEnv, deferred, makeWorkflow, target } from '../test/fakes';
import { SessionController } from './controller';
import type { BackendClient } from './recovery';

let env: FakeEnv;
let sessions: SessionStore;
let workflows: WorkflowStore;
let runs: RunStore;
let controller: SessionController;
let clock: number;

function setup(envOptions?: ConstructorParameters<typeof FakeEnv>[0]) {
  env = new FakeEnv(envOptions);
  sessions = new SessionStore(memoryArea());
  const local = memoryArea();
  workflows = new WorkflowStore(local);
  runs = new RunStore(local);
  clock = Date.parse('2026-11-21T10:00:00Z');
  let seq = 0;
  controller = new SessionController({
    env,
    sessions,
    workflows,
    runs,
    now: () => clock,
    newId: () => `id-${++seq}`,
    createBackend: () => fakeBackend,
  });
}

/** Scripted recovery backend: proposes `proposeRef`, records outcome reports. */
let proposeRef = 'e2';
let requireConfirmation = false;
const reported: { id: string; verified: boolean }[] = [];
const fakeBackend: BackendClient = {
  propose: (request) =>
    Promise.resolve(
      ok({
        contract: 'flowpilot.recovery/v1',
        recoveryId: 'rec-1',
        binding: request.binding,
        decision: {
          type: 'propose_target',
          ref: proposeRef,
          confidence: 0.9,
          strategy: 'llm',
          rationale: 'synonyme',
          requiresConfirmation: requireConfirmation,
        },
        usage: {
          provider: 'mock',
          model: 'mock-1',
          promptVersion: 'recovery-v1',
          modelCalls: 1,
          inputTokens: 700,
          outputTokens: 40,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          latencyMs: 5,
          estimatedCostUsd: 0,
          contextElements: 1,
        },
      }),
    ),
  reportOutcome: (id, report) => {
    reported.push({ id, verified: report.verified });
    return Promise.resolve();
  },
};

const expectError = (response: CommandResponse, code: string) => {
  expect(response.ok).toBe(false);
  if (!response.ok) expect(response.error.code).toBe(code);
};

async function onlyWorkflow(): Promise<Workflow> {
  const { workflows: list } = await workflows.list();
  expect(list).toHaveLength(1);
  return list[0] as Workflow;
}

async function recordOnce(): Promise<string> {
  await controller.handle({ type: 'record/start' });
  await controller.handle({ type: 'session/stop' });
  return (await onlyWorkflow()).id;
}

async function seed(workflow: Workflow): Promise<string> {
  await workflows.save(workflow);
  return workflow.id;
}

async function isAwaiting(): Promise<boolean> {
  const session = await sessions.getSession();
  return session.status === 'replaying' && session.awaitingHuman === true;
}

/** Attend qu'une condition asynchrone devienne vraie (boucle de replay en arrière-plan). */
async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition non atteinte');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const performCount = () => env.calls.filter((c) => c.op === 'perform').length;

describe('SessionController — enregistrement', () => {
  beforeEach(() => setup());

  it('Enregistrer active la capture, Arrêter compile les événements en workflow', async () => {
    const started = await controller.handle({ type: 'record/start' });
    expect(started).toMatchObject({ ok: true, value: { status: 'recording', tabId: 7, origin: 'http://localhost:5173' } });
    expect(env.calls).toContainEqual({ op: 'capture', tabId: 7, recording: true });

    clock += 1000;
    await controller.recordEvents(7, [{ kind: 'input', at: clock, target: target('q', { tag: 'input', role: 'textbox' }), value: 'data' }]);
    clock += 500;
    await controller.recordEvents(7, [{ kind: 'click', at: clock, target: target('Rechercher') }]);
    clock += 300;
    await controller.recordNavigation(7, 'http://localhost:5173/results.html?q=data');

    expect(await controller.handle({ type: 'session/stop' })).toEqual({ ok: true, value: IDLE });
    expect(env.calls).toContainEqual({ op: 'capture', tabId: 7, recording: false });
    const workflow = await onlyWorkflow();
    expect(workflow.steps.map((s) => s.kind)).toEqual(['navigate', 'input', 'click', 'waitForNavigation']);
    expect(await sessions.getDraft()).toBeNull();
  });

  it('assainit les URL avant de les stocker et date la navigation à sa réception', async () => {
    setup({ tab: { id: 7, url: 'http://localhost:5173/?session=abc&q=1' } });
    await controller.handle({ type: 'record/start' });
    expect(env.armedOrigin).toBe('http://localhost:5173');
    await controller.recordEvents(7, [{ kind: 'click', at: clock + 10, target: target('Lien') }]);
    await controller.recordNavigation(7, 'http://localhost:5173/reset?token=s3cr3t#access_token=x', clock + 20);
    expect((await sessions.getDraft())?.events.at(-1)).toEqual({ kind: 'navigation', at: clock, url: 'http://localhost:5173/reset' });
    await controller.handle({ type: 'session/stop' });
    expect(env.armedOrigin).toBeNull();
    const workflow = await onlyWorkflow();
    expect(JSON.stringify(workflow)).not.toMatch(/s3cr3t|session=abc|access_token/);
    expect(workflow.steps[0]).toMatchObject({ kind: 'navigate', url: 'http://localhost:5173/?q=1' });
  });

  it('un échec de sauvegarde libère la session, signale l’erreur et garde le brouillon', async () => {
    await controller.handle({ type: 'record/start' });
    workflows.save = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    const response = await controller.handle({ type: 'session/stop' });
    expectError(response, 'INTERNAL');
    expect(await sessions.getSession()).toEqual(IDLE);
    expect(await sessions.getDraft()).not.toBeNull();
  });

  it('ignore les événements d’un autre onglet que celui enregistré', async () => {
    await controller.handle({ type: 'record/start' });
    await controller.recordEvents(99, [{ kind: 'click', at: clock, target: target('Ailleurs') }]);
    await controller.recordNavigation(99, 'http://localhost:5173/autre');
    await controller.handle({ type: 'session/stop' });
    expect((await onlyWorkflow()).steps).toHaveLength(1);
  });

  it('ignore les événements reçus hors enregistrement', async () => {
    await controller.recordEvents(7, [{ kind: 'click', at: clock, target: target('Hors session') }]);
    expect(await sessions.getDraft()).toBeNull();
  });

  it('récupère les saisies non validées au moment de l’arrêt', async () => {
    await controller.handle({ type: 'record/start' });
    env.flushOnStop = [{ kind: 'input', at: clock + 10, target: target('q', { tag: 'input' }), value: 'en cours' }];
    await controller.handle({ type: 'session/stop' });
    expect((await onlyWorkflow()).steps[1]).toMatchObject({ kind: 'input', value: 'en cours' });
  });

  it('borne les horodatages venus de la page à la durée de l’enregistrement', async () => {
    await controller.handle({ type: 'record/start' });
    await controller.recordEvents(7, [{ kind: 'click', at: 0, target: target('Avant') }]);
    expect((await sessions.getDraft())?.events[0]?.at).toBe(clock);
  });

  it('relance la capture après un chargement de page de l’onglet enregistré', async () => {
    await controller.handle({ type: 'record/start' });
    env.contentRecording = false; // nouvelle page : content script neuf
    env.calls = [];
    await controller.onTabLoaded(7, 'http://localhost:5173/results.html');
    expect(env.calls).toEqual([{ op: 'capture', tabId: 7, recording: true }]);
  });

  it('ne réinjecte pas sur un site non autorisé ni sur un autre onglet', async () => {
    await controller.handle({ type: 'record/start' });
    env.contentRecording = false;
    env.calls = [];
    await controller.onTabLoaded(7, 'https://ailleurs.example/');
    await controller.onTabLoaded(8, 'http://localhost:5173/');
    expect(env.calls).toEqual([]);
  });

  it('fermer l’onglet enregistré sauvegarde le workflow et libère la session', async () => {
    await controller.handle({ type: 'record/start' });
    await controller.onTabRemoved(7);
    expect(await sessions.getSession()).toEqual(IDLE);
    expect(await onlyWorkflow()).toBeDefined();
  });

  it('refuse un second enregistrement simultané (double clic)', async () => {
    const [a, b] = await Promise.all([controller.handle({ type: 'record/start' }), controller.handle({ type: 'record/start' })]);
    expect(a.ok).toBe(true);
    expectError(b, 'INVALID_TRANSITION');
  });

  it.each([
    ['sans onglet actif', { tab: null }, 'NO_ACTIVE_TAB'],
    ['URL masquée', { tab: { id: 1, url: undefined } }, 'ORIGIN_NOT_ALLOWED'],
    ['page non http(s)', { tab: { id: 1, url: 'chrome://extensions/' } }, 'UNSUPPORTED_PAGE'],
    ['site sans permission', { allowed: [] }, 'ORIGIN_NOT_ALLOWED'],
  ] as const)('refuse : %s', async (_label, options, code) => {
    setup(options);
    expectError(await controller.handle({ type: 'record/start' }), code);
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

  it('exécute les étapes dans l’ordre et enregistre un run journalisé', async () => {
    const id = await seed(
      makeWorkflow([
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
        { id: 's2', kind: 'input', target: target('q', { tag: 'input' }), value: 'data' },
        { id: 's3', kind: 'click', target: target('Rechercher') },
        { id: 's4', kind: 'waitForNavigation', url: 'http://localhost:5173/results.html?q=data' },
      ]),
    );
    expect(await controller.handle({ type: 'replay/start', workflowId: id })).toMatchObject({
      ok: true,
      value: { status: 'replaying', workflowId: id },
    });
    await controller.settled();

    expect(env.calls.map((c) => c.op)).toEqual(['navigate', 'perform', 'perform', 'waitForNavigation']);
    const [run] = await runs.list();
    expect(run).toMatchObject({ workflowId: id, outcome: 'succeeded', stepsCompleted: 4, totalSteps: 4 });
    expect(run?.log.map((l) => [l.stepIndex, l.status, l.strategy])).toEqual([
      [0, 'succeeded', undefined],
      [1, 'succeeded', 'role'],
      [2, 'succeeded', 'role'],
      [3, 'succeeded', undefined],
    ]);
    expect(await sessions.getSession()).toEqual(IDLE);
  });

  it('identifie l’étape en échec (cible ambiguë) et s’arrête', async () => {
    const id = await seed(
      makeWorkflow([
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
        { id: 's2', kind: 'click', target: target('Voir') },
        { id: 's3', kind: 'click', target: target('Suite') },
      ]),
    );
    env.performImpl = () => Promise.resolve(fail('TARGET_AMBIGUOUS', '2 éléments correspondent à L’élément « Voir ».'));
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.settled();
    expect((await runs.list())[0]).toMatchObject({ outcome: 'failed', failure: { stepIndex: 1, code: 'TARGET_AMBIGUOUS' } });
    expect(performCount()).toBe(1);
  });

  it('attend une confirmation humaine avant une action irréversible', async () => {
    const id = await seed(
      makeWorkflow([
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
        { id: 's2', kind: 'click', target: target('Envoyer la candidature'), confirm: true },
      ]),
    );
    await controller.handle({ type: 'replay/start', workflowId: id });
    await waitUntil(isAwaiting);
    expect(performCount()).toBe(0);

    expectError(await controller.handle({ type: 'replay/continue', stepIndex: 0 }), 'INVALID_TRANSITION');
    expect(await controller.handle({ type: 'replay/continue', stepIndex: 1 })).toMatchObject({ ok: true });
    await controller.settled();
    expect(performCount()).toBe(1);
    expect((await runs.list())[0]).toMatchObject({ outcome: 'succeeded' });
  });

  it('Arrêter pendant l’attente de confirmation n’exécute pas l’action', async () => {
    const id = await seed(makeWorkflow([{ id: 's1', kind: 'click', target: target('Supprimer'), confirm: true }]));
    await controller.handle({ type: 'replay/start', workflowId: id });
    await waitUntil(isAwaiting);
    expect(await controller.handle({ type: 'session/stop' })).toEqual({ ok: true, value: IDLE });
    await controller.settled();
    expect(performCount()).toBe(0);
    expect((await runs.list())[0]).toMatchObject({ outcome: 'aborted', log: [{ status: 'aborted' }] });
  });

  it('Arrêter interrompt proprement une navigation en cours', async () => {
    const id = await recordOnce();
    const gate = deferred<Result<void>>();
    env.navigateImpl = () => gate.promise;
    await controller.handle({ type: 'replay/start', workflowId: id });
    expect(await controller.handle({ type: 'session/stop' })).toEqual({ ok: true, value: IDLE });
    // Comme le vrai driver : une navigation interrompue par l'arrêt se solde par un échec.
    gate.resolve(fail('NAVIGATION_FAILED', 'Exécution arrêtée.'));
    await controller.settled();
    const [run] = await runs.list();
    expect(run).toMatchObject({ outcome: 'aborted', stepsCompleted: 0 });
    expect(run?.failure).toBeUndefined();
  });

  it('fermer l’onglet pendant un replay l’interrompt', async () => {
    const id = await recordOnce();
    env.navigateImpl = (_url, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(fail('NAVIGATION_FAILED', 'Exécution arrêtée.')));
      });
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.onTabRemoved(7);
    await controller.settled();
    expect((await runs.list())[0]).toMatchObject({ outcome: 'aborted' });
    expect(await sessions.getSession()).toEqual(IDLE);
  });

  it('refuse un nouveau replay tant que le précédent, arrêté, n’a pas fini son étape', async () => {
    const id = await recordOnce();
    const gate = deferred<Result<void>>();
    env.navigateImpl = () => gate.promise;
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.handle({ type: 'session/stop' });
    expectError(await controller.handle({ type: 'replay/start', workflowId: id }), 'INVALID_TRANSITION');
    gate.resolve(fail('NAVIGATION_FAILED', 'Exécution arrêtée.'));
    await controller.settled();
    env.navigateImpl = () => Promise.resolve(ok(undefined));
    expect((await controller.handle({ type: 'replay/start', workflowId: id })).ok).toBe(true);
    await controller.settled();
  });

  it('refuse un workflow inconnu, ou dont le site n’est plus autorisé', async () => {
    expectError(await controller.handle({ type: 'replay/start', workflowId: 'nope' }), 'WORKFLOW_NOT_FOUND');
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

  it('supprime un workflow et son historique', async () => {
    const id = await recordOnce();
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.settled();
    expect((await controller.handle({ type: 'workflow/delete', workflowId: id })).ok).toBe(true);
    expect((await workflows.list()).workflows).toHaveLength(0);
    expect(await runs.list()).toHaveLength(0);
    expectError(await controller.handle({ type: 'workflow/delete', workflowId: id }), 'WORKFLOW_NOT_FOUND');
  });

  it('au redémarrage du worker, un replay orphelin est marqué échoué et la session libérée', async () => {
    await sessions.setSession({ status: 'replaying', tabId: 1, workflowId: 'wf', startedAt: 1, stepIndex: 0, awaitingHuman: true });
    await controller.recover();
    expect(await sessions.getSession()).toEqual(IDLE);
    expect((await runs.list())[0]).toMatchObject({ workflowId: 'wf', outcome: 'failed' });
  });

  it('au redémarrage du worker, un enregistrement continue', async () => {
    await controller.handle({ type: 'record/start' });
    await controller.recover();
    expect((await sessions.getSession()).status).toBe('recording');
    expect(env.indicator).toBe('recording');
  });
});

describe('SessionController — AI recovery', () => {
  const flow = () =>
    makeWorkflow([
      { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
      { id: 's2', kind: 'click', target: target('Rechercher') },
      { id: 's3', kind: 'waitForNavigation', url: 'http://localhost:5173/results.html' },
    ]);
  const enabled = { enabled: true, endpoint: 'http://127.0.0.1:8787', token: 't'.repeat(32), mode: 'auto-when-safe' as const };

  beforeEach(() => {
    setup();
    proposeRef = 'e2';
    requireConfirmation = false;
    reported.length = 0;
    env.performImpl = () => Promise.resolve(fail('TARGET_NOT_FOUND', 'L’élément « Rechercher » est introuvable dans la page.'));
    env.observation = {
      snapshotId: 'snap-1',
      url: 'http://localhost:5173/',
      title: 'Démo',
      elements: [{ ref: 'e2', tag: 'button', role: 'button', name: 'Trouver des offres', attributes: { type: 'submit' } }],
    };
  });

  it('is off by default: the failure is reported exactly as without AI', async () => {
    const id = await seed(flow());
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.settled();
    const [run] = await runs.list();
    expect(run).toMatchObject({ outcome: 'failed', failure: { stepIndex: 1, code: 'TARGET_NOT_FOUND' } });
    expect(run?.log[1]?.recovery).toBeUndefined();
    expect(env.refCalls).toEqual([]);
  });

  it('recovers the step, continues, and reports the outcome once the next step succeeds', async () => {
    env.aiSettings = enabled;
    const id = await seed(flow());
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.settled();
    const [run] = await runs.list();
    expect(run).toMatchObject({ outcome: 'succeeded', stepsCompleted: 3 });
    expect(run?.log[1]).toMatchObject({ status: 'succeeded', strategy: 'ai:llm', recovery: { outcome: 'recovered', modelCalls: 1 } });
    expect(env.refCalls).toEqual([{ ref: 'e2', confirmed: false }]);
    expect(reported).toEqual([{ id: 'rec-1', verified: true }]);
  });

  it('a recovered step followed by a failure is reported as not verified', async () => {
    env.aiSettings = enabled;
    env.navigateImpl = (url) => Promise.resolve(url.endsWith('results.html') ? fail('NAVIGATION_FAILED', 'pas de navigation') : ok(undefined));
    const id = await seed(flow());
    await controller.handle({ type: 'replay/start', workflowId: id });
    await controller.settled();
    expect((await runs.list())[0]).toMatchObject({ outcome: 'failed', failure: { stepIndex: 2 } });
    expect(reported).toEqual([{ id: 'rec-1', verified: false }]);
  });

  it('shows the proposal to the user before executing it when confirmation is required', async () => {
    env.aiSettings = enabled;
    requireConfirmation = true;
    const id = await seed(flow());
    await controller.handle({ type: 'replay/start', workflowId: id });
    await waitUntil(isAwaiting);
    expect(await sessions.getSession()).toMatchObject({ awaitingHuman: true, humanPrompt: { kind: 'ai-proposal', strategy: 'llm' } });
    expect(env.refCalls).toEqual([]);
    await controller.handle({ type: 'replay/continue', stepIndex: 1 });
    await controller.settled();
    expect(env.refCalls).toEqual([{ ref: 'e2', confirmed: true }]);
    expect((await runs.list())[0]?.outcome).toBe('succeeded');
  });
});
