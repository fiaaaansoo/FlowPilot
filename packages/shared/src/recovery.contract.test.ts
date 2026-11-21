import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLoopbackEndpoint, kindAccepts, parseAiSettings, parseRecoveryResponse, sameBinding, type Candidate } from './recovery.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tests/contracts', name), 'utf8')) as unknown;

describe('flowpilot.recovery/v1 contract (shared fixtures)', () => {
  it.each(['recovery-response-propose.json', 'recovery-response-escalate.json'])('accepts %s unchanged', (name) => {
    const raw = fixture(name);
    const parsed = parseRecoveryResponse(raw);
    expect(parsed).toEqual({ ok: true, value: raw });
  });

  it('rejects tampered responses', () => {
    const base = fixture('recovery-response-propose.json') as Record<string, Record<string, unknown>>;
    const variants: unknown[] = [
      { ...base, contract: 'flowpilot.recovery/v2' },
      { ...base, decision: { ...base.decision, ref: 'button.delete' } },
      { ...base, decision: { ...base.decision, confidence: 7 } },
      { ...base, decision: { ...base.decision, type: 'execute_js', code: 'alert(1)' } },
      { ...base, decision: { ...base.decision, requiresConfirmation: 'no' } },
      { ...base, usage: { ...base.usage, inputTokens: -1 } },
      { ...base, binding: { ...base.binding, tabId: 'x' } },
    ];
    for (const raw of variants) expect(parseRecoveryResponse(raw).ok).toBe(false);
  });

  it('compares bindings field by field', () => {
    const { binding } = fixture('recovery-response-propose.json') as { binding: Parameters<typeof sameBinding>[0] };
    expect(sameBinding(binding, { ...binding })).toBe(true);
    expect(sameBinding(binding, { ...binding, snapshotId: 'other' })).toBe(false);
  });
});

describe('kindAccepts', () => {
  const c = (extra: Partial<Candidate>): Candidate => ({ ref: 'e1', tag: 'button', role: 'button', attributes: {}, ...extra });
  it('matches the backend compatibility rules', () => {
    expect(kindAccepts('click', c({}))).toBe(true);
    expect(kindAccepts('click', c({ tag: 'input', role: 'textbox' }))).toBe(false);
    expect(kindAccepts('input', c({ tag: 'input', role: 'textbox' }))).toBe(true);
    expect(kindAccepts('select', c({ tag: 'select', role: 'combobox' }))).toBe(true);
    expect(kindAccepts('check', c({ tag: 'input', role: 'checkbox' }))).toBe(true);
    expect(kindAccepts('click', c({ disabled: true }))).toBe(false);
  });
});

describe('AI settings', () => {
  it('only accepts a loopback backend', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:8787')).toBe(true);
    expect(isLoopbackEndpoint('http://localhost:8787/')).toBe(true);
    for (const bad of ['https://api.example.com', 'http://192.168.1.10:8787', 'http://127.0.0.1:8787/x?y', 'http://u@127.0.0.1:1', 'nope']) {
      expect(isLoopbackEndpoint(bad)).toBe(false);
    }
  });

  it('is disabled unless a token is present, and falls back to safe defaults', () => {
    expect(parseAiSettings({ enabled: true, endpoint: 'http://127.0.0.1:8787', token: 'short' }).enabled).toBe(false);
    const ok = parseAiSettings({ enabled: true, endpoint: 'http://127.0.0.1:9000/', token: 't'.repeat(32), mode: 'confirm-always' });
    expect(ok).toEqual({ enabled: true, endpoint: 'http://127.0.0.1:9000', token: 't'.repeat(32), mode: 'confirm-always' });
    expect(parseAiSettings({ enabled: true, endpoint: 'https://evil.example', token: 't'.repeat(32) }).endpoint).toBe('http://127.0.0.1:8787');
    expect(parseAiSettings(null).enabled).toBe(false);
  });
});
