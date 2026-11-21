import { describeStep, type AiProposalPrompt, type WorkflowStep } from '@flowpilot/shared';

interface Props {
  step: WorkflowStep;
  /** Present when the decision is about an AI recovery proposal. */
  proposal?: AiProposalPrompt | undefined;
  busy: boolean;
  onContinue: () => void;
  onStop: () => void;
}

const STRATEGY: Record<AiProposalPrompt['strategy'], string> = {
  memory: 'correction déjà vérifiée',
  semantic: 'correspondance sémantique',
  llm: 'modèle de langage',
  none: 'aucune',
};

/**
 * Le replay attend une décision humaine : confirmer une action irréversible,
 * saisir soi-même un champ sensible, ou valider l'élément proposé par la
 * récupération IA. Les textes de la proposition viennent de la page et du
 * modèle : ils sont affichés, jamais interprétés.
 */
export function HumanPrompt({ step, proposal, busy, onContinue, onStop }: Props) {
  const manual = step.kind === 'manualInput';
  const title = proposal ? 'Proposition de l’IA à confirmer' : manual ? 'Saisie manuelle requise' : 'Confirmation requise';
  return (
    <section className="human-prompt" role="alertdialog" aria-labelledby="human-title" aria-describedby="human-text">
      <h2 id="human-title">{title}</h2>
      {proposal ? (
        <div id="human-text">
          <p>
            {describeStep(step)} : l’élément enregistré a changé. FlowPilot propose {proposal.proposed} (
            {STRATEGY[proposal.strategy]}, confiance {Math.round(proposal.confidence * 100)} %).
          </p>
          {proposal.rationale && <p className="note">Justification du modèle, non vérifiée : {proposal.rationale}</p>}
        </div>
      ) : (
        <p id="human-text">
          {manual
            ? `${describeStep(step)}. Remplissez ce champ dans la page, puis continuez.`
            : `${describeStep(step)} : cette action peut être irréversible. FlowPilot l’exécutera seulement si vous confirmez.`}
        </p>
      )}
      <div className="human-prompt__actions">
        <button type="button" className="control control--replay" disabled={busy} onClick={onContinue}>
          {manual && !proposal ? 'Continuer' : 'Confirmer et exécuter'}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onStop}>
          Arrêter
        </button>
      </div>
    </section>
  );
}
