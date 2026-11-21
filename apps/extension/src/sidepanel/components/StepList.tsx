import { describeStep, needsHuman, type RunSummary, type StepLog, type WorkflowStep } from '@flowpilot/shared';

interface Props {
  steps: readonly WorkflowStep[];
  /** Journal du dernier run de ce workflow, pour afficher le statut de chaque étape. */
  run?: RunSummary | null;
  /** Étape en cours pendant un replay. */
  currentIndex?: number | undefined;
  label: string;
}

const STRATEGY_LABEL: Record<string, string> = {
  testid: 'identifiant de test',
  id: 'id',
  role: 'rôle et nom',
  attributes: 'attributs',
  css: 'sélecteur CSS',
  text: 'texte',
  combined: 'indices combinés',
  unconfirmed: 'page quittée après l’action',
};

type Status = StepLog['status'] | 'current' | 'pending';

const STATUS_LABEL: Record<Status, string> = {
  succeeded: 'réussie',
  failed: 'en échec',
  aborted: 'arrêtée',
  current: 'en cours',
  pending: 'non exécutée',
};

/** Étapes d'un workflow, avec leur statut au dernier run et la stratégie de grounding utilisée. */
export function StepList({ steps, run, currentIndex, label }: Props) {
  const logs = new Map(run?.log.map((entry) => [entry.stepIndex, entry]));
  return (
    <ol className="steps" aria-label={label}>
      {steps.map((step, index) => {
        const log = logs.get(index);
        const status: Status | null = index === currentIndex ? 'current' : log ? log.status : run ? 'pending' : null;
        return (
          <li key={step.id} className="step" data-status={status ?? undefined}>
            <span className="step__text">{describeStep(step)}</span>
            {needsHuman(step) && <span className="step__badge">intervention humaine</span>}
            {status && (
              <span className="step__status">
                {STATUS_LABEL[status]}
                {log?.strategy ? `, trouvée par ${STRATEGY_LABEL[log.strategy] ?? log.strategy}` : ''}
              </span>
            )}
            {log?.status === 'failed' && log.message && <span className="step__error">{log.message}</span>}
          </li>
        );
      })}
    </ol>
  );
}
