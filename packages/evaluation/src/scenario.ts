/**
 * Benchmark scenario schema, version 1.
 *
 * A scenario is data: how the workflow is recorded on the original page (gestures,
 * not FlowPilot internals), which interface mutations are applied before replay,
 * and an independently defined ground truth: the element a careful person would
 * pick, the expected outcome, how a human should be involved, and what must never
 * happen. Scenarios live in `tests/benchmark/scenarios/*.json`.
 */

export const SCENARIO_SCHEMA_VERSION = 1;

export const CATEGORIES = ['structural', 'semantic', 'ambiguous', 'dynamic', 'security', 'memory'] as const;
export type Category = (typeof CATEGORIES)[number];

/** What the replay should achieve on the mutated page. */
export type ExpectedOutcome =
  /** The procedure can and should be completed (by any safe means, with or without confirmation). */
  | 'complete'
  /** No safe target exists: the right behaviour is to stop without acting on any candidate. */
  | 'refuse';

/** How a human may be involved when the outcome is `complete`. */
export type HumanPolicy =
  /** Nothing in the scenario justifies asking (asking is allowed but counted). */
  | 'optional'
  /** The step is irreversible or recorded with confirmation: completing without a human is a violation. */
  | 'required';

/** A gesture performed with Playwright on the original page while FlowPilot records. */
export type Gesture =
  | { goto: string }
  | { fill: { label: string; value: string } }
  | { click: { role: string; name: string; exact?: boolean } }
  | { check: { label: string } }
  | { select: { label: string; option: string } }
  | { waitForUrl: string };

/** A check of the final page state, evaluated by the runner (never by FlowPilot). */
export type PageCheck =
  | { type: 'url'; pattern: string }
  | { type: 'text'; selector: string; includes: string }
  | { type: 'sessionStorage'; key: string; equals?: string }
  | { type: 'visible'; selector: string }
  /** The field has a value (as a forbidden check: data typed where it must never go). */
  | { type: 'fieldFilled'; selector: string };

export interface PriorRun {
  /** Mutations applied for this earlier replay (memory scenarios). */
  mutations: string[];
  /** Whether the simulated user accepts a proposal naming the expected target in that run. */
  acceptProposal: boolean;
  /** Record a separate workflow for this run (correction learned in another workflow). */
  separateWorkflow?: boolean;
}

export interface Scenario {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  id: string;
  category: Category;
  title: string;
  /** Why the scenario exists and why its ground truth is what it is. */
  rationale: string;
  workflow: {
    /** Workflows with the same id share one recording per run. */
    id: string;
    gestures: Gesture[];
  };
  /** Mutations applied (by the demo site) before the measured replay. */
  mutations: string[];
  /** Host permissions the scenario needs (origins), besides the demo site. */
  permissions: string[];
  expected: {
    outcome: ExpectedOutcome;
    /** Accessible name of the correct element after mutation (null when no element is correct). */
    target: string | null;
    /**
     * Text that must also appear in a proposal for the simulated user to accept it (row or
     * section of the correct element), when several elements share the target's name.
     */
    targetContext?: string;
    human: HumanPolicy;
    /** Final page state that proves completion. Required when outcome is `complete`. */
    success: PageCheck[];
  };
  /** Any of these means an unsafe action, whatever the outcome. */
  forbidden: PageCheck[];
  /** Earlier replays executed before the measured one, with memory kept (memory scenarios). */
  priorRuns?: PriorRun[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const ID = /^[a-z][a-z0-9-]{2,60}$/;
const MUTATION = /^[a-z][a-z0-9-]*(=[a-z0-9-]+)?$/;

function checkGesture(g: unknown, at: string, errors: string[]): void {
  if (!isRecord(g) || Object.keys(g).length !== 1) {
    errors.push(`${at}: a gesture has exactly one key`);
    return;
  }
  const [kind, value] = Object.entries(g)[0] ?? [];
  switch (kind) {
    case 'goto':
    case 'waitForUrl':
      if (!isText(value)) errors.push(`${at}.${kind}: expected a non-empty string`);
      return;
    case 'fill':
      if (!isRecord(value) || !isText(value.label) || typeof value.value !== 'string') errors.push(`${at}.fill: needs label and value`);
      return;
    case 'click':
      if (!isRecord(value) || !isText(value.role) || !isText(value.name)) errors.push(`${at}.click: needs role and name`);
      return;
    case 'check':
      if (!isRecord(value) || !isText(value.label)) errors.push(`${at}.check: needs label`);
      return;
    case 'select':
      if (!isRecord(value) || !isText(value.label) || !isText(value.option)) errors.push(`${at}.select: needs label and option`);
      return;
    default:
      errors.push(`${at}: unknown gesture "${String(kind)}"`);
  }
}

function checkPageCheck(c: unknown, at: string, errors: string[]): void {
  if (!isRecord(c)) {
    errors.push(`${at}: expected an object`);
    return;
  }
  switch (c.type) {
    case 'url':
      if (!isText(c.pattern)) errors.push(`${at}: url check needs a pattern`);
      else {
        try {
          new RegExp(c.pattern);
        } catch {
          errors.push(`${at}: invalid regular expression`);
        }
      }
      return;
    case 'text':
      if (!isText(c.selector) || !isText(c.includes)) errors.push(`${at}: text check needs selector and includes`);
      return;
    case 'sessionStorage':
      if (!isText(c.key)) errors.push(`${at}: sessionStorage check needs a key`);
      return;
    case 'visible':
    case 'fieldFilled':
      if (!isText(c.selector)) errors.push(`${at}: ${c.type} check needs a selector`);
      return;
    default:
      errors.push(`${at}: unknown check type "${String(c.type)}"`);
  }
}

/** Validates one scenario. Unknown keys are rejected so that typos never silently change a benchmark. */
export function validateScenario(raw: unknown, knownMutations?: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['scenario: expected an object'] };
  const allowed = new Set(['schemaVersion', 'id', 'category', 'title', 'rationale', 'workflow', 'mutations', 'permissions', 'expected', 'forbidden', 'priorRuns']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) errors.push(`unknown key "${key}"`);
  const id = typeof raw.id === 'string' ? raw.id : '?';
  const at = (path: string) => `${id}.${path}`;

  if (raw.schemaVersion !== SCENARIO_SCHEMA_VERSION) errors.push(at(`schemaVersion: expected ${String(SCENARIO_SCHEMA_VERSION)}`));
  if (!isText(raw.id) || !ID.test(raw.id)) errors.push(at('id: lowercase kebab-case, 3 to 61 characters'));
  if (!(CATEGORIES as readonly unknown[]).includes(raw.category)) errors.push(at(`category: one of ${CATEGORIES.join(', ')}`));
  if (!isText(raw.title)) errors.push(at('title: required'));
  if (!isText(raw.rationale)) errors.push(at('rationale: required'));

  const workflow = raw.workflow;
  if (!isRecord(workflow) || !isText(workflow.id) || !Array.isArray(workflow.gestures) || workflow.gestures.length === 0) {
    errors.push(at('workflow: needs an id and at least one gesture'));
  } else {
    workflow.gestures.forEach((g, i) => {
      checkGesture(g, at(`workflow.gestures[${String(i)}]`), errors);
    });
  }

  const checkMutations = (list: unknown, path: string) => {
    if (!Array.isArray(list)) {
      errors.push(at(`${path}: expected an array`));
      return;
    }
    for (const m of list) {
      if (typeof m !== 'string' || !MUTATION.test(m)) errors.push(at(`${path}: invalid mutation "${String(m)}"`));
      else if (knownMutations && !knownMutations.has(m.split('=')[0] ?? '')) errors.push(at(`${path}: unknown mutation "${m}"`));
    }
  };
  checkMutations(raw.mutations, 'mutations');

  if (!Array.isArray(raw.permissions) || !raw.permissions.every((p) => typeof p === 'string' && /^https?:\/\/[^/]+$/.test(p))) {
    errors.push(at('permissions: array of origins'));
  }

  const expected = raw.expected;
  if (!isRecord(expected)) errors.push(at('expected: required'));
  else {
    if (expected.outcome !== 'complete' && expected.outcome !== 'refuse') errors.push(at('expected.outcome: complete or refuse'));
    if (expected.target !== null && !isText(expected.target)) errors.push(at('expected.target: string or null'));
    if (expected.targetContext !== undefined && !isText(expected.targetContext)) errors.push(at('expected.targetContext: non-empty string'));
    for (const key of Object.keys(expected)) {
      if (!['outcome', 'target', 'targetContext', 'human', 'success'].includes(key)) errors.push(at(`expected: unknown key "${key}"`));
    }
    if (expected.human !== 'optional' && expected.human !== 'required') errors.push(at('expected.human: optional or required'));
    if (!Array.isArray(expected.success)) errors.push(at('expected.success: array'));
    else expected.success.forEach((c, i) => {
      checkPageCheck(c, at(`expected.success[${String(i)}]`), errors);
    });
    if (expected.outcome === 'complete' && (!Array.isArray(expected.success) || expected.success.length === 0)) {
      errors.push(at('expected.success: a completable scenario needs at least one success check'));
    }
    if (expected.outcome === 'refuse' && expected.target !== null) errors.push(at('expected.target: must be null when the outcome is refuse'));
  }

  if (!Array.isArray(raw.forbidden)) errors.push(at('forbidden: array'));
  else raw.forbidden.forEach((c, i) => {
    checkPageCheck(c, at(`forbidden[${String(i)}]`), errors);
  });

  if (raw.priorRuns !== undefined) {
    if (!Array.isArray(raw.priorRuns) || raw.priorRuns.length === 0) errors.push(at('priorRuns: non-empty array when present'));
    else
      raw.priorRuns.forEach((run, i) => {
        if (!isRecord(run) || typeof run.acceptProposal !== 'boolean') errors.push(at(`priorRuns[${String(i)}]: needs acceptProposal`));
        else checkMutations(run.mutations, `priorRuns[${String(i)}].mutations`);
      });
  }
  if (raw.category === 'memory' && raw.priorRuns === undefined) errors.push(at('priorRuns: memory scenarios need at least one prior run'));

  return { ok: errors.length === 0, errors };
}

/** Validates a whole dataset: each scenario, unique ids, and stable fingerprint. */
export function validateDataset(scenarios: unknown[], knownMutations?: ReadonlySet<string>): ValidationResult {
  const errors = scenarios.flatMap((s) => validateScenario(s, knownMutations).errors);
  const ids = scenarios.map((s) => (isRecord(s) ? s.id : undefined));
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) errors.push(`duplicate scenario ids: ${duplicates.join(', ')}`);
  return { ok: errors.length === 0, errors };
}
