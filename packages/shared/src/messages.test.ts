import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  isCommand,
  isContentPong,
  isContentRequest,
  parseContentEvent,
  parsePerformResponse,
  parseRecordAck,
} from './messages.js';

const target = { tag: 'button', name: 'Go', attributes: {}, css: '#go' };

describe('isCommand', () => {
  it.each([
    { type: 'session/get' },
    { type: 'record/start' },
    { type: 'session/stop' },
    { type: 'replay/start', workflowId: 'wf' },
    { type: 'replay/continue', stepIndex: 2 },
    { type: 'workflow/delete', workflowId: 'wf' },
  ])('accepte %j', (msg) => {
    expect(isCommand(msg)).toBe(true);
  });

  it.each([
    null,
    'record/start',
    {},
    { type: 'exec', code: '1' },
    { type: 'replay/start' },
    { type: 'replay/start', workflowId: '' },
    { type: 'replay/continue', stepIndex: '1' },
    { type: 'workflow/delete' },
  ])('rejette %j', (msg) => {
    expect(isCommand(msg)).toBe(false);
  });
});

describe('protocole content script', () => {
  it('reconnaît les requêtes et le pong versionné', () => {
    expect(isContentRequest({ type: 'content/ping' })).toBe(true);
    expect(isContentRequest({ type: 'content/record', recording: true })).toBe(true);
    expect(isContentRequest({ type: 'content/perform', step: { id: 's' }, timeoutMs: 100 })).toBe(true);
    expect(isContentRequest({ type: 'content/record' })).toBe(false);
    expect(isContentRequest({ type: 'other' })).toBe(false);
    const pong = { type: 'content/pong', protocolVersion: PROTOCOL_VERSION, url: 'http://x/', recording: false };
    expect(isContentPong(pong)).toBe(true);
    expect(isContentPong({ ...pong, protocolVersion: 1 })).toBe(false);
  });

  it('valide les événements de capture', () => {
    expect(parseContentEvent({ type: 'recorder/event', event: { kind: 'click', at: 1, target } })).toMatchObject({ kind: 'click' });
    expect(parseContentEvent({ type: 'recorder/event', event: { kind: 'click', at: 1 } })).toBeNull();
    expect(parseContentEvent({ type: 'autre', event: { kind: 'click', at: 1, target } })).toBeNull();
  });

  it('filtre les saisies vidées à l’arrêt', () => {
    expect(
      parseRecordAck({ type: 'content/record-ack', flushed: [{ kind: 'input', at: 1, target, value: 'x' }, { kind: 'bad' }] }),
    ).toHaveLength(1);
    expect(parseRecordAck({ type: 'content/record-ack' })).toBeNull();
  });

  it('valide la réponse d’une action, codes d’erreur compris', () => {
    expect(parsePerformResponse({ ok: true, value: { strategy: 'role' } })).toEqual({ ok: true, value: { strategy: 'role' } });
    expect(parsePerformResponse({ ok: false, error: { code: 'TARGET_AMBIGUOUS', message: 'deux' } })).toMatchObject({ ok: false });
    expect(parsePerformResponse({ ok: false, error: { code: 'PWNED', message: 'x' } })).toBeNull();
    expect(parsePerformResponse({ ok: true })).toBeNull();
  });
});
