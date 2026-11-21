import { isRunSummary, parseSession, parseWorkflow, type RunSummary, type SessionState, type Workflow } from '@flowpilot/shared';
import type { KeyValueArea } from './area';
import { SESSION_KEYS } from './keys';

/** État volatil de la session (zone `chrome.storage.session`). */
export class SessionStore {
  constructor(private readonly area: KeyValueArea) {}

  async getSession(): Promise<SessionState> {
    return parseSession(await this.area.get(SESSION_KEYS.session));
  }

  setSession(session: SessionState): Promise<void> {
    return this.area.set(SESSION_KEYS.session, session);
  }

  /** Workflow en cours d'enregistrement, `null` s'il est absent ou illisible. */
  async getDraft(): Promise<Workflow | null> {
    const result = parseWorkflow(await this.area.get(SESSION_KEYS.draft));
    return result.ok ? result.value : null;
  }

  setDraft(draft: Workflow): Promise<void> {
    return this.area.set(SESSION_KEYS.draft, draft);
  }

  clearDraft(): Promise<void> {
    return this.area.remove(SESSION_KEYS.draft);
  }

  async getLastRun(): Promise<RunSummary | null> {
    const raw = await this.area.get(SESSION_KEYS.lastRun);
    return isRunSummary(raw) ? raw : null;
  }

  setLastRun(run: RunSummary): Promise<void> {
    return this.area.set(SESSION_KEYS.lastRun, run);
  }
}
