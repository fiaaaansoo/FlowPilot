import {
  RECOVERY_CONTRACT,
  RUN_RECOVERY_LIMITS,
  errorMessage,
  fail,
  kindAccepts,
  needsHuman,
  ok,
  originOf,
  parseRecoveryResponse,
  sameBinding,
  type AiProposalPrompt,
  type AiSettings,
  type Candidate,
  type ElementStep,
  type FlowPilotError,
  type Observation,
  type OutcomeReport,
  type PreviousAttempt,
  type RecoveryLog,
  type RecoveryRequest,
  type RecoveryResponse,
  type Result,
} from '@flowpilot/shared';

/**
 * Acting half of AI recovery (service worker). The backend proposes; this
 * module is the *tool execution gateway*:
 *
 *   OBSERVE (fresh snapshot) -> PROPOSE (backend) -> VALIDATE (binding, ref,
 *   compatibility, origin) -> [HUMAN] -> EXECUTE (deterministic executor on the
 *   revalidated element) -> VERIFY (action effect now, next step later)
 *   -> SUCCESS | RETRY (rejected candidate excluded) | ESCALATE
 *
 * Nothing the model says can change the action, the value, the tab or the
 * origin; budgets are enforced per run on top of the backend's per-request ones.
 */

// --- backend client -----------------------------------------------------------

export interface BackendClient {
  propose(request: RecoveryRequest, signal: AbortSignal): Promise<Result<RecoveryResponse>>;
  reportOutcome(recoveryId: string, report: OutcomeReport): Promise<void>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createBackendClient(settings: AiSettings, fetchImpl: FetchLike = (input, init) => fetch(input, init)): BackendClient {
  const headers = { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' };
  return {
    async propose(request, signal) {
      const timeout = AbortSignal.timeout(RUN_RECOVERY_LIMITS.requestTimeoutMs);
      try {
        const response = await fetchImpl(`${settings.endpoint}/v1/recovery/propose`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
          signal: AbortSignal.any([signal, timeout]),
          credentials: 'omit',
          redirect: 'error',
        });
        if (response.status === 401) return fail('RECOVERY_UNAVAILABLE', 'Service de récupération : jeton refusé.');
        if (!response.ok) return fail('RECOVERY_UNAVAILABLE', `Service de récupération : erreur HTTP ${response.status}.`);
        return parseRecoveryResponse(await response.json());
      } catch (error) {
        if (signal.aborted) return fail('NAVIGATION_FAILED', 'Exécution arrêtée.');
        const reason = timeout.aborted ? 'délai dépassé' : errorMessage(error);
        return fail('RECOVERY_UNAVAILABLE', `Service de récupération injoignable (${reason}).`);
      }
    },
    async reportOutcome(recoveryId, report) {
      try {
        await fetchImpl(`${settings.endpoint}/v1/recovery/${encodeURIComponent(recoveryId)}/outcome`, {
          method: 'POST',
          headers,
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(10_000),
          credentials: 'omit',
          redirect: 'error',
        });
      } catch (error) {
        console.error('[FlowPilot] recovery outcome not reported', errorMessage(error));
      }
    },
  };
}

// --- per-run budget -----------------------------------------------------------

export class RunRecoveryBudget {
  recoveries = 0;
  modelCalls = 0;
  tokens = 0;
  costUsd = 0;

  get exhaustedReason(): string | null {
    if (this.recoveries >= RUN_RECOVERY_LIMITS.maxRecoveries) return 'nombre maximal de récupérations atteint pour ce run';
    if (this.modelCalls >= RUN_RECOVERY_LIMITS.maxModelCalls) return 'budget d’appels au modèle épuisé';
    if (this.tokens >= RUN_RECOVERY_LIMITS.maxTokens) return 'budget de tokens épuisé';
    if (this.costUsd >= RUN_RECOVERY_LIMITS.maxCostUsd) return 'budget de coût épuisé';
    return null;
  }

  /** Per-request budget sent to the backend: never more than what remains for the run. */
  requestBudget(): RecoveryRequest['budget'] {
    return {
      maxModelCalls: Math.max(0, Math.min(3, RUN_RECOVERY_LIMITS.maxModelCalls - this.modelCalls)),
      maxTokens: Math.max(0, Math.min(12_000, RUN_RECOVERY_LIMITS.maxTokens - this.tokens)),
      timeoutMs: RUN_RECOVERY_LIMITS.requestTimeoutMs - 5_000,
      maxCostUsd: Math.max(0, Number((RUN_RECOVERY_LIMITS.maxCostUsd - this.costUsd).toFixed(6))),
    };
  }

  charge(usage: RecoveryResponse['usage']): void {
    this.modelCalls += usage.modelCalls;
    this.tokens += usage.inputTokens + usage.outputTokens;
    this.costUsd += usage.estimatedCostUsd;
  }
}

// --- gateway validation -------------------------------------------------------

/**
 * Validates a backend decision against what the extension itself observed.
 * Returns the observed candidate to execute, or why the proposal is refused.
 */
export function validateProposal(
  response: RecoveryResponse,
  request: RecoveryRequest,
  observation: Observation,
): Result<{ candidate: Candidate; confidence: number; rationale: string; strategy: RecoveryResponse['decision']['strategy']; requiresConfirmation: boolean }> {
  const decision = response.decision;
  if (!sameBinding(response.binding, request.binding)) {
    return fail('RECOVERY_UNAVAILABLE', 'Proposition rejetée : elle ne correspond pas à ce run, cet onglet ou cette page.');
  }
  if (decision.type !== 'propose_target') return fail('TARGET_NOT_FOUND', decision.reason);
  const candidate = observation.elements.find((c) => c.ref === decision.ref);
  if (!candidate) return fail('TARGET_NOT_FOUND', 'Proposition rejetée : élément absent de l’observation.');
  if (!kindAccepts(request.step.kind, candidate)) {
    return fail('TARGET_NOT_INTERACTABLE', 'Proposition rejetée : cet élément ne peut pas exécuter l’action enregistrée.');
  }
  if (candidate.sameOrigin === false) return fail('ORIGIN_NOT_ALLOWED', 'Proposition rejetée : le lien quitte le site du workflow.');
  return ok({
    candidate,
    confidence: decision.confidence,
    rationale: decision.rationale,
    strategy: decision.strategy,
    requiresConfirmation: decision.requiresConfirmation,
  });
}

/** Human-readable description of a candidate, for the confirmation prompt (untrusted text, display only). */
const IDENTIFIERS = ['id', 'name', 'data-testid', 'data-test', 'data-qa', 'data-cy', 'href'] as const;

/** Word stems of a label (accents and case ignored, short words dropped). */
function stems(text: string | undefined): Set<string> {
  const words = (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((w) => w.length >= 4).map((w) => w.slice(0, 6)));
}

/** Does the candidate share a stable identifier or a label word with the recorded element? */
export function sharesIdentity(target: ElementStep['target'], candidate: Candidate): boolean {
  if (IDENTIFIERS.some((key) => target.attributes[key] !== undefined && target.attributes[key] === candidate.attributes[key])) return true;
  const recorded = stems(target.name ?? target.text);
  return [...stems(candidate.name ?? candidate.text)].some((stem) => recorded.has(stem));
}

export function candidateLabel(candidate: Candidate): string {
  const label = candidate.name ?? candidate.text ?? candidate.attributes['aria-label'] ?? candidate.attributes.name ?? `<${candidate.tag}>`;
  const where = candidate.context
    ? `, ligne « ${candidate.context.slice(0, 80)} »`
    : candidate.section
      ? `, dans « ${candidate.section.slice(0, 80)} »`
      : '';
  return `« ${label} » (${candidate.role ?? candidate.tag})${where}`;
}

// --- the recovery loop --------------------------------------------------------

const ABORTED: FlowPilotError = { code: 'NAVIGATION_FAILED', message: 'Exécution arrêtée.' };

/** Fresh read of the signal (it can change during an `await`, which type narrowing ignores). */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

export interface RecoveryEnv {
  observe(tabId: number): Promise<Result<Observation>>;
  performRef(
    tabId: number,
    step: ElementStep,
    snapshotId: string,
    ref: string,
    confirmed: boolean,
    signal: AbortSignal,
  ): Promise<Result<{ strategy: string }>>;
}

export interface RecoveryContext {
  runId: string;
  workflowId: string;
  origin: string;
  tabId: number;
  stepIndex: number;
  step: ElementStep;
  failure: FlowPilotError;
  signal: AbortSignal;
  mode: AiSettings['mode'];
  budget: RunRecoveryBudget;
  /** Suspends the run until the user confirms (true) or stops (false). */
  requestHuman: (prompt: AiProposalPrompt) => Promise<boolean>;
  now: () => number;
}

export interface PendingOutcome {
  recoveryId: string;
  candidate: Candidate;
}

export type RecoveryResult =
  | { ok: true; strategy: string; log: RecoveryLog; pending: PendingOutcome }
  | { ok: false; error: FlowPilotError; log: RecoveryLog };

export async function recoverStep(env: RecoveryEnv, backend: BackendClient, ctx: RecoveryContext): Promise<RecoveryResult> {
  const started = ctx.now();
  const log: RecoveryLog = { outcome: 'escalated', attempts: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0 };
  const attempts: PreviousAttempt[] = [];
  const finish = (result: RecoveryResult): RecoveryResult => {
    result.log.latencyMs = ctx.now() - started;
    return result;
  };
  const escalate = (outcome: RecoveryLog['outcome'], error: FlowPilotError, reason: string): RecoveryResult =>
    finish({ ok: false, error, log: { ...log, outcome, reason } });

  const exhausted = ctx.budget.exhaustedReason;
  if (exhausted) return escalate('escalated', ctx.failure, exhausted);
  ctx.budget.recoveries += 1;

  while (log.attempts < RUN_RECOVERY_LIMITS.maxAttemptsPerStep) {
    if (isAborted(ctx.signal)) return escalate('aborted', ABORTED, 'arrêt demandé');
    const runOut = log.attempts > 0 ? ctx.budget.exhaustedReason : null;
    if (runOut) return escalate('escalated', ctx.failure, runOut);
    log.attempts += 1;

    // OBSERVE: a fresh snapshot for every attempt (the page may have changed).
    const observation = await env.observe(ctx.tabId);
    if (!observation.ok) return escalate('escalated', ctx.failure, observation.error.message);
    if (originOf(observation.value.url) !== ctx.origin) {
      return escalate('escalated', ctx.failure, 'la page n’est pas sur le site de la procédure');
    }

    const request: RecoveryRequest = {
      contract: RECOVERY_CONTRACT,
      binding: {
        runId: ctx.runId,
        workflowId: ctx.workflowId,
        stepId: ctx.step.id,
        stepIndex: ctx.stepIndex,
        origin: ctx.origin,
        tabId: ctx.tabId,
        snapshotId: observation.value.snapshotId,
      },
      failure: { code: ctx.failure.code === 'TARGET_AMBIGUOUS' ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND', message: ctx.failure.message.slice(0, 500) },
      step: { kind: ctx.step.kind, target: ctx.step.target },
      page: { url: observation.value.url, title: observation.value.title },
      observation: { snapshotId: observation.value.snapshotId, elements: observation.value.elements },
      attempts: [...attempts],
      budget: ctx.budget.requestBudget(),
    };

    // PROPOSE
    const response = await backend.propose(request, ctx.signal);
    if (!response.ok) {
      const outcome = isAborted(ctx.signal) ? 'aborted' : 'unavailable';
      return escalate(outcome, ctx.failure, response.error.message);
    }
    const { usage } = response.value;
    ctx.budget.charge(usage);
    Object.assign(log, {
      modelCalls: log.modelCalls + usage.modelCalls,
      inputTokens: log.inputTokens + usage.inputTokens,
      outputTokens: log.outputTokens + usage.outputTokens,
      costUsd: Number((log.costUsd + usage.estimatedCostUsd).toFixed(6)),
      serviceLatencyMs: (log.serviceLatencyMs ?? 0) + usage.latencyMs,
      provider: usage.provider,
      recoveryId: response.value.recoveryId,
      strategy: response.value.decision.strategy,
      ...(usage.model ? { model: usage.model } : {}),
      ...(usage.cacheReadTokens !== null ? { cacheReadTokens: (log.cacheReadTokens ?? 0) + usage.cacheReadTokens } : {}),
    });
    // A response that arrives after the run was stopped (late answer, ignored abort) is never acted on.
    if (isAborted(ctx.signal)) {
      if (response.value.decision.type === 'propose_target') {
        void backend.reportOutcome(response.value.recoveryId, { contract: RECOVERY_CONTRACT, verified: false, detail: 'run stopped before use' });
      }
      return escalate('aborted', ABORTED, 'arrêt demandé');
    }

    // VALIDATE (gateway)
    const validated = validateProposal(response.value, request, observation.value);
    if (!validated.ok) {
      if (response.value.decision.type === 'escalate') return escalate('escalated', ctx.failure, response.value.decision.reason);
      const proposed = observation.value.elements.find((c) => c.ref === (response.value.decision as { ref?: string }).ref);
      if (proposed) attempts.push({ candidate: proposed, outcome: 'rejected', reason: validated.error.message.slice(0, 300) });
      void backend.reportOutcome(response.value.recoveryId, { contract: RECOVERY_CONTRACT, verified: false, detail: validated.error.message });
      continue;
    }
    const { candidate, confidence, rationale, strategy, requiresConfirmation } = validated.value;

    // HUMAN: model doubt, irreversible element, original confirmation, or "always confirm" mode.
    let confirmed = false;
    const mustConfirm =
      requiresConfirmation ||
      candidate.irreversible === true ||
      ctx.mode === 'confirm-always' ||
      needsHuman(ctx.step) ||
      // Independent of the backend: only a lexical match may move a value or a submission without the user,
      // and a model's choice must share a word or an identifier with the recorded element to act alone.
      (strategy !== 'semantic' && ctx.step.kind !== 'click') ||
      (strategy === 'llm' && !sharesIdentity(ctx.step.target, candidate));
    const prompt: AiProposalPrompt = { kind: 'ai-proposal', proposed: candidateLabel(candidate), strategy, confidence, rationale };
    if (mustConfirm) {
      if (!(await ctx.requestHuman(prompt))) return escalate('aborted', ABORTED, 'refusé par l’utilisateur');
      confirmed = true;
    }

    // The run may have been stopped while the user was deciding.
    if (isAborted(ctx.signal)) return escalate('aborted', ABORTED, 'arrêt demandé');

    // EXECUTE + immediate VERIFY (effect checks of the deterministic executor).
    let executed = await env.performRef(ctx.tabId, ctx.step, observation.value.snapshotId, candidate.ref, confirmed, ctx.signal);
    if (!executed.ok && executed.error.code === 'CONFIRMATION_REQUIRED' && !confirmed) {
      // The page itself judges the element irreversible: ask, then retry once.
      if (!(await ctx.requestHuman(prompt))) return escalate('aborted', ABORTED, 'refusé par l’utilisateur');
      executed = await env.performRef(ctx.tabId, ctx.step, observation.value.snapshotId, candidate.ref, true, ctx.signal);
    }
    if (executed.ok) {
      return finish({
        ok: true,
        strategy: `ai:${strategy}`,
        log: { ...log, outcome: 'recovered' },
        pending: { recoveryId: response.value.recoveryId, candidate },
      });
    }
    if (isAborted(ctx.signal)) return escalate('aborted', executed.error, 'arrêt demandé');
    attempts.push({ candidate, outcome: 'failed', reason: executed.error.message.slice(0, 300) });
    void backend.reportOutcome(response.value.recoveryId, { contract: RECOVERY_CONTRACT, verified: false, detail: executed.error.message });
  }
  return escalate('escalated', ctx.failure, 'aucune proposition n’a pu être exécutée et vérifiée');
}
