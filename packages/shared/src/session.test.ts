import { describe, expect, it } from 'vitest';
import { IDLE, availableCommands, parseSession, transition, type SessionState } from './session.js';

const recording: SessionState = {
  status: 'recording',
  tabId: 1,
  origin: 'http://localhost:5173',
  workflowId: 'wf-1',
  startedAt: 100,
};

const replaying: SessionState = { status: 'replaying', tabId: 1, workflowId: 'wf-1', startedAt: 100, stepIndex: 0 };

describe('transition', () => {
  it('idle → recording → idle', () => {
    const started = transition(IDLE, {
      type: 'RECORD_STARTED',
      tabId: 1,
      origin: 'http://localhost:5173',
      workflowId: 'wf-1',
      startedAt: 100,
    });
    expect(started).toEqual({ ok: true, value: recording });
    expect(transition(recording, { type: 'STOPPED' })).toEqual({ ok: true, value: IDLE });
  });

  it('idle → replaying → idle (fin normale ou arrêt)', () => {
    const started = transition(IDLE, { type: 'REPLAY_STARTED', tabId: 1, workflowId: 'wf-1', startedAt: 100 });
    expect(started).toEqual({ ok: true, value: replaying });
    expect(transition(replaying, { type: 'REPLAY_FINISHED' })).toEqual({ ok: true, value: IDLE });
    expect(transition(replaying, { type: 'STOPPED' })).toEqual({ ok: true, value: IDLE });
  });

  it('suit l’étape courante pendant le replay', () => {
    expect(transition(replaying, { type: 'STEP_STARTED', stepIndex: 2 })).toEqual({
      ok: true,
      value: { ...replaying, stepIndex: 2 },
    });
  });

  it.each([
    ['enregistrer pendant un enregistrement', recording, { type: 'RECORD_STARTED', tabId: 1, origin: 'o', workflowId: 'w', startedAt: 0 }],
    ['rejouer pendant un enregistrement', recording, { type: 'REPLAY_STARTED', tabId: 1, workflowId: 'w', startedAt: 0 }],
    ['arrêter au repos', IDLE, { type: 'STOPPED' }],
    ['terminer un replay inexistant', recording, { type: 'REPLAY_FINISHED' }],
    ['avancer d’étape hors replay', IDLE, { type: 'STEP_STARTED', stepIndex: 1 }],
  ] as const)('refuse : %s', (_label, state, event) => {
    const result = transition(state, event);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('intervention humaine', () => {
  it('met le replay en pause puis le reprend sur la même étape', () => {
    const paused = transition(replaying, { type: 'HUMAN_REQUESTED', stepIndex: 3 });
    expect(paused).toEqual({ ok: true, value: { ...replaying, stepIndex: 3, awaitingHuman: true } });
    if (!paused.ok) return;
    expect(transition(paused.value, { type: 'HUMAN_RESOLVED' })).toEqual({ ok: true, value: { ...replaying, stepIndex: 3 } });
    expect(transition(paused.value, { type: 'HUMAN_REQUESTED', stepIndex: 3 }).ok).toBe(false);
    expect(transition(paused.value, { type: 'STOPPED' })).toEqual({ ok: true, value: IDLE });
  });

  it('refuse une reprise sans attente, et hors replay', () => {
    expect(transition(replaying, { type: 'HUMAN_RESOLVED' }).ok).toBe(false);
    expect(transition(recording, { type: 'HUMAN_REQUESTED', stepIndex: 0 }).ok).toBe(false);
  });

  it('relit l’attente depuis le stockage', () => {
    expect(parseSession({ ...replaying, awaitingHuman: true })).toEqual({ ...replaying, awaitingHuman: true });
    expect(parseSession({ ...replaying, awaitingHuman: 'oui' })).toEqual(replaying);
  });
});

describe('availableCommands', () => {
  it('au repos : enregistrer, rejouer seulement si un workflow existe', () => {
    expect(availableCommands(IDLE, false)).toEqual({ canRecord: true, canStop: false, canReplay: false });
    expect(availableCommands(IDLE, true)).toEqual({ canRecord: true, canStop: false, canReplay: true });
  });

  it('en cours : seul Arrêter est disponible', () => {
    for (const state of [recording, replaying]) {
      expect(availableCommands(state, true)).toEqual({ canRecord: false, canStop: true, canReplay: false });
    }
  });
});

describe('parseSession', () => {
  it('keeps the warning of an AI proposal, bounded, and drops a malformed one', () => {
    const prompt = { kind: 'ai-proposal', proposed: '« Envoyer »', strategy: 'llm', confidence: 0.9, rationale: 'r' };
    const awaiting = { ...replaying, awaitingHuman: true };
    expect(parseSession({ ...awaiting, humanPrompt: { ...prompt, warning: 'x'.repeat(400) } })).toMatchObject({ humanPrompt: { warning: 'x'.repeat(300) } });
    expect(parseSession({ ...awaiting, humanPrompt: { ...prompt, warning: 42 } })).toEqual({ ...awaiting, humanPrompt: prompt });
  });

  it('relit un état valide', () => {
    expect(parseSession(recording)).toEqual(recording);
    expect(parseSession(replaying)).toEqual(replaying);
  });

  it.each([undefined, null, 42, {}, { status: 'recording' }, { status: 'replaying', tabId: 'x' }, { status: 'hacked' }])(
    'ramène une donnée invalide à idle (%j)',
    (raw) => {
      expect(parseSession(raw)).toEqual(IDLE);
    },
  );
});
