import { useState } from 'react';
import { availableCommands, patternLabel, type Command, type FlowPilotError, type Workflow } from '@flowpilot/shared';
import type { ExtensionApi } from './api';
import { usePanelState } from './usePanelState';
import { Annunciator } from './components/Annunciator';
import { Controls } from './components/Controls';
import { WorkflowList } from './components/WorkflowList';
import { AllowedSites } from './components/AllowedSites';

interface Props {
  api: ExtensionApi;
}

export function App({ api }: Props) {
  const { snapshot, loaded, loadError, refresh } = usePanelState(api);
  const { session, workflows, lastRun, allowedOrigins } = snapshot;
  const [error, setError] = useState<FlowPilotError | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Sélection : celle de l'utilisateur si elle existe encore, sinon le plus récent.
  const selected =
    workflows.workflows.find((w) => w.id === pickedId) ?? workflows.workflows[0] ?? null;
  const commands = availableCommands(session, selected !== null);
  const replayed =
    session.status === 'replaying' ? workflows.workflows.find((w) => w.id === session.workflowId) : undefined;

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

  return (
    <main className="panel" aria-busy={!loaded}>
      <header className="panel-header">
        <h1>FlowPilot</h1>
      </header>

      <Annunciator session={session} replayed={replayed} />

      <Controls
        commands={commands}
        busy={busy || !loaded}
        onRecord={() => void run({ type: 'record/start' })}
        onStop={() => void run({ type: 'session/stop' })}
        onReplay={() => {
          if (selected) void run({ type: 'replay/start', workflowId: selected.id });
        }}
      />

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

      <WorkflowList
        workflows={workflows.workflows}
        invalidCount={workflows.invalidCount}
        selectedId={selected?.id ?? null}
        disabled={!commands.canRecord || busy}
        lastRun={lastRun}
        onSelect={setPickedId}
        onDelete={remove}
      />

      <AllowedSites origins={allowedOrigins} onAllow={allow} onRevoke={revoke} />
    </main>
  );
}
