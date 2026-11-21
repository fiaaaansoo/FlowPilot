/**
 * Builds the Markdown report and the offline dashboard from stored results.
 *
 *   npm run eval:report -- <run> [<run> ...] [--out <dir>] [--title "<title>"]
 *
 * Reads eval-results/<run>/results.jsonl for each run, writes report.md and
 * dashboard.html to --out (default: eval-results/<first run>/). Fails on malformed lines.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dashboardData, parseResults, renderDashboard, renderMarkdown, type AttemptRecord, type Manifest } from '@flowpilot/evaluation';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const out = option('--out');
const title = option('--title') ?? 'FlowPilot recovery evaluation';
const runs = args;
if (!runs.length) {
  console.error('Usage: npm run eval:report -- <run> [<run> ...] [--out <dir>] [--title "<title>"]');
  process.exit(2);
}

const manifests: Manifest[] = [];
const attempts: AttemptRecord[] = [];
for (const run of runs) {
  const file = path.join(ROOT, 'eval-results', run, 'results.jsonl');
  if (!existsSync(file)) throw new Error(`No results for run "${run}" (${file})`);
  const parsed = parseResults(readFileSync(file, 'utf8'));
  if (parsed.errors.length) throw new Error(`${file}:\n${parsed.errors.join('\n')}`);
  manifests.push(...parsed.manifests);
  attempts.push(...parsed.attempts);
}

/** Meaningful paired comparisons among the configurations present (one factor changes at a time). */
function comparisons(configs: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  const has = (c: string) => configs.includes(c);
  const add = (a: string, b: string) => {
    if (has(a) && has(b) && a !== b) pairs.push([a, b]);
  };
  add('deterministic', 'semantic');
  const llms = configs.filter((c) => c.startsWith('llm:'));
  for (const c of llms.filter((x) => !/[@#]/.test(x))) {
    add('semantic', c);
    add(c, c.replace(/^llm:/, 'llm-memory:'));
    for (const variant of ['minimal', 'extended', 'unranked']) add(c, `${c}@${variant}`);
    add(c, `${c}#v2`);
  }
  const plain = llms.filter((x) => !/[@#]/.test(x));
  for (const other of plain.slice(1)) add(plain[0] ?? '', other);
  return pairs;
}

const configs = [...new Set(attempts.map((a) => a.configId))];
const target = out ? path.resolve(ROOT, out) : path.join(ROOT, 'eval-results', runs[0] ?? 'report');
mkdirSync(target, { recursive: true });
writeFileSync(path.join(target, 'report.md'), renderMarkdown(manifests, attempts, { title, comparisons: comparisons(configs) }));
const client = readFileSync(path.join(ROOT, 'packages', 'evaluation', 'src', 'dashboard-client.js'), 'utf8');
writeFileSync(path.join(target, 'dashboard.html'), renderDashboard(dashboardData(title, manifests, attempts), client));
console.log(`${String(attempts.length)} attempts, ${String(configs.length)} configurations → ${path.relative(ROOT, target)}/report.md, dashboard.html`);
