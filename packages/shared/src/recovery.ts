import { isFiniteNumber, isNonEmptyString, isRecord } from './guards.js';
import { fail, ok, type ErrorCode, type Result } from './result.js';
import type { ElementStep, ElementTarget, StepKind } from './workflow.js';

/**
 * AI recovery contract `flowpilot.recovery/v1` (extension side).
 *
 * Twin of `apps/api/flowpilot_api/contracts.py`; both validate the shared
 * fixtures in `tests/contracts`. The backend only ever *selects* one observed
 * element (`ref`) for the failed step: it cannot change the action, the value,
 * or navigate. The extension revalidates every decision before executing it.
 */
export const RECOVERY_CONTRACT = 'flowpilot.recovery/v1' as const;

/** Failures eligible for AI recovery. Permission, sensitive-field and confirmation failures never are. */
export const RECOVERABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['TARGET_NOT_FOUND', 'TARGET_AMBIGUOUS']);

export const isRecoverable = (code: ErrorCode, kind: StepKind): boolean => RECOVERABLE_CODES.has(code) && kind !== 'manualInput';

/** An element visible in the page at snapshot time. Its texts are untrusted website content. */
export interface Candidate {
  ref: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  context?: string;
  section?: string;
  attributes: Record<string, string>;
  disabled?: boolean;
  irreversible?: boolean;
  sameOrigin?: boolean;
}

export interface Observation {
  snapshotId: string;
  url: string;
  title: string;
  elements: Candidate[];
}

export interface RecoveryBinding {
  runId: string;
  workflowId: string;
  stepId: string;
  stepIndex: number;
  origin: string;
  tabId: number;
  snapshotId: string;
}

export interface PreviousAttempt {
  candidate: Candidate;
  outcome: 'rejected' | 'failed';
  reason: string;
}

export interface RecoveryBudget {
  maxModelCalls: number;
  maxTokens: number;
  timeoutMs: number;
  maxCostUsd: number;
}

export interface RecoveryRequest {
  contract: typeof RECOVERY_CONTRACT;
  binding: RecoveryBinding;
  failure: { code: 'TARGET_NOT_FOUND' | 'TARGET_AMBIGUOUS'; message: string };
  step: { kind: ElementStep['kind']; target: ElementTarget };
  page: { url: string; title: string };
  observation: { snapshotId: string; elements: Candidate[] };
  attempts: PreviousAttempt[];
  budget: RecoveryBudget;
}

export type RecoveryStrategy = 'memory' | 'semantic' | 'llm' | 'none';

export type RecoveryDecision =
  | {
      type: 'propose_target';
      ref: string;
      confidence: number;
      strategy: RecoveryStrategy;
      rationale: string;
      requiresConfirmation: boolean;
    }
  | { type: 'escalate'; strategy: RecoveryStrategy; reason: string };

export interface RecoveryUsage {
  provider: string;
  model: string | null;
  promptVersion: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  latencyMs: number;
  estimatedCostUsd: number;
  contextElements: number;
}

export interface RecoveryResponse {
  contract: typeof RECOVERY_CONTRACT;
  recoveryId: string;
  binding: RecoveryBinding;
  decision: RecoveryDecision;
  usage: RecoveryUsage;
}

export interface OutcomeReport {
  contract: typeof RECOVERY_CONTRACT;
  verified: boolean;
  detail: string;
  correctedTarget?: Candidate;
}

// --- Validation of backend responses (never trust the wire) ---------------------

const STRATEGIES: ReadonlySet<unknown> = new Set<RecoveryStrategy>(['memory', 'semantic', 'llm', 'none']);
const REF = /^e\d{1,5}$/;
const isNum = (v: unknown, min = 0): v is number => isFiniteNumber(v) && v >= min;
const nullableNum = (v: unknown): v is number | null => v === null || isNum(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function parseBinding(raw: unknown): RecoveryBinding | null {
  if (!isRecord(raw)) return null;
  const { runId, workflowId, stepId, stepIndex, origin, tabId, snapshotId } = raw;
  if (
    !isNonEmptyString(runId) ||
    !isNonEmptyString(workflowId) ||
    !isNonEmptyString(stepId) ||
    !isNum(stepIndex) ||
    !isNonEmptyString(origin) ||
    !isNum(tabId) ||
    !isNonEmptyString(snapshotId)
  ) {
    return null;
  }
  return { runId, workflowId, stepId, stepIndex, origin, tabId, snapshotId };
}

function parseDecision(raw: unknown): RecoveryDecision | null {
  if (!isRecord(raw) || !STRATEGIES.has(raw.strategy)) return null;
  const strategy = raw.strategy as RecoveryStrategy;
  if (raw.type === 'escalate') return isStr(raw.reason, 300) ? { type: 'escalate', strategy, reason: raw.reason } : null;
  if (raw.type !== 'propose_target') return null;
  const { ref, confidence, rationale, requiresConfirmation } = raw;
  if (typeof ref !== 'string' || !REF.test(ref) || !isNum(confidence) || confidence > 1) return null;
  if (!isStr(rationale, 300) || typeof requiresConfirmation !== 'boolean') return null;
  return { type: 'propose_target', ref, confidence, strategy, rationale, requiresConfirmation };
}

function parseUsage(raw: unknown): RecoveryUsage | null {
  if (!isRecord(raw)) return null;
  const u = raw;
  if (
    !isStr(u.provider, 40) ||
    !(u.model === null || isStr(u.model, 120)) ||
    !isStr(u.promptVersion, 40) ||
    !isNum(u.modelCalls) ||
    !isNum(u.inputTokens) ||
    !isNum(u.outputTokens) ||
    !nullableNum(u.cacheReadTokens) ||
    !nullableNum(u.cacheWriteTokens) ||
    !isNum(u.latencyMs) ||
    !isNum(u.estimatedCostUsd) ||
    !isNum(u.contextElements)
  ) {
    return null;
  }
  return {
    provider: u.provider,
    model: u.model,
    promptVersion: u.promptVersion,
    modelCalls: u.modelCalls,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    latencyMs: u.latencyMs,
    estimatedCostUsd: u.estimatedCostUsd,
    contextElements: u.contextElements,
  };
}

export function parseRecoveryResponse(raw: unknown): Result<RecoveryResponse> {
  const invalid = fail('RECOVERY_UNAVAILABLE', 'Réponse invalide du service de récupération.');
  if (!isRecord(raw) || raw.contract !== RECOVERY_CONTRACT || !isNonEmptyString(raw.recoveryId) || raw.recoveryId.length > 64) {
    return invalid;
  }
  const binding = parseBinding(raw.binding);
  const decision = parseDecision(raw.decision);
  const usage = parseUsage(raw.usage);
  if (!binding || !decision || !usage) return invalid;
  return ok({ contract: RECOVERY_CONTRACT, recoveryId: raw.recoveryId, binding, decision, usage });
}

export const sameBinding = (a: RecoveryBinding, b: RecoveryBinding): boolean =>
  a.runId === b.runId &&
  a.workflowId === b.workflowId &&
  a.stepId === b.stepId &&
  a.stepIndex === b.stepIndex &&
  a.origin === b.origin &&
  a.tabId === b.tabId &&
  a.snapshotId === b.snapshotId;

// --- Step kind compatibility (mirrors grounding.accepts in the backend) -----------

const CLICKABLE = new Set(['button', 'link', 'tab', 'menuitem', 'option', 'switch', 'checkbox', 'radio', 'treeitem']);
const TEXT = new Set(['textbox', 'searchbox', 'spinbutton']);
const TOGGLE = new Set(['checkbox', 'radio', 'switch']);

export function kindAccepts(kind: ElementStep['kind'], c: Candidate): boolean {
  if (c.disabled) return false;
  const role = c.role ?? '';
  switch (kind) {
    case 'click':
      return CLICKABLE.has(role) || ['a', 'button', 'summary'].includes(c.tag) || role === '';
    case 'input':
    case 'press':
    case 'manualInput':
      return TEXT.has(role) || c.tag === 'textarea';
    case 'select':
      return c.tag === 'select' || role === 'combobox' || role === 'listbox';
    case 'check':
      return TOGGLE.has(role);
    case 'submit':
      return c.tag === 'form' || role === 'form';
  }
}

// --- AI settings (stored locally by the side panel) -------------------------------

export type AutonomyMode = 'auto-when-safe' | 'confirm-always';

export interface AiSettings {
  enabled: boolean;
  /** Backend base URL. Loopback only in this version (no remote agent endpoint). */
  endpoint: string;
  token: string;
  mode: AutonomyMode;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  endpoint: 'http://127.0.0.1:8787',
  token: '',
  mode: 'auto-when-safe',
};

/** `http://127.0.0.1:<port>` or `http://localhost:<port>` only. */
export function isLoopbackEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.pathname.replace(/\/$/, '') === '' &&
      !url.search &&
      !url.hash &&
      !url.username
    );
  } catch {
    return false;
  }
}

export function parseAiSettings(raw: unknown): AiSettings {
  if (!isRecord(raw)) return DEFAULT_AI_SETTINGS;
  const endpoint = typeof raw.endpoint === 'string' && isLoopbackEndpoint(raw.endpoint) ? raw.endpoint.replace(/\/$/, '') : DEFAULT_AI_SETTINGS.endpoint;
  const token = typeof raw.token === 'string' && raw.token.length <= 200 ? raw.token : '';
  const mode: AutonomyMode = raw.mode === 'confirm-always' ? 'confirm-always' : 'auto-when-safe';
  return { enabled: raw.enabled === true && token.length >= 24, endpoint, token, mode };
}

/** Per-run limits, on top of the backend's per-request limits. */
export const RUN_RECOVERY_LIMITS = {
  maxRecoveries: 3,
  maxAttemptsPerStep: 2,
  maxModelCalls: 6,
  maxTokens: 30_000,
  maxCostUsd: 0.1,
  /** Per backend request. Includes a cold local-model load (tens of seconds on first use). */
  requestTimeoutMs: 90_000,
} as const;
