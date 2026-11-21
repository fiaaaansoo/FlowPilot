import { PROTOCOL_VERSION, ok, originPatternFor, type ContentPong, type Result, type SessionStatus } from '@flowpilot/shared';
import type { BrowserEnv } from '../background/controller';

export interface FakeEnvOptions {
  tab?: { id: number; url: string | undefined } | null;
  allowed?: string[];
}

/** `BrowserEnv` scriptable pour les tests du contrôleur. */
export class FakeEnv implements BrowserEnv {
  tab: { id: number; url: string | undefined } | null;
  allowed: Set<string>;
  indicator: SessionStatus = 'idle';
  connectResult: Result<ContentPong> | null = null;
  navigations: string[] = [];
  /** Remplace le comportement de `navigate` (par défaut : succès immédiat). */
  navigateImpl: (url: string, signal: AbortSignal) => Promise<Result<void>> = () => Promise.resolve(ok(undefined));

  /** `allowed` : motifs de permission, comme `chrome.permissions` (domaine entier, tous ports). */
  constructor({ tab = { id: 7, url: 'http://localhost:5173/' }, allowed = ['http://localhost/*'] }: FakeEnvOptions = {}) {
    this.tab = tab;
    this.allowed = new Set(allowed);
  }

  getActiveTab() {
    return Promise.resolve(this.tab);
  }

  hasOriginAccess(url: string) {
    const pattern = originPatternFor(url);
    return Promise.resolve(pattern !== null && this.allowed.has(pattern));
  }

  connectContent(): Promise<Result<ContentPong>> {
    const pong: ContentPong = { type: 'content/pong', protocolVersion: PROTOCOL_VERSION, url: this.tab?.url ?? '' };
    return Promise.resolve(this.connectResult ?? ok(pong));
  }

  navigate(_tabId: number, url: string, signal: AbortSignal) {
    this.navigations.push(url);
    return this.navigateImpl(url, signal);
  }

  setIndicator(status: SessionStatus) {
    this.indicator = status;
    return Promise.resolve();
  }
}

/** Promesse résolvable de l'extérieur, pour figer une étape en cours. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
