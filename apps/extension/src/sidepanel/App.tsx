import { useEffect, useMemo, useState } from 'react';
import {
  availableCommands,
  compileSteps,
  patternLabel,
  type Command,
  type FlowPilotError,
  type Workflow,
} from '@flowpilot/shared';
import { latestRuns } from '../storage/run-store';
import type { ExtensionApi } from './api';
import { usePanelState } from './usePanelState';
import { Annunciator } from './components/Annunciator';
import { Controls } from './components/Controls';
import { HumanPrompt } from './components/HumanPrompt';
import { StepList } from './components/StepList';
import { WorkflowList } from './components/WorkflowList';
import { AllowedSites } from './components/AllowedSites';
import { AiRecovery } from './components/AiRecovery';

interface Props {
  api: ExtensionApi;
  /** Intervalle du keepalive pendant un replay (le service worker MV3 s'arrête après ~30 s d'inactivité). */
  keepAliveMs?: number;
}

export function App({ api, keepAliveMs = 20_000 }: Props) {
  const { snapshot, loaded, loadError, refresh } = usePanelState(api);
  const { session, workflows, runs, draft, allowedOrigins, ai } = snapshot;
  const [error, setError] = useState<FlowPilotError | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Sélection : le workflow en lecture, sinon celui choisi s'il existe encore, sinon le plus récent.
  const replayingId = session.status === 'replaying' ? session.workflowId : null;
  const selected =
    workflows.workflows.find((w) => w.id === (replayingId ?? pickedId)) ?? workflows.workflows[0] ?? null;
  const commands = availableCommands(session, selected !== null);
  const replayed = replayingId ? workflows.workflows.find((w) => w.id === replayingId) : undefined;
  const latest = useMemo(() => latestRuns(runs), [runs]);
  const liveSteps = useMemo(() => (session.status === 'recording' && draft ? compileSteps(draft) : null), [session.status, draft]);
  const humanStep = session.status === 'replaying' && session.awaitingHuman ? replayed?.steps[session.stepIndex] : undefined;

  // Pendant un replay (en particulier une attente de confirmation), le panneau garde le service worker actif.
  useEffect(() => {
    if (session.status !== 'replaying') return;
    const timer = setInterval(() => void api.send({ type: 'session/get' }), keepAliveMs);
    return () => clearInterval(timer);
  }, [api, session.status, keepAliveMs]);

  const run = async (command: Command) => {
    setBusy(true);
    setError(null);
    const response = await api.send(command);
    if (!response.ok) setError(response.error);
    setBusy(false);
  };

  const allow = async (pattern: string) => {
    setError(null);
    let granted = false;
    try {
      // Premier appel du gestionnaire : `permissions.request` exige le geste utilisateur.
      granted = await api.requestOrigin(pattern);
    } catch (cause) {
      console.error('[FlowPilot] permissions.request', cause);
    }
    if (!granted) {
      setError({ code: 'ORIGIN_NOT_ALLOWED', message: `Accès à ${patternLabel(pattern)} non accordé.` });
    }
    return granted;
  };

  const revoke = async (pattern: string) => {
    setError(null);
    await api.removeOrigin(pattern);
  };

  const remove = (workflow: Workflow) => void run({ type: 'workflow/delete', workflowId: workflow.id });
  const stop = () => void run({ type: 'session/stop' });

  return (
    <main className="panel" aria-busy={!loaded}>
      <header className="panel-header">
        <h1>FlowPilot</h1>
      </header>

      <Annunciator session={session} replayed={replayed} recordedSteps={liveSteps?.length} />

      <Controls
        commands={commands}
        busy={busy || !loaded}
        onRecord={() => void run({ type: 'record/start' })}
        onStop={stop}
        onReplay={() => {
          if (selected) void run({ type: 'replay/start', workflowId: selected.id });
        }}
      />

      {humanStep && session.status === 'replaying' && (
        <HumanPrompt
          step={humanStep}
          proposal={session.humanPrompt}
          busy={busy}
          onContinue={() => void run({ type: 'replay/continue', stepIndex: session.stepIndex })}
          onStop={stop}
        />
      )}

      {loadError && (
        <div className="alert" role="alert">
          <p>{loadError}</p>
          <button type="button" className="link-button" onClick={refresh}>
            Réessayer
          </button>
        </div>
      )}

      {error && (
        <div className="alert" role="alert">
          <p>{error.message}</p>
          <button type="button" className="link-button" onClick={() => setError(null)}>
            Fermer
          </button>
        </div>
      )}

      {liveSteps && (
        <section className="panel-section" aria-labelledby="live-title">
          <h2 id="live-title">Étapes capturées</h2>
          <StepList steps={liveSteps} label="Étapes capturées" />
          <p className="note">Les champs sensibles (mots de passe, paiement) ne sont jamais enregistrés.</p>
        </section>
      )}

      <WorkflowList
        workflows={workflows.workflows}
        invalidCount={workflows.invalidCount}
        selectedId={selected?.id ?? null}
        disabled={!commands.canRecord || busy}
        latestRuns={latest}
        currentIndex={session.status === 'replaying' ? session.stepIndex : undefined}
        onSelect={setPickedId}
        onDelete={remove}
      />

      <AllowedSites origins={allowedOrigins} onAllow={allow} onRevoke={revoke} />

      <AiRecovery
        key={`${ai.enabled}|${ai.endpoint}|${ai.mode}|${ai.token.length}`}
        api={api}
        settings={ai}
        onError={(message) => setError({ code: 'RECOVERY_UNAVAILABLE', message })}
      />
    </main>
  );
}
