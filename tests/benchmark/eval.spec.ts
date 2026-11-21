import type { ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { classify, proposalMatches, proposedPart, simulatedUserAccepts, type AttemptRecord, type Gesture, type Manifest, type Observed, type PageCheck, type Scenario } from '@flowpilot/evaluation';
import { startBackend } from '../e2e/backend';
import { expect, test } from '../e2e/fixtures';
import { enableAiRecovery, latestRun, startRecording, stopRecording, waitForCapture } from '../e2e/helpers';
import { CONTEXT_STRATEGIES, parseConfig } from './configs';
import { loadDataset } from './dataset';
import { environment, gitState, ollamaInfo } from './environment';

/**
 * Evaluation runner (method: docs/benchmarks/README.md). One Playwright test per
 * configuration, run one after the other: one browser, one backend, at most one
 * local model loaded at a time. Results are appended to
 * `eval-results/<run>/results.jsonl` after every attempt.
 *
 * Environment:
 * - FLOWPILOT_EVAL_CONFIGS   comma-separated configurations (see configs.ts), default "deterministic,semantic"
 * - FLOWPILOT_EVAL_SCENARIOS comma-separated scenario ids or categories (default: all)
 * - FLOWPILOT_EVAL_REPEAT    repetitions per scenario (default 1)
 * - FLOWPILOT_EVAL_DISTRACTORS comma-separated distractor counts added to every scenario (context-rot study)
 * - FLOWPILOT_EVAL_RUN       run id: batches with the same id accumulate in one results file
 * - VITE_FLOWPILOT_SETTLE_MS settle window the extension was built with (recorded in the manifest)
 */

const TOKEN = 'eval-token-0123456789abcdefghijkl';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const ORIGIN = 'http://localhost:5173';
const REPLAY_DEADLINE_MS = 60_000;
const RUN_ID = process.env.FLOWPILOT_EVAL_RUN ?? new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(import.meta.dirname, '../../eval-results', RUN_ID, 'results.jsonl');
const REPEAT = Math.max(1, Number(process.env.FLOWPILOT_EVAL_REPEAT ?? '1') || 1);
const DISTRACTORS = (process.env.FLOWPILOT_EVAL_DISTRACTORS ?? '').split(',').filter(Boolean).map(Number);
const CONFIGS = (process.env.FLOWPILOT_EVAL_CONFIGS ?? 'deterministic,semantic').split(',').filter(Boolean).map(parseConfig);
const FILTER = (process.env.FLOWPILOT_EVAL_SCENARIOS ?? '').split(',').filter(Boolean);
const dataset = loadDataset();
const SCENARIOS = dataset.scenarios.filter((s) => !FILTER.length || FILTER.includes(s.id) || FILTER.includes(s.category));

function append(line: AttemptRecord | Manifest): void {
  mkdirSync(path.dirname(OUT), { recursive: true });
  appendFileSync(OUT, `${JSON.stringify(line)}\n`);
}

// --- page helpers ---------------------------------------------------------------------------

async function setMutations(page: Page, mutations: string[]): Promise<void> {
  await page.goto(`/?m=${mutations.length ? mutations.join(',') : 'none'}`);
}

async function perform(page: Page, gesture: Gesture): Promise<void> {
  if ('goto' in gesture) await page.goto(gesture.goto);
  else if ('fill' in gesture) await page.getByLabel(gesture.fill.label, { exact: true }).fill(gesture.fill.value);
  else if ('click' in gesture) {
    const role = gesture.click.role as Parameters<Page['getByRole']>[0];
    await page.getByRole(role, { name: gesture.click.name, exact: gesture.click.exact ?? false }).click();
  } else if ('check' in gesture) await page.getByLabel(gesture.check.label, { exact: true }).check();
  else if ('select' in gesture) await page.getByLabel(gesture.select.label, { exact: true }).selectOption({ label: gesture.select.option });
  else await expect(page).toHaveURL(new RegExp(gesture.waitForUrl));
}

async function storedWorkflowIds(serviceWorker: Worker): Promise<string[]> {
  return serviceWorker.evaluate(async () => {
    const list = (await chrome.storage.local.get('flowpilot.workflows'))['flowpilot.workflows'] as { id: string }[] | undefined;
    return (list ?? []).map((w) => w.id);
  });
}

/** Records a workflow with the real recorder, from gestures on the original (unmutated) pages. */
async function record(sidePanel: Page, serviceWorker: Worker, demo: Page, gestures: Gesture[]): Promise<string> {
  const before = new Set(await storedWorkflowIds(serviceWorker));
  await setMutations(demo, []);
  const [first, ...rest] = gestures;
  if (first) await perform(demo, first);
  await startRecording(sidePanel, serviceWorker, demo);
  for (const gesture of rest) await perform(demo, gesture);
  await demo.waitForTimeout(300); // let the last event reach the recorder
  await waitForCapture(serviceWorker, demo);
  await stopRecording(sidePanel);
  const id = (await storedWorkflowIds(serviceWorker)).find((w) => !before.has(w));
  if (!id) throw new Error('recording produced no workflow');
  return id;
}

async function pageCheck(page: Page, check: PageCheck, visited: readonly string[]): Promise<boolean> {
  if (check.type === 'url') {
    const pattern = new RegExp(check.pattern);
    return [page.url(), ...visited].some((url) => pattern.test(url));
  }
  return page
    .evaluate((c) => {
      if (c.type === 'text') return Array.from(document.querySelectorAll(c.selector)).some((el) => el.textContent.includes(c.includes));
      if (c.type === 'visible') {
        const el = document.querySelector<HTMLElement>(c.selector);
        return el !== null && el.checkVisibility();
      }
      if (c.type === 'sessionStorage') {
        const value = sessionStorage.getItem(c.key);
        return c.equals === undefined ? value !== null : value === c.equals;
      }
      return (document.querySelector<HTMLInputElement>(c.selector)?.value ?? '') !== ''; // fieldFilled
    }, check)
    .catch(() => false); // the page left the site: page-state checks cannot hold
}

const EFFECT_GRACE_MS = 5_000;

async function settledChecks(page: Page, checks: readonly PageCheck[], visited: readonly string[]): Promise<boolean> {
  if (!checks.length) return false;
  const deadline = Date.now() + EFFECT_GRACE_MS;
  for (;;) {
    if ((await Promise.all(checks.map((c) => pageCheck(page, c, visited)))).every(Boolean)) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(250);
  }
}

interface RecoveryInfo {
  outcome: string;
  strategy?: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  serviceLatencyMs?: number;
  proposed?: string;
  reason?: string;
}
interface RunInfo {
  outcome: 'succeeded' | 'failed' | 'aborted';
  startedAt: number;
  finishedAt: number;
  failure?: { stepIndex: number };
  log: { status: string; strategy?: string; recovery?: RecoveryInfo }[];
}

type Oracle = Parameters<typeof simulatedUserAccepts>[1];

/**
 * Replays a workflow; confirmation prompts are answered by the simulated user, who accepts only
 * a prompt naming the ground-truth element (and its row or section, when one is given).
 */
async function replay(sidePanel: Page, serviceWorker: Worker, demo: Page, workflowId: string, oracle: Oracle) {
  const previous = (await latestRun(serviceWorker))?.startedAt;
  const visited: string[] = [];
  const onRequest = (request: { url: () => string; isNavigationRequest: () => boolean }) => {
    if (request.isNavigationRequest() || !request.url().startsWith(ORIGIN)) visited.push(request.url());
  };
  demo.on('request', onRequest);
  await demo.bringToFront();
  await sidePanel.evaluate((id) => chrome.runtime.sendMessage({ type: 'replay/start', workflowId: id }), workflowId);
  const prompts: string[] = [];
  const acceptedPrompts: string[] = [];
  let accepted = false;
  const deadline = Date.now() + REPLAY_DEADLINE_MS;
  try {
    while (Date.now() < deadline) {
      const run = (await latestRun(serviceWorker)) as RunInfo | undefined;
      if (run && run.startedAt !== previous) return { run, prompts, accepted, acceptedPrompts, visited, timedOut: false };
      const dialog = sidePanel.getByRole('alertdialog');
      if (await dialog.isVisible()) {
        const text = (await dialog.textContent().catch(() => null)) ?? '';
        if (!text) continue; // the prompt closed meanwhile
        prompts.push(proposedPart(text).trim());
        const ok = simulatedUserAccepts(text, oracle);
        accepted ||= ok;
        if (ok) acceptedPrompts.push(text);
        // Short timeout: the prompt can close between the check and the click (run stopped elsewhere).
        await dialog
          .getByRole('button', { name: ok ? 'Confirmer et exécuter' : 'Arrêter' })
          .click({ timeout: 2_000 })
          .catch(() => undefined);
      }
      await sidePanel.waitForTimeout(150);
    }
    await sidePanel.locator('.control--stop').click({ timeout: 2_000 }).catch(() => undefined);
    // Wait for the stopped run to be recorded, so it is never taken for the next replay's result.
    const stopDeadline = Date.now() + 15_000;
    while (Date.now() < stopDeadline && (await latestRun(serviceWorker))?.startedAt === previous) await sidePanel.waitForTimeout(250);
    return { run: undefined, prompts, accepted, acceptedPrompts, visited, timedOut: true };
  } finally {
    demo.off('request', onRequest);
  }
}

async function ollama(pathname: string, body: unknown): Promise<void> {
  await fetch(`${OLLAMA_URL}${pathname}`, { method: 'POST', body: JSON.stringify(body) }).catch(() => undefined);
}

// --- the runs ---------------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

for (const [index, config] of CONFIGS.entries()) {
  test(`eval: ${config.id}`, async ({ context, sidePanel, serviceWorker }) => {
    test.setTimeout(4 * 60 * 60_000);
    const port = 8820 + index;
    const info = await ollamaInfo();
    if (config.model && config.numCtx) {
      // Warm the model with this configuration's context size so a cold load is not counted as latency.
      await ollama('/api/generate', { model: config.model, prompt: 'ok', stream: false, keep_alive: '10m', options: { num_predict: 1, num_ctx: config.numCtx } });
    }
    let backend: ChildProcess | null = null;
    try {
      // Inside try: a failed start still unloads the warmed model.
      backend = config.backendEnv ? await startBackend(config.backendEnv, port, TOKEN) : null;
      const demo = await context.newPage();
      const git = gitState();
      const browser = await demo.evaluate(() => navigator.userAgent);
      const strategy = CONTEXT_STRATEGIES[config.contextStrategy];
      append({
        type: 'manifest',
        runId: RUN_ID,
        createdAt: new Date().toISOString(),
        gitCommit: git.commit,
        gitDirty: git.dirty,
        datasetVersion: dataset.version,
        datasetHash: dataset.hash,
        scenarioCount: SCENARIOS.length,
        configs: [
          {
            configId: config.id,
            mode: config.mode,
            provider: config.provider ?? 'none',
            model: config.model,
            modelDigest: config.model ? (info.digests[config.model] ?? null) : null,
            modelParameters: config.model ? { temperature: 0, num_ctx: config.numCtx ?? 0, max_output_tokens: 1024 } : {},
            promptVersion: config.promptVersion,
            contextStrategy: config.contextStrategy,
            context: { maxElements: strategy.maxElements, maxChars: strategy.maxChars, ranking: strategy.ranking, numCtx: config.numCtx },
            settleMs: Number(process.env.VITE_FLOWPILOT_SETTLE_MS ?? '3000'),
            repeats: REPEAT,
          },
        ],
        environment: environment(browser, info.version),
      });
      if (config.backendEnv) await enableAiRecovery(serviceWorker, port, TOKEN);

      const workflows = new Map<string, string>();
      const workflowFor = async (id: string, gestures: Gesture[]) => {
        const known = workflows.get(id);
        if (known) return known;
        const recorded = await record(sidePanel, serviceWorker, demo, gestures);
        workflows.set(id, recorded);
        return recorded;
      };
      const searchQa = dataset.scenarios.find((s) => s.workflow.id === 'search')?.workflow.gestures.map((g) =>
        'fill' in g ? { fill: { ...g.fill, value: 'qa' } } : g,
      );

      for (const scenario of SCENARIOS) {
        for (const distractors of DISTRACTORS.length ? DISTRACTORS : [undefined]) {
          for (let repeat = 1; repeat <= REPEAT; repeat += 1) {
            await runScenario(scenario, repeat, distractors);
          }
        }
      }

      async function runScenario(scenario: Scenario, repeat: number, distractors: number | undefined) {
        if (config.backendEnv) {
          // Isolation: no correction learned in one scenario may help or hurt another.
          const reset = await fetch(`http://127.0.0.1:${String(port)}/v1/memory`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
          if (!reset.ok) throw new Error(`memory reset failed (${String(reset.status)}): isolation between scenarios is not guaranteed`);
        }
        const workflowId = await workflowFor(scenario.workflow.id, scenario.workflow.gestures);
        const extra = distractors ? [`distractors=${String(distractors)}`] : [];
        for (const prior of scenario.priorRuns ?? []) {
          const priorWorkflow = prior.separateWorkflow && searchQa ? await workflowFor('search-qa', searchQa) : workflowId;
          await setMutations(demo, prior.mutations);
          // The prior page has its own ground truth (it may differ from the measured page's).
          await replay(sidePanel, serviceWorker, demo, priorWorkflow, {
            target: prior.target,
            ...(prior.targetContext ? { context: prior.targetContext } : {}),
            accept: prior.acceptProposal,
          });
        }
        const memoryEntries = config.backendEnv
          ? ((await (await fetch(`http://127.0.0.1:${String(port)}/v1/memory`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as unknown[]).length
          : undefined;
        const phases: AttemptRecord['phase'][] = config.memory ? ['cold', 'warm'] : ['cold'];
        for (const phase of phases) {
          await setMutations(demo, [...scenario.mutations, ...extra]);
          await demo.evaluate(() => {
            sessionStorage.clear();
          });
          const startedAt = new Date().toISOString();
          const result = await replay(sidePanel, serviceWorker, demo, workflowId, {
            target: scenario.expected.target,
            ...(scenario.expected.targetContext ? { context: scenario.expected.targetContext } : {}),
            accept: true,
          });
          const run = result.run;
          const log = run?.log ?? [];
          const recoveries = log.flatMap((entry) => (entry.recovery ? [entry.recovery] : []));
          const failedAt = run?.failure?.stepIndex;
          // Effects can lag behind the replay (a confirmation rendered after a delay): poll the success
          // checks for a few seconds before judging, then read the forbidden states.
          const succeeded = await settledChecks(demo, scenario.expected.success, result.visited);
          await demo.waitForTimeout(750); // let delayed forbidden effects (a late navigation) show
          const observed: Observed = {
            runOutcome: result.timedOut || !run ? 'timeout' : run.outcome,
            successChecks: succeeded,
            forbiddenHit: (await Promise.all(scenario.forbidden.map((c) => pageCheck(demo, c, result.visited)))).some(Boolean),
            recoveredThenFailed: failedAt !== undefined && failedAt > 0 && log[failedAt - 1]?.recovery?.outcome === 'recovered',
            recovered: recoveries.some((r) => r.outcome === 'recovered'),
            confirmationAsked: result.prompts.length > 0,
            confirmationAccepted: result.accepted,
            // The step itself, or a proposal naming the ground-truth element, was confirmed.
            confirmedTarget: result.acceptedPrompts.some(
              (text) =>
                !text.includes('FlowPilot propose') ||
                (scenario.expected.target !== null && proposalMatches(proposedPart(text), scenario.expected.target, scenario.expected.targetContext)),
            ),
          };
          const sum = (pick: (r: RecoveryInfo) => number) => recoveries.reduce((total, r) => total + pick(r), 0);
          const strategies = log.map((entry) => entry.strategy).filter((s): s is string => typeof s === 'string' && s.startsWith('ai:'));
          append({
            type: 'attempt',
            runId: RUN_ID,
            configId: config.id,
            mode: config.mode,
            provider: config.provider ?? 'none',
            model: config.model,
            promptVersion: config.promptVersion,
            contextStrategy: config.contextStrategy,
            scenarioId: scenario.id,
            category: scenario.category,
            ...(distractors !== undefined ? { distractors } : {}),
            ...(scenario.heldOut ? { heldOut: true } : {}),
            ...(memoryEntries !== undefined ? { memoryEntries } : {}),
            repeat,
            phase,
            expected: {
              outcome: scenario.expected.outcome,
              human: scenario.expected.human,
              target: scenario.expected.target,
              ...(scenario.expected.targetContext ? { targetContext: scenario.expected.targetContext } : {}),
            },
            observed,
            verdict: classify(observed, scenario.expected),
            // Proposals shown to the user, then those executed without asking (from the run log).
            proposals: [...new Set([...result.prompts, ...recoveries.flatMap((r) => (r.proposed ? [r.proposed] : []))])],
            strategies,
            reasons: recoveries.flatMap((r) => (r.reason ? [r.reason] : [])),
            modelCalls: sum((r) => r.modelCalls),
            inputTokens: sum((r) => r.inputTokens),
            outputTokens: sum((r) => r.outputTokens),
            costUsd: sum((r) => r.costUsd),
            serviceMs: sum((r) => r.serviceLatencyMs ?? 0),
            runMs: run ? run.finishedAt - run.startedAt : REPLAY_DEADLINE_MS,
            memoryReused: strategies.includes('ai:memory'),
            startedAt,
          });
        }
      }
    } finally {
      backend?.kill();
      if (config.model) await ollama('/api/generate', { model: config.model, keep_alive: 0 }); // release the model
    }
  });
}
