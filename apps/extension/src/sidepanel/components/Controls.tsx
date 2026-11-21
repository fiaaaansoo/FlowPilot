import type { AvailableCommands } from '@flowpilot/shared';

interface Props {
  commands: AvailableCommands;
  busy: boolean;
  onRecord: () => void;
  onStop: () => void;
  onReplay: () => void;
}

export function Controls({ commands, busy, onRecord, onStop, onReplay }: Props) {
  return (
    <div className="controls" role="group" aria-label="Commandes">
      <button type="button" className="control control--record" disabled={busy || !commands.canRecord} onClick={onRecord}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5" />
        </svg>
        Enregistrer
      </button>
      <button type="button" className="control control--stop" disabled={busy || !commands.canStop} onClick={onStop}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
        </svg>
        Arrêter
      </button>
      <button type="button" className="control control--replay" disabled={busy || !commands.canReplay} onClick={onReplay}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 3v10l8.5-5z" />
        </svg>
        Rejouer
      </button>
    </div>
  );
}
