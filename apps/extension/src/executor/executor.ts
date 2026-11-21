import {
  errorMessage,
  fail,
  needsHuman,
  type ElementStep,
  type Result,
  type RunSummary,
  type StepLog,
  type Workflow,
  type WorkflowStep,
} from '@flowpilot/shared';

/**
 * Moteur d'exécution séquentiel, indépendant de Chrome et de tout LLM.
 * Les effets concrets passent par un `StepDriver` (Chrome en production,
 * faux driver en test). Le Recovery Agent (Sprint 3) s'insérera entre l'échec
 * d'une étape et l'arrêt du run, derrière la même interface.
 */
export interface StepDriver {
  navigate(url: string, signal: AbortSignal): Promise<Result<void>>;
  /** Attend que l'onglet atteigne `url` (navigation déclenchée par l'étape précédente). */
  waitForNavigation(url: string, signal: AbortSignal): Promise<Result<void>>;
  /** Localise la cible dans la page et exécute l'action ; renvoie la stratégie de grounding. */
  perform(step: ElementStep, signal: AbortSignal): Promise<Result<{ strategy: string }>>;
  /**
   * Attend l'intervention humaine (confirmation ou saisie manuelle) sur l'étape.
   * `false` si le run est arrêté entre-temps.
   */
  requestHuman(stepIndex: number, signal: AbortSignal): Promise<boolean>;
}

export interface RunOptions {
  signal: AbortSignal;
  now: () => number;
  onStepStart?: (stepIndex: number) => void | Promise<void>;
}

type StepResult = Result<{ strategy?: string }>;
type Handler<S extends WorkflowStep> = (step: S, driver: StepDriver, signal: AbortSignal) => Promise<StepResult>;
type StepHandlers = { [K in WorkflowStep['kind']]: Handler<Extract<WorkflowStep, { kind: K }>> };

const withoutStrategy = async (result: Promise<Result<void>>): Promise<StepResult> => {
  const r = await result;
  return r.ok ? { ok: true, value: {} } : r;
};

const perform: Handler<ElementStep> = (step, driver, signal) => driver.perform(step, signal);

/** Un handler par type d'étape : ajouter un `kind` au schéma impose d'ajouter son handler (erreur de compilation sinon). */
const HANDLERS: StepHandlers = {
  navigate: (step, driver, signal) => withoutStrategy(driver.navigate(step.url, signal)),
  waitForNavigation: (step, driver, signal) => withoutStrategy(driver.waitForNavigation(step.url, signal)),
  click: perform,
  input: perform,
  manualInput: perform,
  select: perform,
  check: perform,
  submit: perform,
};

const runHandler = (step: WorkflowStep, driver: StepDriver, signal: AbortSignal): Promise<StepResult> =>
  (HANDLERS[step.kind] as Handler<WorkflowStep>)(step, driver, signal);

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

  for (const [index, step] of workflow.steps.entries()) {
    if (isAborted(signal)) return summary('aborted', index);
    const stepStart = now();

    let result: StepResult;
    try {
      await onStepStart?.(index);
      if (isAborted(signal)) return abortAt(index, step, stepStart);
      if (needsHuman(step) && !(await driver.requestHuman(index, signal))) return abortAt(index, step, stepStart);
      if (isAborted(signal)) return abortAt(index, step, stepStart);
      result = await runHandler(step, driver, signal);
    } catch (error) {
      result = fail('INTERNAL', errorMessage(error));
    }

    if (!result.ok) {
      // Un échec provoqué par l'arrêt n'est pas une erreur de l'étape.
      if (isAborted(signal)) return abortAt(index, step, stepStart);
      record(index, step, stepStart, { status: 'failed', code: result.error.code, message: result.error.message });
      return summary('failed', index, { stepIndex: index, ...result.error });
    }
    record(index, step, stepStart, result.value.strategy ? { strategy: result.value.strategy } : {});
    if (isAborted(signal)) return summary('aborted', index + 1);
  }

  return summary('succeeded', totalSteps);
}
