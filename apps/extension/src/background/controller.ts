import {
  fail as err,
  failedRun,
  ok,
  originOf,
  transition,
  type Command,
  type CommandResponse,
  type ContentPong,
  type Result,
  type RunSummary,
  type SessionEvent,
  type SessionState,
  type SessionStatus,
  type Workflow,
} from '@flowpilot/shared';
import { runWorkflow } from '../executor/executor';
import { createDraftWorkflow } from '../recorder/recorder';
import type { SessionStore } from '../storage/session-store';
import type { WorkflowStore } from '../storage/workflow-store';

/** Effets navigateur dont le contrôleur a besoin. Implémenté par `chrome-env.ts`. */
export interface BrowserEnv {
  /** Onglet actif de la dernière fenêtre utilisée. `url` est absente sans permission sur son site. */
  getActiveTab(): Promise<{ id: number; url: string | undefined } | null>;
  hasOriginAccess(url: string): Promise<boolean>;
  /** Vérifie que le content script répond, en l'injectant s'il est absent. */
  connectContent(tabId: number): Promise<Result<ContentPong>>;
  /** Navigue, attend la fin du chargement, puis reconnecte le content script. */
  navigate(tabId: number, url: string, signal: AbortSignal): Promise<Result<void>>;
  setIndicator(status: SessionStatus): Promise<void>;
}

export interface ControllerDeps {
  env: BrowserEnv;
  sessions: SessionStore;
  workflows: WorkflowStore;
  now: () => number;
  newId: () => string;
}

interface ActiveRun {
  abort: AbortController;
  done: Promise<void>;
}

/**
 * Seul point d'écriture de la session. Les commandes sont sérialisées
 * (un double-clic ne peut pas lancer deux enregistrements) et toute transition
 * passe par la machine d'état partagée.
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
        case 'workflow/delete':
          return this.deleteWorkflow(command.workflowId);
      }
    });
  }

  /**
   * À appeler au démarrage du service worker. Un replay ne survit pas à un
   * redémarrage (sa boucle vivait en mémoire) : il est marqué en échec.
   * Un enregistrement, lui, reprend tel quel.
   */
  recover(): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.deps.sessions.getSession();
      if (session.status !== 'replaying') {
        await this.deps.env.setIndicator(session.status);
        return;
      }
      const workflow = await this.deps.workflows.get(session.workflowId);
      const base = {
        workflowId: session.workflowId,
        startedAt: session.startedAt,
        finishedAt: this.deps.now(),
        totalSteps: workflow?.steps.length ?? session.stepIndex,
      };
      await this.deps.sessions.setLastRun(
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

    const startedAt = now();
    const draft = createDraftWorkflow({ id: newId(), stepId: newId(), origin, startUrl: tab.url, now: new Date(startedAt) });
    await sessions.setDraft(draft);
    return this.applyEvent(session, { type: 'RECORD_STARTED', tabId: tab.id, origin, workflowId: draft.id, startedAt });
  }

  private async stop(): Promise<Result<SessionState>> {
    const { sessions, workflows } = this.deps;
    const session = await sessions.getSession();
    if (session.status === 'recording') {
      const draft = await sessions.getDraft();
      if (draft) await workflows.save(draft);
      await sessions.clearDraft();
    } else if (session.status === 'replaying') {
      // La boucle s'arrête au prochain contrôle du signal et enregistre un run « aborted ».
      this.activeRun?.abort.abort();
    }
    return this.applyEvent(session, { type: 'STOPPED' });
  }

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
    const abort = new AbortController();
    const run: ActiveRun = { abort, done: Promise.resolve() };
    this.activeRun = run;

    // runWorkflow ne rejette pas (toute exception devient un échec d'étape) ;
    // le catch final ne protège que l'écriture du résultat.
    run.done = runWorkflow(
      workflow,
      { navigate: (url, signal) => this.deps.env.navigate(tabId, url, signal) },
      {
        signal: abort.signal,
        now: this.deps.now,
        onStepStart: (stepIndex) => this.updateRun(run, { type: 'STEP_STARTED', stepIndex }),
      },
    )
      .then((summary) => this.finishRun(run, summary))
      .catch((error: unknown) => {
        console.error('[FlowPilot] fin de replay', error);
      });
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
      await this.deps.sessions.setLastRun(summary);
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
