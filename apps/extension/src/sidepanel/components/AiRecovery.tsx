import { useState, type SubmitEvent } from 'react';
import { isLoopbackEndpoint, originPatternFor, type AiSettings, type AutonomyMode } from '@flowpilot/shared';
import type { BackendStatus, ExtensionApi, MemoryEntry } from '../api';

interface Props {
  api: ExtensionApi;
  settings: AiSettings;
  /** Requests host access to the backend (user gesture) and reports the outcome. */
  onError: (message: string) => void;
}

/**
 * Optional AI recovery settings. Disabled by default: FlowPilot then records
 * and replays deterministically, exactly as without a backend.
 *
 * The parent remounts this form (via `key`) when the stored settings change, so
 * local edits always start from the saved values.
 */
export function AiRecovery({ api, settings, onError }: Props) {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [token, setToken] = useState(settings.token);
  const [mode, setMode] = useState<AutonomyMode>(settings.mode);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [status, setStatus] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[] | null>(null);

  const draft: AiSettings = { enabled, endpoint: endpoint.trim().replace(/\/$/, ''), token: token.trim(), mode };
  const endpointValid = isLoopbackEndpoint(draft.endpoint);
  const tokenValid = draft.token.length >= 24;

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!endpointValid) {
      onError('Adresse refusée : seul un service local (http://127.0.0.1 ou http://localhost) est accepté.');
      return;
    }
    if (enabled && !tokenValid) {
      onError('Jeton trop court : copiez le jeton FLOWPILOT_API_TOKEN du service.');
      return;
    }
    const pattern = originPatternFor(draft.endpoint);
    // `permissions.request` first, synchronously in the gesture handler.
    const access = pattern ? api.requestOrigin(pattern) : Promise.resolve(false);
    void access
      .then(async (granted) => {
        if (!granted) {
          onError('Accès au service local non accordé.');
          return;
        }
        await api.saveAiSettings(draft);
        setStatus('Réglages enregistrés.');
      })
      .catch(() => onError('Accès au service local non accordé.'));
  };

  const test = async () => {
    setStatus('Connexion…');
    const result = await api.backendStatus(draft);
    setStatus(result.ok ? describeStatus(result.value) : result.error.message);
  };

  const showMemory = async () => {
    const result = await api.listMemory(draft);
    if (result.ok) setMemory(result.value);
    else onError(result.error.message);
  };

  const forget = async (id: number | 'all') => {
    const result = await api.forgetMemory(draft, id);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    await showMemory();
  };

  return (
    <section className="panel-section" aria-labelledby="ai-title">
      <h2 id="ai-title">Récupération IA</h2>
      <p className="note">
        Quand un élément enregistré a changé, un service local peut proposer l’élément équivalent. FlowPilot vérifie
        chaque proposition avant d’agir. Désactivée, la lecture reste entièrement déterministe.
      </p>
      <form className="ai-form" onSubmit={save} noValidate>
        <label className="choice-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Activer la récupération IA
        </label>
        <label htmlFor="ai-endpoint">Adresse du service local</label>
        <input
          id="ai-endpoint"
          type="url"
          value={endpoint}
          spellCheck={false}
          aria-invalid={!endpointValid}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <label htmlFor="ai-token">Jeton d’accès</label>
        <input
          id="ai-token"
          type="password"
          autoComplete="off"
          value={token}
          aria-invalid={enabled && !tokenValid}
          onChange={(e) => setToken(e.target.value)}
        />
        <label htmlFor="ai-mode">Autonomie</label>
        <select id="ai-mode" value={mode} onChange={(e) => setMode(e.target.value === 'confirm-always' ? 'confirm-always' : 'auto-when-safe')}>
          <option value="auto-when-safe">Agir seule si la proposition est sûre</option>
          <option value="confirm-always">Toujours me demander</option>
        </select>
        <div className="ai-form__actions">
          <button type="submit" className="secondary-button">
            Enregistrer les réglages
          </button>
          <button type="button" className="link-button" onClick={() => void test()}>
            Tester la connexion
          </button>
        </div>
        {status && (
          <p className="hint" role="status">
            {status}
          </p>
        )}
      </form>

      <div className="ai-memory">
        <button type="button" className="link-button" onClick={() => void showMemory()}>
          Corrections mémorisées
        </button>
        {memory &&
          (memory.length === 0 ? (
            <p className="empty">Aucune correction mémorisée.</p>
          ) : (
            <>
              <ul className="sites" aria-label="Corrections mémorisées">
                {memory.map((entry) => (
                  <li key={entry.id} className="site">
                    <span className="site__name">
                      {entry.original} → {entry.corrected} ({entry.uses} réutilisation{entry.uses > 1 ? 's' : ''})
                    </span>
                    <button type="button" className="link-button" onClick={() => void forget(entry.id)}>
                      Oublier
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="link-button" onClick={() => void forget('all')}>
                Tout oublier
              </button>
            </>
          ))}
      </div>
    </section>
  );
}

function describeStatus(status: BackendStatus): string {
  if (!status.llmEnabled) return 'Connecté : sans modèle (mémoire et correspondance sémantique uniquement).';
  const cost = status.local ? 'local, sans frais d’API' : 'service distant facturé à l’usage';
  return `Connecté : ${status.provider}${status.model ? ` (${status.model})` : ''}, ${cost}.`;
}
