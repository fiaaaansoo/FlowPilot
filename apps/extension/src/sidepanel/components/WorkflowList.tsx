import type { RunSummary, Workflow } from '@flowpilot/shared';
import { StepList } from './StepList';

interface Props {
  workflows: Workflow[];
  invalidCount: number;
  selectedId: string | null;
  disabled: boolean;
  /** Dernier run de chaque workflow. */
  latestRuns: ReadonlyMap<string, RunSummary>;
  /** Étape en cours si le workflow sélectionné est en lecture. */
  currentIndex?: number | undefined;
  onSelect: (id: string) => void;
  onDelete: (workflow: Workflow) => void;
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function WorkflowList({ workflows, invalidCount, selectedId, disabled, latestRuns, currentIndex, onSelect, onDelete }: Props) {
  return (
    <section className="panel-section" aria-labelledby="workflows-title">
      <h2 id="workflows-title">Workflows enregistrés</h2>
      {workflows.length === 0 ? (
        <p className="empty">Aucun workflow pour l’instant. Enregistrez une procédure pour pouvoir la rejouer.</p>
      ) : (
        <ul className="workflows" role="radiogroup" aria-labelledby="workflows-title">
          {workflows.map((workflow) => {
            const selected = workflow.id === selectedId;
            const run = latestRuns.get(workflow.id) ?? null;
            return (
              <li key={workflow.id} className="workflow" data-selected={selected}>
                <div className="workflow__head">
                  <label className="workflow__pick">
                    <input
                      type="radio"
                      name="workflow"
                      value={workflow.id}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => onSelect(workflow.id)}
                    />
                    <span className="workflow__name">{workflow.name}</span>
                    <span className="workflow__meta">
                      {plural(workflow.steps.length, 'étape')}, créé le {dateFormat.format(new Date(workflow.createdAt))}
                    </span>
                    {run && <RunLine run={run} />}
                  </label>
                  <button
                    type="button"
                    className="link-button"
                    disabled={disabled}
                    onClick={() => onDelete(workflow)}
                    aria-label={`Supprimer ${workflow.name}`}
                  >
                    Supprimer
                  </button>
                </div>
                {selected && (
                  <StepList steps={workflow.steps} run={run} currentIndex={currentIndex} label={`Étapes de ${workflow.name}`} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {invalidCount > 0 && (
        <p className="note" role="status">
          {plural(invalidCount, 'workflow')} illisible{invalidCount > 1 ? 's' : ''} ignoré{invalidCount > 1 ? 's' : ''} (format
          inconnu ou corrompu).
        </p>
      )}
    </section>
  );
}

function RunLine({ run }: { run: RunSummary }) {
  const steps = `${run.stepsCompleted} sur ${plural(run.totalSteps, 'étape')}`;
  switch (run.outcome) {
    case 'succeeded':
      return <span className="workflow__run" data-outcome="succeeded">Dernière lecture réussie, {steps}.</span>;
    case 'aborted':
      return <span className="workflow__run" data-outcome="aborted">Dernière lecture arrêtée, {steps}.</span>;
    case 'failed':
      return (
        <span className="workflow__run" data-outcome="failed">
          Échec à l’étape {(run.failure?.stepIndex ?? run.stepsCompleted) + 1} : {run.failure?.message ?? 'cause inconnue'}
        </span>
      );
  }
}
