import { errorMessage, fail, type Result, type RunSummary, type Workflow, type WorkflowStep } from '@flowpilot/shared';

/**
 * Moteur d'exécution séquentiel, indépendant de Chrome et de tout LLM.
 * Les effets concrets passent par un `StepDriver` (Chrome en production,
 * faux driver en test). Le Recovery Agent (Sprint 3) s'insérera entre l'échec
 * d'une étape et l'arrêt du run, sans toucher à cette boucle.
 */
export interface StepDriver {
  navigate(url: string, signal: AbortSignal): Promise<Result<void>>;
}

export interface RunOptions {
  signal: AbortSignal;
  now: () => number;
  onStepStart?: (stepIndex: number) => void | Promise<void>;
}

export async function runWorkflow(workflow: Workflow, driver: StepDriver, options: RunOptions): Promise<RunSummary> {
  const { signal, now, onStepStart } = options;
  const startedAt = now();
  const totalSteps = workflow.steps.length;
  const summary = (outcome: RunSummary['outcome'], stepsCompleted: number, failure?: RunSummary['failure']): RunSummary => ({
    workflowId: workflow.id,
    outcome,
    startedAt,
    finishedAt: now(),
    stepsCompleted,
    totalSteps,
    ...(failure ? { failure } : {}),
  });

  for (const [index, step] of workflow.steps.entries()) {
    if (isAborted(signal)) return summary('aborted', index);
    // Aucune exception ne sort de la boucle : runWorkflow renvoie toujours un résumé.
    let result: Result<void>;
    try {
      await onStepStart?.(index);
      if (isAborted(signal)) return summary('aborted', index);
      result = await HANDLERS[step.kind](step, driver, signal);
    } catch (error) {
      result = fail('INTERNAL', errorMessage(error));
    }

    if (!result.ok) {
      // Un échec provoqué par l'arrêt n'est pas une erreur de l'étape.
      if (isAborted(signal)) return summary('aborted', index);
      return summary('failed', index, { stepIndex: index, ...result.error });
    }
    if (isAborted(signal)) return summary('aborted', index + 1);
  }

  return summary('succeeded', totalSteps);
}

type StepHandlers = {
  [K in WorkflowStep['kind']]: (step: Extract<WorkflowStep, { kind: K }>, driver: StepDriver, signal: AbortSignal) => Promise<Result<void>>;
};

/** Un handler par type d'étape : ajouter un `kind` au schéma impose d'ajouter son handler (erreur de compilation sinon). */
const HANDLERS: StepHandlers = {
  navigate: (step, driver, signal) => driver.navigate(step.url, signal),
};

/** Lecture fraîche du signal (il peut changer pendant un `await`, ce que le flux de types ignore). */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;
