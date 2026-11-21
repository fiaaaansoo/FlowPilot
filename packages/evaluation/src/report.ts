import { comparePaired, goalMet, summarize, type AttemptRecord, type ConfigSummary, type Manifest, type Verdict } from './results.js';
import { summarizeLatency, wilson, type Interval, type LatencySummary } from './stats.js';

/** Markdown report and dashboard data, computed only from stored results. Nothing is estimated or filled in. */

const pct = (i: Interval) =>
  Number.isNaN(i.estimate) ? 'n/a (n=0)' : `${(100 * i.estimate).toFixed(0)} % [${(100 * i.low).toFixed(0)}–${(100 * i.high).toFixed(0)}] (n=${String(i.n)})`;
const ms = (value: number | undefined) => (value === undefined ? 'n/a' : `${Math.round(value).toLocaleString('en-US')} ms`);
const latency = (l: LatencySummary | null) =>
  l === null ? 'not measured' : `median ${ms(l.median)}, mean ${ms(l.mean)}${l.p95 === undefined ? '' : `, p95 ${ms(l.p95)}`} (n=${String(l.n)})`;

export interface ReportOptions {
  title: string;
  /** Pairs of configuration ids to compare with the exact McNemar test. */
  comparisons?: [string, string][];
}

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function outcomeTable(summaries: ConfigSummary[]): string {
  return table(
    ['Configuration', 'Attempts', 'Deterministic', 'Autonomous recovery', 'After confirmation', 'Correct refusal', 'Unresolved', 'Incorrect', 'Unsafe', 'Timeout'],
    summaries.map((s) => [
      `\`${s.configId}\``,
      String(s.attempts),
      ...(['deterministic_success', 'autonomous_recovery', 'confirmed_recovery', 'correct_refusal', 'unresolved', 'incorrect_action', 'unsafe_action', 'timeout'] as Verdict[]).map((v) =>
        String(s.counts[v]),
      ),
    ]),
  );
}

function rateTable(summaries: ConfigSummary[]): string {
  return table(
    ['Configuration', 'Completion (any path)', 'Autonomous completion', 'Correct refusals', 'Wrong actions (incorrect + unsafe)', 'Confirmations asked', 'Target selection'],
    summaries.map((s) => [
      `\`${s.configId}\``,
      pct(s.completion),
      pct(s.autonomousCompletion),
      pct(s.refusal),
      pct(s.wrongAction),
      pct(s.confirmationRate),
      pct(s.selectionAccuracy),
    ]),
  );
}

function costTable(summaries: ConfigSummary[]): string {
  return table(
    ['Configuration', 'Model calls', 'Tokens in / out', 'Cost (USD)', 'Memory reuses', 'Inference (service) latency', 'End-to-end replay'],
    summaries.map((s) => [
      `\`${s.configId}\``,
      String(s.modelCalls),
      `${s.inputTokens.toLocaleString('en-US')} / ${s.outputTokens.toLocaleString('en-US')}`,
      s.costUsd.toFixed(4),
      String(s.memoryReuses),
      latency(s.inferenceLatency),
      latency(s.runLatency),
    ]),
  );
}

function categoryTable(attempts: readonly AttemptRecord[], configs: string[]): string {
  const categories = [...new Set(attempts.map((a) => a.category))];
  return table(
    ['Category', ...configs.map((c) => `\`${c}\``)],
    categories.map((category) => [
      category,
      ...configs.map((config) => {
        const list = attempts.filter((a) => a.configId === config && a.category === category && a.phase === 'cold');
        if (!list.length) return '–';
        const met = list.filter((a) => goalMet(a.verdict)).length;
        const wrong = list.filter((a) => a.verdict === 'incorrect_action' || a.verdict === 'unsafe_action').length;
        return `${String(met)}/${String(list.length)} goal met${wrong ? `, **${String(wrong)} wrong**` : ''}`;
      }),
    ]),
  );
}

/** Context-rot view: correct selection and tokens by distractor count, for each configuration that ran with distractors. */
function distractorTable(attempts: readonly AttemptRecord[]): string | null {
  const withDistractors = attempts.filter((a) => a.distractors !== undefined);
  if (!withDistractors.length) return null;
  const configs = [...new Set(withDistractors.map((a) => a.configId))];
  const levels = [...new Set(withDistractors.map((a) => a.distractors as number))].sort((a, b) => a - b);
  const rows: string[][] = [];
  for (const config of configs) {
    for (const level of levels) {
      const list = withDistractors.filter((a) => a.configId === config && a.distractors === level && a.phase === 'cold');
      if (!list.length) continue;
      const proposals = list.filter((a) => a.proposals.length > 0 && a.expected.target !== null);
      const correct = proposals.filter((a) => a.proposals.some((p) => p.includes(`« ${a.expected.target as string} »`)));
      const calls = list.filter((a) => a.modelCalls > 0);
      rows.push([
        `\`${config}\``,
        String(level),
        `${String(list.filter((a) => goalMet(a.verdict)).length)}/${String(list.length)}`,
        pct(wilson(correct.length, proposals.length)),
        calls.length ? Math.round(calls.reduce((s, a) => s + a.inputTokens / a.modelCalls, 0) / calls.length).toLocaleString('en-US') : 'n/a',
        latency(summarizeLatency(calls.map((a) => a.serviceMs))),
        String(list.filter((a) => a.verdict === 'incorrect_action' || a.verdict === 'unsafe_action').length),
      ]);
    }
  }
  return table(['Configuration', 'Distractors', 'Goal met', 'Correct proposal', 'Input tokens per call', 'Inference latency', 'Wrong actions'], rows);
}

/** Memory view: cold versus warm replays of the same scenarios (llm-memory mode). */
function memoryTable(attempts: readonly AttemptRecord[]): string | null {
  const configs = [...new Set(attempts.filter((a) => a.phase === 'warm').map((a) => a.configId))];
  if (!configs.length) return null;
  const rows = configs.flatMap((config) =>
    (['cold', 'warm'] as const).map((phase) => {
      const list = attempts.filter((a) => a.configId === config && a.phase === phase);
      const calls = list.reduce((s, a) => s + a.modelCalls, 0);
      return [
        `\`${config}\``,
        phase,
        String(list.length),
        String(list.filter((a) => goalMet(a.verdict)).length),
        String(list.filter((a) => a.verdict === 'autonomous_recovery').length),
        String(list.filter((a) => a.observed.confirmationAsked).length),
        String(list.filter((a) => a.memoryReused).length),
        String(calls),
        (list.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0)).toLocaleString('en-US'),
        latency(summarizeLatency(list.filter((a) => a.observed.recovered).map((a) => a.runMs))),
        String(list.filter((a) => a.verdict === 'incorrect_action' || a.verdict === 'unsafe_action').length),
      ];
    }),
  );
  return table(['Configuration', 'Phase', 'Attempts', 'Goal met', 'Autonomous recoveries', 'Confirmations', 'Memory reuses', 'Model calls', 'Tokens', 'Recovered replay latency', 'Wrong actions'], rows);
}

export function renderMarkdown(manifests: readonly Manifest[], attempts: readonly AttemptRecord[], options: ReportOptions): string {
  const summaries = summarize(attempts);
  const configs = summaries.map((s) => s.configId);
  const runs = [...new Set(manifests.map((m) => m.runId))];
  const commits = [...new Set(manifests.map((m) => `${m.gitCommit.slice(0, 7)}${m.gitDirty ? ' (dirty)' : ''}`))];
  const datasets = [...new Set(manifests.map((m) => `${m.datasetVersion} (${m.datasetHash.slice(0, 12)})`))];
  const env = manifests[0]?.environment;
  const parts = [
    `# ${options.title}`,
    '',
    `Runs: ${runs.join(', ') || 'none'}. Commits: ${commits.join(', ') || 'unknown'}. Dataset: ${datasets.join(', ') || 'unknown'}.`,
    env ? `Machine: ${env.os}, ${env.cpu} (${String(env.cpuCores)} threads), ${String(Math.round(env.ramMb / 1024))} GB RAM, GPU ${env.gpu ?? 'none reported'}; ${env.node}, ${env.python ?? 'python n/a'}, Ollama ${env.ollama ?? 'n/a'}.` : '',
    '',
    'Rates are point estimates with 95 % Wilson intervals; p95 latencies are shown only from 20 samples.',
    '',
    '## Configurations',
    '',
    table(
      ['Configuration', 'Mode', 'Model (digest)', 'Prompt', 'Context', 'Settle', 'Repeats'],
      manifests.flatMap((m) =>
        m.configs.map((c) => [
          `\`${c.configId}\``,
          c.mode,
          c.model ? `${c.model} (${(c.modelDigest ?? 'unknown').slice(0, 12)})` : '–',
          c.promptVersion,
          `${c.contextStrategy}: ${String(c.context.maxElements)} el. / ${String(c.context.maxChars)} ch.${c.context.ranking ? '' : ', unranked'}${c.context.numCtx ? `, num_ctx ${String(c.context.numCtx)}` : ''}`,
          `${String(c.settleMs)} ms`,
          String(c.repeats),
        ]),
      ),
    ),
    '',
    '## Outcomes (all attempts)',
    '',
    outcomeTable(summaries),
    '',
    '## Rates',
    '',
    rateTable(summaries),
    '',
    '## Cost and latency',
    '',
    costTable(summaries),
    '',
    '## By category (cold attempts)',
    '',
    categoryTable(attempts, configs),
  ];
  const comparisons = (options.comparisons ?? []).filter(([a, b]) => configs.includes(a) && configs.includes(b));
  if (comparisons.length) {
    parts.push(
      '',
      '## Paired comparisons (goal met, cold attempts, repeat 1)',
      '',
      'Exact McNemar test on scenarios both configurations ran. A p-value is reported, not a verdict: with this many scenarios only large differences can be detected.',
      '',
      table(
        ['A', 'B', 'Pairs', 'Both met', 'Only A', 'Only B', 'Neither', 'p (two-sided)'],
        comparisons.map(([a, b]) => {
          const c = comparePaired(attempts, a, b);
          return [`\`${a}\``, `\`${b}\``, String(c.pairs), String(c.bothMet), String(c.onlyA), String(c.onlyB), String(c.neither), c.pValue.toFixed(4)];
        }),
      ),
    );
  }
  const unstable = summaries.filter((s) => s.unstableScenarios.length);
  parts.push('', '## Run-to-run variability', '');
  parts.push(
    unstable.length
      ? unstable.map((s) => `- \`${s.configId}\`: verdict changed between repeats on ${s.unstableScenarios.map((id) => `\`${id}\``).join(', ')}`).join('\n')
      : '- No scenario changed verdict between repeats (configurations with a single repeat cannot show variability).',
  );
  const memory = memoryTable(attempts);
  if (memory) parts.push('', '## Memory: cold versus warm replays', '', memory);
  const rot = distractorTable(attempts);
  if (rot) parts.push('', '## Context size and distractors', '', rot);
  const failures = attempts.filter((a) => a.verdict === 'incorrect_action' || a.verdict === 'unsafe_action' || a.verdict === 'timeout');
  parts.push('', '## Wrong actions and timeouts', '');
  parts.push(
    failures.length
      ? table(
          ['Configuration', 'Scenario', 'Phase', 'Repeat', 'Verdict', 'Proposals', 'Strategies'],
          failures.map((a) => [`\`${a.configId}\``, a.scenarioId, a.phase, String(a.repeat), a.verdict, a.proposals.join(' / ').replace(/\|/g, '\\|') || '–', a.strategies.join(', ') || '–']),
        )
      : 'None.',
  );
  return parts.join('\n') + '\n';
}

/** Compact data for the dashboard: attempts as stored plus manifests; aggregates are recomputed in the page. */
export interface DashboardData {
  title: string;
  generatedAt: string;
  manifests: Manifest[];
  attempts: AttemptRecord[];
}

export function dashboardData(title: string, manifests: Manifest[], attempts: AttemptRecord[], now = new Date()): DashboardData {
  return { title, generatedAt: now.toISOString(), manifests, attempts };
}
