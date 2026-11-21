// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardData, renderDashboard, renderMarkdown, type AttemptRecord, type Manifest } from './index';

const manifest: Manifest = {
  type: 'manifest',
  runId: 'r1',
  createdAt: '2026-11-21T00:00:00Z',
  gitCommit: 'abcdef1234567',
  gitDirty: false,
  datasetVersion: '1.0.0',
  datasetHash: 'f'.repeat(64),
  scenarioCount: 2,
  configs: [
    {
      configId: 'llm:m',
      mode: 'llm',
      provider: 'ollama',
      model: 'm',
      modelDigest: 'd'.repeat(64),
      modelParameters: { temperature: 0 },
      promptVersion: 'recovery-v1',
      contextStrategy: 'ranked',
      context: { maxElements: 12, maxChars: 6000, ranking: true, numCtx: 4096 },
      settleMs: 1500,
      repeats: 1,
    },
  ],
  environment: { os: 'test', cpu: 'cpu', cpuCores: 4, ramMb: 8192, gpu: null, node: 'v24', python: null, ollama: null, browser: 'chromium' },
};

const base = {
  type: 'attempt' as const,
  runId: 'r1',
  configId: 'llm:m',
  mode: 'llm' as const,
  provider: 'ollama',
  model: 'm',
  promptVersion: 'recovery-v1',
  contextStrategy: 'ranked',
  category: 'semantic' as const,
  repeat: 1,
  phase: 'cold' as const,
  strategies: [],
  modelCalls: 1,
  inputTokens: 1000,
  outputTokens: 40,
  costUsd: 0,
  serviceMs: 900,
  runMs: 2000,
  memoryReused: false,
  startedAt: '2026-11-21T00:00:00Z',
};
const observed = { runOutcome: 'succeeded' as const, successChecks: true, forbiddenHit: false, recoveredThenFailed: false, recovered: true, confirmationAsked: true, confirmationAccepted: true };
const attempts: AttemptRecord[] = [
  { ...base, scenarioId: 'synonym', expected: { outcome: 'complete', human: 'optional', target: 'Trouver' }, observed, verdict: 'confirmed_recovery', proposals: ['« Trouver » (button)'] },
  {
    ...base,
    scenarioId: 'injection</script><b>x',
    category: 'security',
    expected: { outcome: 'refuse', human: 'optional', target: null },
    observed: { ...observed, forbiddenHit: true },
    verdict: 'unsafe_action',
    proposals: ['« Supprimer » (button)'],
  },
];

describe('markdown report', () => {
  const markdown = renderMarkdown([manifest], attempts, { title: 'Test report', comparisons: [['llm:m', 'llm:m']] });

  it('states provenance and only measured numbers', () => {
    expect(markdown).toContain('# Test report');
    expect(markdown).toContain('abcdef1');
    expect(markdown).toContain('1.0.0 (ffffffffffff)');
    expect(markdown).toMatch(/\| `llm:m` \| 2 \| 0 \| 0 \| 1 \| 0 \| 0 \| 0 \| 1 \| 0 \|/);
    expect(markdown).toContain('median 900 ms');
    expect(markdown).not.toContain('p95'.concat(' 9')); // fewer than 20 samples: no p95 value
  });

  it('lists every wrong action', () => {
    expect(markdown).toContain('## Wrong actions and timeouts');
    expect(markdown).toContain('unsafe_action');
  });
});

describe('dashboard', () => {
  const script = readFileSync(path.join(import.meta.dirname, 'dashboard-client.js'), 'utf8');
  const html = renderDashboard(dashboardData('Eval <dashboard>', [manifest], attempts, new Date('2026-11-21T00:00:00Z')), script);

  it('embeds data safely', () => {
    expect(html).not.toContain('</script><b>x');
    expect(html).toContain('Eval &#60;dashboard&#62;');
  });

  it('renders cards, filters and attempt details from the data', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*/i, '').replace(/<\/?html[^>]*>/g, '');
    // Running the shipped client script in jsdom is the point of this test.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    new Function(script)();
    expect(document.querySelectorAll('.card')).toHaveLength(1);
    expect(document.querySelector('.card .bad')?.textContent).toBe('1');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);

    const verdict = document.querySelector<HTMLSelectElement>('#f-verdict');
    if (!verdict) throw new Error('no verdict filter');
    verdict.value = 'unsafe_action';
    verdict.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);

    document.querySelector<HTMLTableRowElement>('tbody tr')?.click();
    expect(document.querySelector('.details')?.textContent).toContain('« Supprimer » (button)');
  });

  it('says "not measured" instead of inventing latency', () => {
    const noCalls = attempts.map((a) => ({ ...a, modelCalls: 0 }));
    document.documentElement.innerHTML = renderDashboard(dashboardData('x', [manifest], noCalls), script).replace(/<\/?html[^>]*>|<!doctype html>/gi, '');
    // Running the shipped client script in jsdom is the point of this test.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    new Function(script)();
    expect(document.body.textContent).toContain('inference latency not measured');
  });
});
