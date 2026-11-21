import {
  fail as err,
  failedRun,
  isSupportedUrl,
  ok,
  originOf,
  transition,
  workflowFromDraft,
  type Command,
  type CommandResponse,
  type ContentPong,
  type ElementStep,
  type RecordedEvent,
  type Result,
  type RunSummary,
  type SessionEvent,
  type SessionState,
  type SessionStatus,
  type Workflow,
} from '@flowpilot/shared';
import { runWorkflow } from '../executor/executor';
import { appendEvents, createDraft, defaultWorkflowName } from '../recorder/recorder';
import type { RunStore } from '../storage/run-store';
import type { SessionStore } from '../storage/session-store';
import type { WorkflowStore } from '../storage/workflow-store';

/** Effets navigateur dont le contrôleur a besoin. Implémenté par `chrome-env.ts`. */
export interface BrowserEnv {
  /** Onglet actif de la dernière fenêtre utilisée. `url` est absente sans permission sur son site. */
  getActiveTab(): Promise<{ id: number; url: string | undefined } | null>;
  hasOriginAccess(url: string): Promise<boolean>;
  /** Vérifie que le content script répond, en l'injectant s'il est absent. */
  connectContent(tabId: number): Promise<Result<ContentPong>>;
  /**
   * Pendant un enregistrement, fait injecter le content script dès le chargement de
   * chaque page du site (`document_end`), sans attendre la fin du chargement complet.
   */
  armRecorder(origin: string): Promise<void>;
  disarmRecorder(): Promise<void>;
  /** Active ou coupe la capture dans la page ; à l'arrêt, renvoie les saisies encore en attente. */
  setCapture(tabId: number, recording: boolean): Promise<Result<RecordedEvent[]>>;
  /** Navigue, attend la fin du chargement, puis reconnecte le content script. */
  navigate(tabId: number, url: string, signal: AbortSignal): Promise<Result<void>>;
  /** Attend que l'onglet atteigne `url`, puis reconnecte le content script. */
  waitForNavigation(tabId: number, url: string, signal: AbortSignal): Promise<Result<void>>;
  /** Exécute une étape sur un élément de la page (grounding + action + vérification). */
  perform(tabId: number, step: ElementStep, signal: AbortSignal): Promise<Result<{ strategy: string }>>;
  setIndicator(status: SessionStatus): Promise<void>;
}

export interface ControllerDeps {
  env: BrowserEnv;
  sessions: SessionStore;
  workflows: WorkflowStore;
  runs: RunStore;
  now: () => number;
  newId: () => string;
}

interface ActiveRun {
  tabId: number;
  abort: AbortController;
  done: Promise<void>;
  /** Intervention humaine attendue sur une étape. */
  human?: { stepIndex: number; resolve: (proceed: boolean) => void } | undefined;
}

/**
 * Seul point d'écriture de la session. Les commandes et événements sont
 * sérialisés (un double-clic ne peut pas lancer deux enregistrements, deux
 * événements de capture ne s'écrasent pas) et toute transition passe par la
 * machine d'état partagée.
 */
export class SessionController {
  private queue: Promise<unknown> = Promise.resolve();
  private activeRun: ActiveRun | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  handle(command: Command): Promise<CommandResponse> {
    return this.exclusive(async () => {
      switch (command.type) {
        case 'session/get':
          return ok(await this.deps.sessions.getSession());
        case 'record/start':
          return this.startRecording();
        case 'session/stop':
          return this.stop();
        case 'replay/start':
          return this.startReplay(command.workflowId);
        case 'replay/continue':
          return this.continueReplay(command.stepIndex);
        case 'workflow/delete':
          return this.deleteWorkflow(command.workflowId);
      }
    });
  }

  // --- Événements de l'onglet enregistré ------------------------------------

  /** Le content script d'une page qui vient de charger doit-il capturer ? Oui seulement dans l'onglet enregistré. */
  async isRecordingTab(tabId: number): Promise<boolean> {
    const session = await this.deps.sessions.getSession();
    return session.status === 'recording' && session.tabId === tabId;
  }

  /** Interactions capturées par le content script de `tabId`. Ignorées hors de l'onglet enregistré. */
  recordEvents(tabId: number, events: readonly RecordedEvent[]): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.deps.sessions.getSession();
      if (session.status !== 'recording' || session.tabId !== tabId) return;
      await this.appendToDraft(events);
    });
  }

  /** Changement d'URL de l'onglet (chargement complet ou navigation SPA). */
  recordNavigation(tabId: number, url: string): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.deps.sessions.getSession();
      if (session.status !== 'recording' || session.tabId !== tabId || !isSupportedUrl(url)) return;
      await this.appendToDraft([{ kind: 'navigation', at: this.deps.now(), url }]);
    });
  }

  /** Page chargée dans l'onglet enregistré : le content script a disparu, on le réinjecte et on relance la capture. */
  onTabLoaded(tabId: number, url: string | undefined): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.deps.sessions.getSession();
      if (session.status !== 'recording' || session.tabId !== tabId) return;
      if (url === undefined || !(await this.deps.env.hasOriginAccess(url))) return;
      const connected = await this.deps.env.connectContent(tabId);
      if (connected.ok && !connected.value.recording) await this.deps.env.setCapture(tabId, true);
    });
  }

  /** Onglet fermé : un enregistrement est sauvegardé tel quel, un replay est interrompu. */
  onTabRemoved(tabId: number): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.deps.sessions.getSession();
      if (session.status === 'recording' && session.tabId === tabId) {
        await this.saveDraft();
        await this.applyEvent(session, { type: 'STOPPED' });
      } else if (session.status === 'replaying' && session.tabId === tabId) {
        this.activeRun?.abort.abort();
      }
    });
  }

  /**
   * À appeler au démarrage du service worker. Un replay ne survit pas à un
   * redémarrage (sa boucle vivait en mémoire) : il est marqué en échec.
   * Un enregistrement, lui, reprend tel quel (brouillon et capture persistent).
   */
  recover(): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.deps.sessions.getSession();
      if (session.status !== 'replaying') {
        // Nettoie un enregistrement dynamique laissé par un arrêt brutal.
        if (session.status === 'idle') await this.deps.env.disarmRecorder();
        await this.deps.env.setIndicator(session.status);
        return;
      }
      const workflow = await this.deps.workflows.get(session.workflowId);
      const base = {
        workflowId: session.workflowId,
        startedAt: session.startedAt,
        finishedAt: this.deps.now(),
        totalSteps: workflow?.steps.length ?? session.stepIndex,
        log: [],
      };
      await this.deps.runs.append(
        failedRun(base, session.stepIndex, 'INTERNAL', 'Exécution interrompue : le service worker de l’extension a redémarré.'),
      );
      await this.applyEvent(session, { type: 'STOPPED' });
    });
  }

  /** Attend la fin du replay en cours (tests et arrêt propre). */
  async settled(): Promise<void> {
    await this.activeRun?.done;
    await this.queue;
  }

  // --- Enregistrement ---------------------------------------------------------

  private async startRecording(): Promise<Result<SessionState>> {
    const { env, sessions, now, newId } = this.deps;
    const session = await sessions.getSession();
    const idle = requireIdle(session, 'enregistrer');
    if (!idle.ok) return idle;

    const tab = await env.getActiveTab();
    if (!tab) return err('NO_ACTIVE_TAB', 'Aucun onglet actif à enregistrer.');
    if (tab.url === undefined) {
      return err(
        'ORIGIN_NOT_ALLOWED',
        'FlowPilot n’a pas accès à cet onglet. Autorisez son site dans « Sites autorisés » (les pages internes de Chrome ne sont jamais accessibles).',
      );
    }
    const origin = originOf(tab.url);
    if (origin === null) {
      return err('UNSUPPORTED_PAGE', 'Cette page ne peut pas être enregistrée (seuls les sites http et https sont pris en charge).');
    }
    if (!(await env.hasOriginAccess(tab.url))) {
      return err('ORIGIN_NOT_ALLOWED', `Autorisez ${origin} dans « Sites autorisés » avant d’enregistrer.`);
    }

    const connected = await env.connectContent(tab.id);
    if (!connected.ok) return connected;
    const capturing = await env.setCapture(tab.id, true);
    if (!capturing.ok) return capturing;
    await env.armRecorder(origin);

    const startedAt = now();
    const draft = createDraft({ workflowId: newId(), origin, startUrl: tab.url, startedAt });
    await sessions.setDraft(draft);
    return this.applyEvent(session, { type: 'RECORD_STARTED', tabId: tab.id, origin, workflowId: draft.workflowId, startedAt });
  }

  private async appendToDraft(events: Parameters<typeof appendEvents>[1]): Promise<void> {
    const draft = await this.deps.sessions.getDraft();
    if (!draft) return;
    await this.deps.sessions.setDraft(appendEvents(draft, events, this.deps.now()));
  }

  /** Compile le brouillon en workflow et le sauvegarde (s'il contient plus que la page de départ ou rien). */
  private async saveDraft(): Promise<void> {
    await this.deps.env.disarmRecorder();
    const draft = await this.deps.sessions.getDraft();
    if (draft) await this.deps.workflows.save(workflowFromDraft(draft, defaultWorkflowName(draft.origin)));
    await this.deps.sessions.clearDraft();
  }

  private async stop(): Promise<Result<SessionState>> {
    const { env, sessions } = this.deps;
    const session = await sessions.getSession();
    if (session.status === 'recording') {
      // Saisies tapées mais pas encore validées : récupérées avant de couper la capture.
      const flushed = await env.setCapture(session.tabId, false);
      if (flushed.ok) await this.appendToDraft(flushed.value);
      await this.saveDraft();
    } else if (session.status === 'replaying') {
      // La boucle s'arrête au prochain contrôle du signal et enregistre un run « aborted ».
      this.activeRun?.abort.abort();
    }
    return this.applyEvent(session, { type: 'STOPPED' });
  }

  // --- Replay -----------------------------------------------------------------

  private async startReplay(workflowId: string): Promise<Result<SessionState>> {
    const { env, sessions, workflows, now } = this.deps;
    const session = await sessions.getSession();
    const idle = requireIdle(session, 'rejouer');
    if (!idle.ok) return idle;

    const workflow = await workflows.get(workflowId);
    if (!workflow) return err('WORKFLOW_NOT_FOUND', 'Workflow introuvable (supprimé ou illisible).');
    if (!(await env.hasOriginAccess(workflow.origin))) {
      return err('ORIGIN_NOT_ALLOWED', `Autorisez ${workflow.origin} dans « Sites autorisés » avant de rejouer.`);
    }
    const tab = await env.getActiveTab();
    if (!tab) return err('NO_ACTIVE_TAB', 'Aucun onglet actif pour rejouer le workflow.');

    const next = await this.applyEvent(session, { type: 'REPLAY_STARTED', tabId: tab.id, workflowId, startedAt: now() });
    if (next.ok) this.launchRun(workflow, tab.id);
    return next;
  }

  private launchRun(workflow: Workflow, tabId: number): void {
    const { env } = this.deps;
    const run: ActiveRun = { tabId, abort: new AbortController(), done: Promise.resolve() };
    this.activeRun = run;

    // runWorkflow ne rejette pas (toute exception devient un échec d'étape) ;
    // le catch final ne protège que l'écriture du résultat.
    run.done = runWorkflow(
      workflow,
      {
        navigate: (url, signal) => env.navigate(tabId, url, signal),
        waitForNavigation: (url, signal) => env.waitForNavigation(tabId, url, signal),
        perform: (step, signal) => env.perform(tabId, step, signal),
        requestHuman: (stepIndex, signal) => this.requestHuman(run, stepIndex, signal),
      },
      {
        signal: run.abort.signal,
        now: this.deps.now,
        onStepStart: (stepIndex) => this.updateRun(run, { type: 'STEP_STARTED', stepIndex }),
      },
    )
      .then((summary) => this.finishRun(run, summary))
      .catch((error: unknown) => {
        console.error('[FlowPilot] fin de replay', error);
      });
  }

  /** Suspend le run jusqu'à `replay/continue` (ou l'arrêt) ; la session signale l'attente au Side Panel. */
  private requestHuman(run: ActiveRun, stepIndex: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const settle = (proceed: boolean) => {
        signal.removeEventListener('abort', onAbort);
        run.human = undefined;
        resolve(proceed);
      };
      const onAbort = () => settle(false);
      signal.addEventListener('abort', onAbort, { once: true });
      run.human = { stepIndex, resolve: settle };
      void this.updateRun(run, { type: 'HUMAN_REQUESTED', stepIndex });
    });
  }

  private async continueReplay(stepIndex: number): Promise<Result<SessionState>> {
    const session = await this.deps.sessions.getSession();
    const human = this.activeRun?.human;
    if (session.status !== 'replaying' || !session.awaitingHuman || !human || human.stepIndex !== stepIndex) {
      return err('INVALID_TRANSITION', 'Aucune étape n’attend de confirmation.');
    }
    const next = await this.applyEvent(session, { type: 'HUMAN_RESOLVED' });
    if (next.ok) human.resolve(true);
    return next;
  }

  private updateRun(run: ActiveRun, event: SessionEvent): Promise<void> {
    return this.exclusive(async () => {
      if (this.activeRun === run) await this.applyEvent(await this.deps.sessions.getSession(), event);
    });
  }

  private finishRun(run: ActiveRun, summary: RunSummary): Promise<void> {
    return this.exclusive(async () => {
      if (this.activeRun !== run) return;
      this.activeRun = null;
      await this.deps.runs.append(summary);
      // Après un clic sur Arrêter, la session est déjà idle : la transition est refusée, sans effet.
      await this.applyEvent(await this.deps.sessions.getSession(), { type: 'REPLAY_FINISHED' });
    });
  }

  private async deleteWorkflow(workflowId: string): Promise<Result<SessionState>> {
    const session = await this.deps.sessions.getSession();
    if (session.status === 'replaying' && session.workflowId === workflowId) {
      return err('INVALID_TRANSITION', 'Impossible de supprimer le workflow en cours de lecture.');
    }
    const removed = await this.deps.workflows.remove(workflowId);
    if (!removed) return err('WORKFLOW_NOT_FOUND', 'Workflow introuvable.');
    await this.deps.runs.removeFor(workflowId);
    return ok(session);
  }

  /** Applique une transition et, si elle est valide, persiste l'état et met à jour le badge. */
  private async applyEvent(session: SessionState, event: SessionEvent): Promise<Result<SessionState>> {
    const next = transition(session, event);
    if (!next.ok) return next;
    await this.deps.sessions.setSession(next.value);
    if (next.value.status !== session.status) await this.deps.env.setIndicator(next.value.status);
    return next;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function requireIdle(session: SessionState, action: string): Result<SessionState> {
  if (session.status === 'idle') return ok(session);
  return err('INVALID_TRANSITION', `Impossible de ${action} : une session est déjà en cours (${session.status}).`);
}
