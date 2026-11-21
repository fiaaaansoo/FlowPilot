import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, isCommand, isContentPong, isContentRequest } from './messages.js';

describe('isCommand', () => {
  it.each([{ type: 'session/get' }, { type: 'record/start' }, { type: 'session/stop' }, { type: 'replay/start', workflowId: 'wf' }, { type: 'workflow/delete', workflowId: 'wf' }])(
    'accepte %j',
    (msg) => {
      expect(isCommand(msg)).toBe(true);
    },
  );

  it.each([null, 'record/start', {}, { type: 'exec', code: '1' }, { type: 'replay/start' }, { type: 'replay/start', workflowId: '' }, { type: 'workflow/delete' }])(
    'rejette %j',
    (msg) => {
      expect(isCommand(msg)).toBe(false);
    },
  );
});

describe('messages content script', () => {
  it('reconnaît ping et pong', () => {
    expect(isContentRequest({ type: 'content/ping' })).toBe(true);
    expect(isContentRequest({ type: 'other' })).toBe(false);
    expect(isContentPong({ type: 'content/pong', protocolVersion: PROTOCOL_VERSION, url: 'http://x/' })).toBe(true);
    expect(isContentPong({ type: 'content/pong', protocolVersion: 0, url: 'http://x/' })).toBe(false);
  });
});
