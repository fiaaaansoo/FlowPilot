import {
  DEFAULT_AI_SETTINGS,
  IDLE,
  errorMessage,
  fail,
  isLoopbackEndpoint,
  isRecord,
  ok,
  parseAiSettings,
  type AiSettings,
  type Command,
  type CommandResponse,
  type RecordingDraft,
  type Result,
  type RunSummary,
  type SessionState,
} from '@flowpilot/shared';
import { chromeArea } from '../storage/area';
import { AI_SETTINGS_KEY, LOCAL_KEYS, SESSION_KEYS } from '../storage/keys';
import { RunStore } from '../storage/run-store';
import { SessionStore } from '../storage/session-store';
import { WorkflowStore, type WorkflowList } from '../storage/workflow-store';

/** Instantané de tout ce que le Side Panel affiche. */
export interface PanelSnapshot {
  session: SessionState;
  workflows: WorkflowList;
  /** Historique des exécutions, du plus récent au plus ancien. */
  runs: RunSummary[];
  /** Brouillon de l'enregistrement en cours (aperçu des étapes en direct). */
  draft: RecordingDraft | null;
  /** Motifs d'origine accordés à l'extension (ex. `http://localhost/*`). */
  allowedOrigins: string[];
  /** AI recovery settings (disabled by default). */
  ai: AiSettings;
}

/** What `/v1/status` reports about the local recovery backend. */
export interface BackendStatus {
  provider: string;
  model: string | null;
  local: boolean;
  llmEnabled: boolean;
}

/** A memorized correction, as listed by the backend (display only). */
export interface MemoryEntry {
  id: number;
  original: string;
  corrected: string;
  uses: number;
  strategy: string;
}

/**
 * Frontière entre l'UI et Chrome. Le Side Panel lit le stockage et les
 * permissions, mais n'écrit jamais la session : il envoie des `Command` au
 * service worker. Seules les permissions sont demandées ici, car
 * `chrome.permissions.request` exige un geste utilisateur dans une page.
 */
export interface ExtensionApi {
  snapshot(): Promise<PanelSnapshot>;
  /** Appelle `onChange` à chaque modification pertinente ; renvoie la désinscription. */
  subscribe(onChange: () => void): () => void;
  send(command: Command): Promise<CommandResponse>;
  requestOrigin(pattern: string): Promise<boolean>;
  removeOrigin(pattern: string): Promise<boolean>;
  /** Saves AI settings (configuration, not session state: the panel may write it). */
  saveAiSettings(settings: AiSettings): Promise<void>;
  backendStatus(settings: AiSettings): Promise<Result<BackendStatus>>;
  listMemory(settings: AiSettings): Promise<Result<MemoryEntry[]>>;
  forgetMemory(settings: AiSettings, id: number | 'all'): Promise<Result<void>>;
}

const WATCHED_KEYS = new Set<string>([...Object.values(SESSION_KEYS), ...Object.values(LOCAL_KEYS)]);

export const EMPTY_SNAPSHOT: PanelSnapshot = {
  session: IDLE,
  workflows: { workflows: [], invalidCount: 0 },
  runs: [],
  draft: null,
  allowedOrigins: [],
  ai: DEFAULT_AI_SETTINGS,
};

/** Authenticated call to the loopback backend. Errors are explicit, never thrown. */
async function backendFetch(settings: AiSettings, path: string, init: RequestInit = {}): Promise<Result<unknown>> {
  if (!isLoopbackEndpoint(settings.endpoint)) {
    return fail('RECOVERY_UNAVAILABLE', 'Adresse refusée : seul un service local est accepté.');
  }
  try {
    const response = await fetch(`${settings.endpoint}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${settings.token}` },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return fail('RECOVERY_UNAVAILABLE', 'Jeton refusé par le service.');
    if (!response.ok) return fail('RECOVERY_UNAVAILABLE', `Le service a répondu HTTP ${response.status}.`);
    return ok((await response.json()) as unknown);
  } catch (error) {
    return fail('RECOVERY_UNAVAILABLE', `Service injoignable (${errorMessage(error)}).`);
  }
}

const label = (target: unknown): string => {
  if (!isRecord(target)) return '?';
  const text = [target.name, target.text].find((v) => typeof v === 'string' && v);
  return typeof text === 'string' ? `« ${text} »` : `<${String(target.tag)}>`;
};

export const chromeApi: ExtensionApi = {
  async snapshot() {
    // Mêmes stores (et donc même validation) que le service worker, en lecture seule.
    const sessions = new SessionStore(chromeArea(chrome.storage.session));
    const workflows = new WorkflowStore(chromeArea(chrome.storage.local));
    const runs = new RunStore(chromeArea(chrome.storage.local));
    const [session, workflowList, runList, draft, permissions, aiItems] = await Promise.all([
      sessions.getSession(),
      workflows.list(),
      runs.list(),
      sessions.getDraft(),
      chrome.permissions.getAll(),
      chrome.storage.local.get(AI_SETTINGS_KEY),
    ]);
    return {
      session,
      workflows: workflowList,
      runs: runList,
      draft,
      allowedOrigins: [...(permissions.origins ?? [])].sort(),
      ai: parseAiSettings(aiItems[AI_SETTINGS_KEY]),
    };
  },

  subscribe(onChange) {
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (Object.keys(changes).some((key) => WATCHED_KEYS.has(key))) onChange();
    };
    chrome.storage.onChanged.addListener(onStorage);
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    return () => {
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  },

  async send(command) {
    try {
      const response = await chrome.runtime.sendMessage<Command, CommandResponse | undefined>(command);
      return response ?? fail('INTERNAL', 'Le service worker n’a pas répondu.');
    } catch (error) {
      return fail('INTERNAL', `Service worker injoignable : ${errorMessage(error)}`);
    }
  },

  requestOrigin: (pattern) => chrome.permissions.request({ origins: [pattern] }),

  saveAiSettings: (settings) => chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings }),

  async backendStatus(settings) {
    const response = await backendFetch(settings, '/v1/status');
    if (!response.ok) return response;
    const body = response.value;
    if (!isRecord(body) || typeof body.provider !== 'string') return fail('RECOVERY_UNAVAILABLE', 'Réponse inattendue du service.');
    return {
      ok: true,
      value: {
        provider: body.provider,
        model: typeof body.model === 'string' ? body.model : null,
        local: body.local !== false,
        llmEnabled: body.llmEnabled === true,
      },
    };
  },

  async listMemory(settings) {
    const response = await backendFetch(settings, '/v1/memory');
    if (!response.ok) return response;
    if (!Array.isArray(response.value)) return fail('RECOVERY_UNAVAILABLE', 'Réponse inattendue du service.');
    return {
      ok: true,
      value: (response.value as unknown[]).filter(isRecord).map((entry) => ({
        id: Number(entry.id),
        original: label(entry.original),
        corrected: label(entry.corrected),
        uses: Number(entry.uses) || 0,
        strategy: String(entry.strategy),
      })),
    };
  },

  async forgetMemory(settings, id) {
    const response = await backendFetch(settings, id === 'all' ? '/v1/memory' : `/v1/memory/${id}`, { method: 'DELETE' });
    return response.ok ? ok(undefined) : response;
  },
  removeOrigin: (pattern) => chrome.permissions.remove({ origins: [pattern] }),
};
