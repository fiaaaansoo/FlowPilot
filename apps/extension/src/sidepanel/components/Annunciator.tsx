import { useEffect, useState } from 'react';
import { hostLabel, type SessionState, type Workflow } from '@flowpilot/shared';

interface Props {
  session: SessionState;
  /** Workflow en cours de lecture, si connu. */
  replayed: Workflow | undefined;
  /** Nombre d'étapes déjà capturées pendant un enregistrement. */
  recordedSteps?: number | undefined;
}

/**
 * Voyant d'état façon annonciateur de cockpit : éteint au repos, orange
 * (enregistreur de vol) pendant l'enregistrement, vert-bleu pendant la lecture.
 */
export function Annunciator({ session, replayed, recordedSteps }: Props) {
  const elapsed = useElapsed(session.status === 'recording' ? session.startedAt : null);

  let title: string;
  let detail: string;
  switch (session.status) {
    case 'idle':
      title = 'Au repos';
      detail = 'Ouvrez la page de départ, puis lancez l’enregistrement.';
      break;
    case 'recording':
      title = 'Enregistrement';
      detail = `${hostLabel(session.origin)}, depuis ${elapsed}${recordedSteps ? `, ${recordedSteps} étape${recordedSteps > 1 ? 's' : ''}` : ''}`;
      break;
    case 'replaying': {
      const total = replayed?.steps.length ?? 0;
      title = session.awaitingHuman ? 'Lecture en pause' : 'Lecture';
      detail = `Étape ${Math.min(session.stepIndex + 1, Math.max(total, 1))} sur ${total}${replayed ? `, ${replayed.name}` : ''}`;
      break;
    }
  }

  return (
    <section className="annunciator" data-status={session.status} aria-label="État de FlowPilot">
      <span className="annunciator__lamp" aria-hidden="true" />
      <div className="annunciator__text">
        {/* Seul le changement d'état est annoncé, pas le chronomètre qui change chaque seconde. */}
        <p className="annunciator__title" aria-live="polite">
          {title}
        </p>
        <p className="annunciator__detail">{detail}</p>
      </div>
    </section>
  );
}

function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (since === null) return '';
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}
