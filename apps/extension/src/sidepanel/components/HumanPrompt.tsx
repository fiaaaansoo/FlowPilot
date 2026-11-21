import { describeStep, type WorkflowStep } from '@flowpilot/shared';

interface Props {
  step: WorkflowStep;
  busy: boolean;
  onContinue: () => void;
  onStop: () => void;
}

/**
 * Le replay attend une décision humaine : confirmer une action irréversible,
 * ou saisir soi-même un champ sensible dans la page.
 */
export function HumanPrompt({ step, busy, onContinue, onStop }: Props) {
  const manual = step.kind === 'manualInput';
  return (
    <section className="human-prompt" role="alertdialog" aria-labelledby="human-title" aria-describedby="human-text">
      <h2 id="human-title">{manual ? 'Saisie manuelle requise' : 'Confirmation requise'}</h2>
      <p id="human-text">
        {manual
          ? `${describeStep(step)}. Remplissez ce champ dans la page, puis continuez.`
          : `${describeStep(step)} : cette action peut être irréversible. FlowPilot l’exécutera seulement si vous confirmez.`}
      </p>
      <div className="human-prompt__actions">
        <button type="button" className="control control--replay" disabled={busy} onClick={onContinue}>
          {manual ? 'Continuer' : 'Confirmer et exécuter'}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onStop}>
          Arrêter
        </button>
      </div>
    </section>
  );
}
