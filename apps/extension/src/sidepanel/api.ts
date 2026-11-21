import {
  IDLE,
  errorMessage,
  fail,
  type Command,
  type CommandResponse,
  type RecordingDraft,
  type RunSummary,
  type SessionState,
} from '@flowpilot/shared';
import { chromeArea } from '../storage/area';
import { LOCAL_KEYS, SESSION_KEYS } from '../storage/keys';
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
}

const WATCHED_KEYS = new Set<string>([...Object.values(SESSION_KEYS), ...Object.values(LOCAL_KEYS)]);

export const EMPTY_SNAPSHOT: PanelSnapshot = {
  session: IDLE,
  workflows: { workflows: [], invalidCount: 0 },
  runs: [],
  draft: null,
  allowedOrigins: [],
};

export const chromeApi: ExtensionApi = {
  async snapshot() {
    // Mêmes stores (et donc même validation) que le service worker, en lecture seule.
    const sessions = new SessionStore(chromeArea(chrome.storage.session));
    const workflows = new WorkflowStore(chromeArea(chrome.storage.local));
    const runs = new RunStore(chromeArea(chrome.storage.local));
    const [session, workflowList, runList, draft, permissions] = await Promise.all([
      sessions.getSession(),
      workflows.list(),
      runs.list(),
      sessions.getDraft(),
      chrome.permissions.getAll(),
    ]);
    return {
      session,
      workflows: workflowList,
      runs: runList,
      draft,
      allowedOrigins: [...(permissions.origins ?? [])].sort(),
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
  removeOrigin: (pattern) => chrome.permissions.remove({ origins: [pattern] }),
};
