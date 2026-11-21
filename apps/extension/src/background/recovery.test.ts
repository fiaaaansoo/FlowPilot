import { describe, expect, it, vi } from 'vitest';
import {
  RUN_RECOVERY_LIMITS,
  fail,
  ok,
  type Candidate,
  type ElementStep,
  type Observation,
  type RecoveryRequest,
  type RecoveryResponse,
  type Result,
} from '@flowpilot/shared';
import { target } from '../test/fakes';
import { RunRecoveryBudget, createBackendClient, recoverStep, type BackendClient, type RecoveryContext, type RecoveryEnv } from './recovery';

const STEP: ElementStep = { id: 's5', kind: 'click', target: target('Rechercher des offres') };
const BUTTON: Candidate = { ref: 'e2', tag: 'button', role: 'button', name: 'Trouver des offres', attributes: { type: 'submit' } };
const LINK_OUT: Candidate = { ref: 'e3', tag: 'a', role: 'link', name: 'Partenaire', attributes: { href: 'https://evil.example' }, sameOrigin: false };
const FIELD: Candidate = { ref: 'e4', tag: 'input', role: 'textbox', name: 'Mots-clés', attributes: {} };

let snapshot = 0;
function env(elements: Candidate[] = [BUTTON, LINK_OUT, FIELD], perform?: RecoveryEnv['performRef']) {
  const calls: { ref: string; confirmed: boolean; snapshotId: string }[] = [];
  const recoveryEnv: RecoveryEnv = {
    observe: () => {
      snapshot += 1;
      const observation: Observation = { snapshotId: `snap-${snapshot}`, url: 'http://localhost:5173/', title: 'Démo', elements };
      return Promise.resolve(ok(observation));
    },
    performRef: (tabId, step, snapshotId, ref, confirmed, signal) => {
      calls.push({ ref, confirmed, snapshotId });
      return perform ? perform(tabId, step, snapshotId, ref, confirmed, signal) : Promise.resolve(ok({ strategy: 'ai' }));
    },
  };
  return { recoveryEnv, calls };
}

type Decision = RecoveryResponse['decision'];
const propose = (ref: string, extra: Partial<Extract<Decision, { type: 'propose_target' }>> = {}): Decision => ({
  type: 'propose_target',
  ref,
  confidence: 0.9,
  strategy: 'llm',
  rationale: 'synonyme',
  requiresConfirmation: false,
  ...extra,
});

function backend(...decisions: (Decision | Result<never>)[]) {
  const requests: RecoveryRequest[] = [];
  const outcomes: { id: string; verified: boolean }[] = [];
  const client: BackendClient = {
    propose: (request) => {
      requests.push(request);
      const next = decisions.shift() ?? { type: 'escalate', strategy: 'none', reason: 'plus rien' };
      if ('ok' in next) return Promise.resolve(next);
      return Promise.resolve(
        ok({
          contract: 'flowpilot.recovery/v1',
          recoveryId: `rec-${requests.length}`,
          binding: request.binding,
          decision: next,
          usage: {
            provider: 'mock', model: 'mock-1', promptVersion: 'recovery-v1', modelCalls: 1, inputTokens: 700, outputTokens: 40,
            cacheReadTokens: null, cacheWriteTokens: null, latencyMs: 5, estimatedCostUsd: 0, contextElements: 2,
          },
        }),
      );
    },
    reportOutcome: (id, report) => {
      outcomes.push({ id, verified: report.verified });
      return Promise.resolve();
    },
  };
  return { client, requests, outcomes };
}

function context(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    origin: 'http://localhost:5173',
    tabId: 7,
    stepIndex: 4,
    step: STEP,
    failure: { code: 'TARGET_NOT_FOUND', message: 'introuvable' },
    signal: new AbortController().signal,
    mode: 'auto-when-safe',
    budget: new RunRecoveryBudget(),
    requestHuman: vi.fn(() => Promise.resolve(true)),
    now: () => 1_000,
    ...overrides,
  };
}

describe('recoverStep', () => {
  it('executes a validated proposal on the observed element, with the recorded action', async () => {
    const { recoveryEnv, calls } = env();
    const { client, requests } = backend(propose('e2'));
    const result = await recoverStep(recoveryEnv, client, context());
    expect(result).toMatchObject({ ok: true, strategy: 'ai:llm', pending: { recoveryId: 'rec-1', candidate: BUTTON } });
    expect(calls).toEqual([{ ref: 'e2', confirmed: false, snapshotId: requests[0]?.binding.snapshotId }]);
    expect(requests[0]).toMatchObject({ contract: 'flowpilot.recovery/v1', step: { kind: 'click' }, binding: { tabId: 7, stepId: 's5' } });
    expect(result.log).toMatchObject({ outcome: 'recovered', attempts: 1, modelCalls: 1, inputTokens: 700, provider: 'mock' });
  });

  it('never observes for the backend when the tab is on another origin than the workflow', async () => {
    const { recoveryEnv, calls } = env();
    const { client, requests } = backend(propose('e2'));
    const result = await recoverStep(recoveryEnv, client, context({ origin: 'https://bank.example' }));
    expect(result).toMatchObject({ ok: false, log: { outcome: 'escalated' } });
    expect(requests).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('escalates when the backend escalates, without touching the page', async () => {
    const { recoveryEnv, calls } = env();
    const result = await recoverStep(recoveryEnv, backend({ type: 'escalate', strategy: 'llm', reason: 'deux boutons possibles' }).client, context());
    expect(result).toMatchObject({ ok: false, log: { outcome: 'escalated', reason: 'deux boutons possibles' } });
    expect(calls).toEqual([]);
  });

  it('reports an unavailable backend explicitly (no fallback)', async () => {
    const { recoveryEnv } = env();
    const result = await recoverStep(recoveryEnv, backend(fail('RECOVERY_UNAVAILABLE', 'injoignable')).client, context());
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' }, log: { outcome: 'unavailable' } });
  });

  it.each([
    ['a cross-origin link', 'e3'],
    ['an element incompatible with a click', 'e4'],
    ['an element that was not observed', 'e99'],
  ])('rejects %s, then retries with the rejected candidate excluded', async (_label, ref) => {
    const { recoveryEnv, calls } = env();
    const { client, requests, outcomes } = backend(propose(ref), propose('e2'));
    const result = await recoverStep(recoveryEnv, client, context());
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.ref)).toEqual(['e2']);
    expect(outcomes[0]).toEqual({ id: 'rec-1', verified: false });
    if (ref !== 'e99') expect(requests[1]?.attempts[0]).toMatchObject({ outcome: 'rejected', candidate: { ref } });
  });

  it('rejects a response bound to another snapshot or run (stale proposal)', async () => {
    const { recoveryEnv, calls } = env();
    const stale: BackendClient = {
      propose: (request) =>
        Promise.resolve(
          ok({
            contract: 'flowpilot.recovery/v1',
            recoveryId: 'rec-x',
            binding: { ...request.binding, snapshotId: 'old-snapshot' },
            decision: propose('e2'),
            usage: { provider: 'mock', model: null, promptVersion: 'recovery-v1', modelCalls: 0, inputTokens: 0, outputTokens: 0,
              cacheReadTokens: null, cacheWriteTokens: null, latencyMs: 1, estimatedCostUsd: 0, contextElements: 0 },
          }),
        ),
      reportOutcome: () => Promise.resolve(),
    };
    const result = await recoverStep(recoveryEnv, stale, context());
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a failed execution is retried once on a fresh snapshot, then escalates', async () => {
    const { recoveryEnv, calls } = env(undefined, () => Promise.resolve(fail('TARGET_NOT_FOUND', 'L’élément proposé a changé.')));
    const { client, requests } = backend(propose('e2'), propose('e2'));
    const result = await recoverStep(recoveryEnv, client, context());
    expect(result).toMatchObject({ ok: false, log: { outcome: 'escalated', attempts: RUN_RECOVERY_LIMITS.maxAttemptsPerStep } });
    expect(new Set(calls.map((c) => c.snapshotId)).size).toBe(2);
    expect(requests[1]?.attempts).toEqual([{ candidate: BUTTON, outcome: 'failed', reason: 'L’élément proposé a changé.' }]);
  });

  interface HumanCase {
    decision: Decision;
    elements?: Candidate[];
    mode?: RecoveryContext['mode'];
  }
  it.each<[string, HumanCase]>([
    ['the backend asks for it', { decision: propose('e2', { requiresConfirmation: true }) }],
    ['the element is irreversible', { decision: propose('e2'), elements: [{ ...BUTTON, irreversible: true }] }],
    ['the user chose "always confirm"', { decision: propose('e2'), mode: 'confirm-always' }],
  ])('asks a human first when %s', async (_label, setup) => {
    const { recoveryEnv, calls } = env(setup.elements);
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const result = await recoverStep(recoveryEnv, backend(setup.decision).client, context({ requestHuman, ...(setup.mode ? { mode: setup.mode } : {}) }));
    expect(requestHuman).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ai-proposal', proposed: expect.stringContaining('Trouver des offres') as string }));
    expect(result.ok).toBe(true);
    expect(calls[0]?.confirmed).toBe(true);
  });

  it('a model never redirects a recorded value alone, even if the backend does not ask', async () => {
    const { recoveryEnv, calls } = env();
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const step: ElementStep = { id: 's2', kind: 'input', value: 'data', target: target('Mots-clés') };
    const result = await recoverStep(recoveryEnv, backend(propose('e4')).client, context({ step, requestHuman }));
    expect(requestHuman).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(calls[0]?.confirmed).toBe(true);
  });

  it('a response arriving after the run was stopped is never acted on', async () => {
    const { recoveryEnv, calls } = env();
    const controller = new AbortController();
    const { client, outcomes } = backend(propose('e2'));
    const late: BackendClient = {
      propose: async (request, signal) => {
        const response = await client.propose(request, signal);
        controller.abort(); // the user stopped the replay while the backend was answering
        return response;
      },
      reportOutcome: (id, report) => client.reportOutcome(id, report),
    };
    const result = await recoverStep(recoveryEnv, late, context({ signal: controller.signal }));
    expect(result).toMatchObject({ ok: false, log: { outcome: 'aborted' } });
    expect(calls).toEqual([]);
    expect(outcomes).toEqual([{ id: 'rec-1', verified: false }]);
  });

  it('a run stopped during the confirmation prompt executes nothing, even if the prompt resolves', async () => {
    const { recoveryEnv, calls } = env();
    const controller = new AbortController();
    const requestHuman = vi.fn(() => {
      controller.abort();
      return Promise.resolve(true);
    });
    const result = await recoverStep(
      recoveryEnv,
      backend(propose('e2', { requiresConfirmation: true })).client,
      context({ signal: controller.signal, requestHuman }),
    );
    expect(result).toMatchObject({ ok: false, log: { outcome: 'aborted' } });
    expect(calls).toEqual([]);
  });

  it('a model choice sharing no word or identifier with the recorded element is confirmed first', async () => {
    const { recoveryEnv, calls } = env([{ ...BUTTON, name: 'Se déconnecter' }]);
    const requestHuman = vi.fn(() => Promise.resolve(false));
    const result = await recoverStep(recoveryEnv, backend(propose('e2')).client, context({ requestHuman }));
    expect(requestHuman).toHaveBeenCalledOnce(); // the backend said "no confirmation"; the extension asks anyway
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a memorized correction never types a recorded value without the user', async () => {
    const { recoveryEnv, calls } = env();
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const step: ElementStep = { id: 's2', kind: 'input', value: 'data', target: target('Mots-clés') };
    await recoverStep(recoveryEnv, backend(propose('e4', { strategy: 'memory' })).client, context({ step, requestHuman }));
    expect(requestHuman).toHaveBeenCalledOnce();
    expect(calls[0]?.confirmed).toBe(true);
  });

  it('stopping at the confirmation prompt executes nothing', async () => {
    const { recoveryEnv, calls } = env();
    const result = await recoverStep(
      recoveryEnv,
      backend(propose('e2', { requiresConfirmation: true })).client,
      context({ requestHuman: () => Promise.resolve(false) }),
    );
    expect(result).toMatchObject({ ok: false, log: { outcome: 'aborted' } });
    expect(calls).toEqual([]);
  });

  it('asks a human when the page itself judges the element irreversible, then retries confirmed', async () => {
    const { recoveryEnv, calls } = env(undefined, (_t, _s, _snap, _ref, confirmed) =>
      Promise.resolve(confirmed ? ok({ strategy: 'ai' }) : fail('CONFIRMATION_REQUIRED', 'irréversible')),
    );
    const requestHuman = vi.fn(() => Promise.resolve(true));
    const result = await recoverStep(recoveryEnv, backend(propose('e2')).client, context({ requestHuman }));
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.confirmed)).toEqual([false, true]);
    expect(requestHuman).toHaveBeenCalledOnce();
  });

  it('enforces the per-run recovery budget', async () => {
    const budget = new RunRecoveryBudget();
    budget.recoveries = RUN_RECOVERY_LIMITS.maxRecoveries;
    const { client, requests } = backend(propose('e2'));
    const result = await recoverStep(env().recoveryEnv, client, context({ budget }));
    expect(result).toMatchObject({ ok: false, log: { outcome: 'escalated' } });
    expect(requests).toEqual([]);

    const tokens = new RunRecoveryBudget();
    tokens.tokens = RUN_RECOVERY_LIMITS.maxTokens - 100;
    expect(tokens.requestBudget().maxTokens).toBe(100);
  });
});

describe('createBackendClient', () => {
  const settings = { enabled: true, endpoint: 'http://127.0.0.1:8787', token: 't'.repeat(32), mode: 'auto-when-safe' as const };

  it('sends the bearer token, no credentials, and validates the response', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify({ contract: 'nope' }), { status: 200 })));
    const result = await createBackendClient(settings, fetchImpl).propose({} as RecoveryRequest, new AbortController().signal);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8787/v1/recovery/propose');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${'t'.repeat(32)}` } });
    expect(result).toMatchObject({ ok: false, error: { code: 'RECOVERY_UNAVAILABLE' } });
  });

  it('maps a refused token and a network failure to explicit errors', async () => {
    const refused = await createBackendClient(settings, () => Promise.resolve(new Response('{}', { status: 401 }))).propose(
      {} as RecoveryRequest,
      new AbortController().signal,
    );
    expect(refused).toMatchObject({ ok: false, error: { message: expect.stringContaining('jeton') as string } });
    const down = await createBackendClient(settings, () => Promise.reject(new TypeError('Failed to fetch'))).propose(
      {} as RecoveryRequest,
      new AbortController().signal,
    );
    expect(down).toMatchObject({ ok: false, error: { code: 'RECOVERY_UNAVAILABLE' } });
  });
});
