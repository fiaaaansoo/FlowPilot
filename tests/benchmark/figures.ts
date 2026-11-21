/**
 * Figures and key numbers for the Sprint 4 research report, computed from stored results.
 *
 *   npm run eval:figures -- --main <run> --rot <run> --settle <ms>=<run>[,<ms>=<run>...] --out <dir>
 *
 * Writes SVG charts and numbers.json (every figure quoted in the report comes from there), and
 * copies the raw JSONL next to them so the report can be checked against its data.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  VERDICTS,
  barChart,
  comparePaired,
  goalMet,
  isWrongAction,
  lineChart,
  median,
  parseResults,
  proposalMatches,
  stackedBars,
  summarize,
  wilson,
  type AttemptRecord,
} from '@flowpilot/evaluation';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const mainRun = option('--main');
const rotRun = option('--rot');
const settle = (option('--settle') ?? '').split(',').filter(Boolean).map((pair) => {
  const [ms = '', run = ''] = pair.split('=');
  return { ms: Number(ms), run };
});
const out = path.resolve(ROOT, option('--out') ?? 'docs/research');
if (!mainRun) throw new Error('--main <run> is required');

const load = (run: string): AttemptRecord[] => {
  const parsed = parseResults(readFileSync(path.join(ROOT, 'eval-results', run, 'results.jsonl'), 'utf8'));
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  return parsed.attempts;
};
mkdirSync(path.join(out, 'figures'), { recursive: true });
mkdirSync(path.join(out, 'data'), { recursive: true });
const numbers: Record<string, unknown> = {};

// --- main comparison -------------------------------------------------------------------------
const main = load(mainRun);
copyFileSync(path.join(ROOT, 'eval-results', mainRun, 'results.jsonl'), path.join(out, 'data', `${mainRun}.jsonl`));
const summaries = summarize(main.filter((a) => a.phase === 'cold'));
numbers.main = summaries;
const labels: Record<string, string> = {
  deterministic_success: 'deterministic',
  autonomous_recovery: 'autonomous',
  confirmed_recovery: 'confirmed',
  correct_refusal: 'refused (correct)',
  unresolved: 'unresolved',
  incorrect_action: 'incorrect',
  unsafe_action: 'unsafe',
  timeout: 'timeout',
};
writeFileSync(
  path.join(out, 'figures', 'outcomes.svg'),
  stackedBars(
    'Outcome of every cold attempt, by configuration',
    summaries.map((s) => ({ label: s.configId, segments: VERDICTS.map((v) => ({ name: labels[v] ?? v, value: s.counts[v] })) })),
    VERDICTS.map((v) => labels[v] ?? v),
    // Same colour meaning as the dashboard.
    {
      deterministic: '#7a8699',
      autonomous: '#1f7a5a',
      confirmed: '#3d6fb6',
      'refused (correct)': '#6b4fa3',
      unresolved: '#c9a227',
      incorrect: '#c2571a',
      unsafe: '#b00020',
      timeout: '#444444',
    },
  ),
);
const configs = summaries.map((s) => s.configId);
const pairs: [string, string][] = [];
for (const [a, b] of [
  ['deterministic', 'semantic'],
  ['semantic', 'llm:qwen2.5:3b'],
  ['llm:qwen2.5:3b', 'llm-memory:qwen2.5:3b'],
  ['llm:qwen2.5:3b', 'llm:qwen2.5:7b'],
  ['llm:qwen2.5:3b', 'llm:llama3.2:3b'],
  ['llm:qwen2.5:3b', 'llm:qwen2.5:3b#v2'],
] as const) {
  if (configs.includes(a) && configs.includes(b)) pairs.push([a, b]);
}
numbers.paired = pairs.map(([a, b]) => comparePaired(main, a, b));
const memory = main.filter((a) => a.mode === 'llm-memory');
numbers.memory = (['cold', 'warm'] as const).map((phase) => {
  const list = memory.filter((a) => a.phase === phase);
  return {
    phase,
    attempts: list.length,
    goalMet: list.filter((a) => goalMet(a.verdict)).length,
    autonomous: list.filter((a) => a.verdict === 'autonomous_recovery').length,
    confirmations: list.filter((a) => a.observed.confirmationAsked).length,
    memoryReuses: list.filter((a) => a.memoryReused).length,
    modelCalls: list.reduce((s, a) => s + a.modelCalls, 0),
    tokens: list.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0),
    recoveredReplayMedianMs: median(list.filter((a) => a.observed.recovered).map((a) => a.runMs)),
    wrong: list.filter((a) => isWrongAction(a.verdict)).length,
  };
});
numbers.memoryScenarios = memory
  .filter((a) => a.category === 'memory')
  .map((a) => ({ scenario: a.scenarioId, phase: a.phase, verdict: a.verdict, strategies: a.strategies, calls: a.modelCalls }));

// --- context rot ------------------------------------------------------------------------------
if (rotRun) {
  const rot = load(rotRun);
  copyFileSync(path.join(ROOT, 'eval-results', rotRun, 'results.jsonl'), path.join(out, 'data', `${rotRun}.jsonl`));
  const rotConfigs = [...new Set(rot.map((a) => a.configId))];
  const levels = [...new Set(rot.map((a) => a.distractors ?? 0))].sort((a, b) => a - b);
  const cell = (config: string, level: number) => {
    const list = rot.filter((a) => a.configId === config && (a.distractors ?? 0) === level && a.expected.target !== null);
    const correct = list.filter((a) => a.proposals.some((p) => proposalMatches(p, a.expected.target as string, a.expected.targetContext))).length;
    const calls = list.filter((a) => a.modelCalls > 0);
    return {
      config,
      distractors: level,
      n: list.length,
      correct,
      correctRate: wilson(correct, list.length),
      wrong: list.filter((a) => isWrongAction(a.verdict)).length,
      inputTokensPerCall: calls.length ? Math.round(calls.reduce((s, a) => s + a.inputTokens / a.modelCalls, 0) / calls.length) : null,
      medianInferenceMs: calls.length ? median(calls.map((a) => a.serviceMs)) : null,
    };
  };
  const cells = rotConfigs.flatMap((c) => levels.map((l) => cell(c, l)));
  numbers.contextRot = cells;
  writeFileSync(
    path.join(out, 'figures', 'context-rot.svg'),
    lineChart(
      'Correct proposals versus distractors on the page',
      'distractor controls added to the page',
      'proposals naming the right element',
      rotConfigs.map((c) => ({ name: c.replace('llm:qwen2.5:3b', 'qwen2.5:3b').replace(/^qwen2\.5:3b$/, 'qwen2.5:3b@ranked'), points: levels.map((l) => ({ x: l, y: cell(c, l).correctRate.estimate })) })),
    ),
  );
  writeFileSync(
    path.join(out, 'figures', 'context-tokens.svg'),
    barChart(
      'Input tokens per model call at 300 distractors',
      'tokens',
      rotConfigs.map((c) => ({ label: c, value: cell(c, levels[levels.length - 1] ?? 0).inputTokensPerCall ?? 0 })),
    ),
  );
}

// --- settle window ------------------------------------------------------------------------------
if (settle.length) {
  const rows = settle.map(({ ms, run }) => {
    const list = load(run);
    copyFileSync(path.join(ROOT, 'eval-results', run, 'results.jsonl'), path.join(out, 'data', `${run}.jsonl`));
    const llm = list.filter((a) => a.mode === 'llm');
    const det = list.filter((a) => a.mode === 'deterministic');
    const recovered = llm.filter((a) => a.observed.recovered).map((a) => a.runMs);
    return {
      settleMs: ms,
      run,
      recoveredReplays: recovered.length,
      recoveredReplayMedianMs: median(recovered),
      deterministicFailurePathMedianMs: median(det.filter((a) => a.verdict === 'unresolved').map((a) => a.runMs)),
      dynamicMissedByDeterministic: det.filter((a) => a.category === 'dynamic' && a.verdict === 'unresolved').map((a) => a.scenarioId),
      llmGoalMet: `${String(llm.filter((a) => goalMet(a.verdict)).length)}/${String(llm.length)}`,
      wrong: list.filter((a) => isWrongAction(a.verdict)).length,
    };
  });
  numbers.settle = rows;
  writeFileSync(
    path.join(out, 'figures', 'settle.svg'),
    barChart(
      'Median time of a recovered replay, by settle window',
      'ms',
      rows.map((r) => ({ label: r.settleMs === 0 ? 'fixed 10 s wait' : `settle ${String(r.settleMs)} ms`, value: r.recoveredReplayMedianMs, note: `${String(r.dynamicMissedByDeterministic.length)} dynamic misses` })),
    ),
  );
}

writeFileSync(path.join(out, 'numbers.json'), `${JSON.stringify(numbers, null, 2)}\n`);
console.log(`figures and numbers.json → ${path.relative(ROOT, out)}`);
