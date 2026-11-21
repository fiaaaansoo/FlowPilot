import {
  errorMessage,
  fail,
  isElementStep,
  isRecoverable,
  needsHuman,
  type ElementStep,
  type FlowPilotError,
  type RecoveryLog,
  type Result,
  type RunSummary,
  type StepLog,
  type Workflow,
  type WorkflowStep,
  type HumanPromptInfo,
} from '@flowpilot/shared';

/**
 * Moteur d'exécution séquentiel, indépendant de Chrome et de tout LLM.
 * Les effets concrets passent par un `StepDriver` (Chrome en production,
 * faux driver en test).
 *
 * AI recovery plugs in after a deterministic grounding failure, through the
 * optional `recover` hook: only for eligible failures (`isRecoverable`), and
 * the run stays fully functional without it. A recovered step is verified
 * twice: by the action's own effect check, then by the next step (whose
 * success or failure is reported back through `reportOutcome`).
 */
export type StepRecovery =
  | { ok: true; strategy: string; log: RecoveryLog; recoveryId: string }
  | { ok: false; error: FlowPilotError; log: RecoveryLog };
export interface StepDriver {
  navigate(url: string, signal: AbortSignal): Promise<Result<void>>;
  /** Attend que l'onglet atteigne `url` (navigation déclenchée par l'étape précédente). */
  waitForNavigation(url: string, signal: AbortSignal): Promise<Result<void>>;
  /**
   * Localise la cible dans la page et exécute l'action ; renvoie la stratégie de grounding.
   * `confirmed` : un humain a validé l'étape ; sinon la page refuse (`CONFIRMATION_REQUIRED`)
   * une action qu'elle juge irréversible sur l'élément effectivement trouvé.
   */
  perform(step: ElementStep, signal: AbortSignal, confirmed: boolean): Promise<Result<{ strategy: string }>>;
  /**
   * Attend l'intervention humaine (confirmation ou saisie manuelle) sur l'étape.
   * `false` si le run est arrêté entre-temps.
   */
  requestHuman(stepIndex: number, signal: AbortSignal, prompt?: HumanPromptInfo): Promise<boolean>;
  /** Optional AI recovery; `null` when recovery is disabled or not applicable. */
  recover?(stepIndex: number, step: ElementStep, failure: FlowPilotError, signal: AbortSignal): Promise<StepRecovery | null>;
  /** Reports whether a recovered step was confirmed by what happened next. */
  reportOutcome?(recoveryId: string, verified: boolean, detail: string): void;
}

export interface RunOptions {
  signal: AbortSignal;
  now: () => number;
  onStepStart?: (stepIndex: number) => void | Promise<void>;
}

type StepResult = Result<{ strategy?: string }>;
type Handler<S extends WorkflowStep> = (step: S, driver: StepDriver, signal: AbortSignal, confirmed: boolean) => Promise<StepResult>;
type StepHandlers = { [K in WorkflowStep['kind']]: Handler<Extract<WorkflowStep, { kind: K }>> };

const withoutStrategy = async (result: Promise<Result<void>>): Promise<StepResult> => {
  const r = await result;
  return r.ok ? { ok: true, value: {} } : r;
};

const perform: Handler<ElementStep> = (step, driver, signal, confirmed) => driver.perform(step, signal, confirmed);

/** Un handler par type d'étape : ajouter un `kind` au schéma impose d'ajouter son handler (erreur de compilation sinon). */
const HANDLERS: StepHandlers = {
  navigate: (step, driver, signal) => withoutStrategy(driver.navigate(step.url, signal)),
  waitForNavigation: (step, driver, signal) => withoutStrategy(driver.waitForNavigation(step.url, signal)),
  click: perform,
  input: perform,
  manualInput: perform,
  select: perform,
  check: perform,
  press: perform,
  submit: perform,
};

const runHandler = (step: WorkflowStep, driver: StepDriver, signal: AbortSignal, confirmed: boolean): Promise<StepResult> =>
  (HANDLERS[step.kind] as Handler<WorkflowStep>)(step, driver, signal, confirmed);

/** Lecture fraîche du signal (il peut changer pendant un `await`, ce que le flux de types ignore). */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

/** Exécute le workflow. Ne rejette jamais : toute exception devient un échec d'étape. */
export async function runWorkflow(workflow: Workflow, driver: StepDriver, options: RunOptions): Promise<RunSummary> {
  const { signal, now, onStepStart } = options;
  const startedAt = now();
  const totalSteps = workflow.steps.length;
  const log: StepLog[] = [];

  const summary = (outcome: RunSummary['outcome'], stepsCompleted: number, failure?: RunSummary['failure']): RunSummary => ({
    workflowId: workflow.id,
    outcome,
    startedAt,
    finishedAt: now(),
    stepsCompleted,
    totalSteps,
    ...(failure ? { failure } : {}),
    log,
  });
  const record = (stepIndex: number, step: WorkflowStep, stepStart: number, entry: Partial<StepLog> = {}) => {
    log.push({ stepIndex, kind: step.kind, status: 'succeeded', startedAt: stepStart, finishedAt: now(), ...entry });
  };
  const abortAt = (index: number, step: WorkflowStep, stepStart: number) => {
    record(index, step, stepStart, { status: 'aborted' });
    return summary('aborted', index);
  };

  /** A recovered step waiting for the next step to confirm it. */
  let pendingRecovery: { recoveryId: string; stepIndex: number } | null = null;
  const settleRecovery = (verified: boolean, detail: string) => {
    if (pendingRecovery) driver.reportOutcome?.(pendingRecovery.recoveryId, verified, detail);
    pendingRecovery = null;
  };

  for (const [index, step] of workflow.steps.entries()) {
    if (isAborted(signal)) return summary('aborted', index);
    const stepStart = now();

    let result: StepResult;
    let recovery: RecoveryLog | undefined;
    try {
      await onStepStart?.(index);
      if (isAborted(signal)) return abortAt(index, step, stepStart);
      let confirmed = needsHuman(step);
      if (confirmed && !(await driver.requestHuman(index, signal))) return abortAt(index, step, stepStart);
      if (isAborted(signal)) return abortAt(index, step, stepStart);
      result = await runHandler(step, driver, signal, confirmed);
      // La page juge l'élément trouvé irréversible alors que l'étape n'était pas marquée :
      // on demande l'accord humain, puis on réessaie une seule fois.
      if (!result.ok && result.error.code === 'CONFIRMATION_REQUIRED' && !confirmed) {
        // The page judged the element sensitive: show the user why (irreversible label, data sent elsewhere).
        const warning: HumanPromptInfo = { kind: 'warning', message: result.error.message.slice(0, 300) };
        if (!(await driver.requestHuman(index, signal, warning))) return abortAt(index, step, stepStart);
        confirmed = true;
        result = await runHandler(step, driver, signal, confirmed);
      }
      // Deterministic grounding failed on a recoverable error: try AI recovery, if configured.
      if (!result.ok && !isAborted(signal) && driver.recover && isElementStep(step) && isRecoverable(result.error.code, step.kind)) {
        const recovered = await driver.recover(index, step, result.error, signal);
        if (recovered) {
          recovery = recovered.log;
          if (recovered.ok) {
            result = { ok: true, value: { strategy: recovered.strategy } };
            settleRecovery(true, `step ${index + 1} succeeded (recovered) after the recovered step`);
            pendingRecovery = { recoveryId: recovered.recoveryId, stepIndex: index };
          } else {
            const reason = recovered.log.reason ? ` Récupération IA : ${recovered.log.reason}.` : '';
            result = fail(result.error.code, `${result.error.message}${reason}`);
          }
        }
      }
    } catch (error) {
      result = fail('INTERNAL', errorMessage(error));
    }
    const extra: Partial<StepLog> = recovery ? { recovery } : {};

    if (!result.ok) {
      // Un échec provoqué par l'arrêt n'est pas une erreur de l'étape.
      if (isAborted(signal)) {
        record(index, step, stepStart, { status: 'aborted', ...extra });
        return summary('aborted', index);
      }
      settleRecovery(false, `step ${index + 1} failed after the recovered step`);
      record(index, step, stepStart, { status: 'failed', code: result.error.code, message: result.error.message, ...extra });
      return summary('failed', index, { stepIndex: index, ...result.error });
    }
    if (pendingRecovery && pendingRecovery.stepIndex < index) settleRecovery(true, `step ${index + 1} succeeded after the recovered step`);
    record(index, step, stepStart, { ...(result.value.strategy ? { strategy: result.value.strategy } : {}), ...extra });
    if (isAborted(signal)) return summary('aborted', index + 1);
  }

  settleRecovery(true, 'the workflow completed after the recovered step');
  return summary('succeeded', totalSteps);
}
