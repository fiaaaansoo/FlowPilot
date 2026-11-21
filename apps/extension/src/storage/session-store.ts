import { parseRecordingDraft, parseSession, type RecordingDraft, type SessionState } from '@flowpilot/shared';
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

  /** Brouillon de l'enregistrement en cours, `null` s'il est absent ou illisible. */
  async getDraft(): Promise<RecordingDraft | null> {
    return parseRecordingDraft(await this.area.get(SESSION_KEYS.draft));
  }

  setDraft(draft: RecordingDraft): Promise<void> {
    return this.area.set(SESSION_KEYS.draft, draft);
  }

  clearDraft(): Promise<void> {
    return this.area.remove(SESSION_KEYS.draft);
  }
}
