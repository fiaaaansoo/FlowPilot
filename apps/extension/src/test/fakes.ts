import {
  DEFAULT_AI_SETTINGS,
  PROTOCOL_VERSION,
  type AiSettings,
  type Observation,
  ok,
  originPatternFor,
  type ContentPong,
  type ElementStep,
  type ElementTarget,
  type RecordedEvent,
  type Result,
  type SessionStatus,
  type Workflow,
  type WorkflowStep,
} from '@flowpilot/shared';
import type { BrowserEnv } from '../background/controller';

export interface FakeEnvOptions {
  tab?: { id: number; url: string | undefined } | null;
  allowed?: readonly string[];
}

export type EnvCall =
  | { op: 'navigate' | 'waitForNavigation'; url: string }
  | { op: 'perform'; step: ElementStep }
  | { op: 'capture'; tabId: number; recording: boolean };

/** `BrowserEnv` scriptable pour les tests du contrôleur. */
export class FakeEnv implements BrowserEnv {
  tab: { id: number; url: string | undefined } | null;
  allowed: Set<string>;
  indicator: SessionStatus = 'idle';
  connectResult: Result<ContentPong> | null = null;
  /** Le content script de la page capture-t-il déjà ? */
  contentRecording = false;
  /** Saisies en attente renvoyées à l'arrêt de la capture. */
  flushOnStop: RecordedEvent[] = [];
  calls: EnvCall[] = [];
  navigateImpl: (url: string, signal: AbortSignal) => Promise<Result<void>> = () => Promise.resolve(ok(undefined));
  performImpl: (step: ElementStep, signal: AbortSignal) => Promise<Result<{ strategy: string }>> = () =>
    Promise.resolve(ok({ strategy: 'role' }));

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
    const pong: ContentPong = {
      type: 'content/pong',
      protocolVersion: PROTOCOL_VERSION,
      url: this.tab?.url ?? '',
      recording: this.contentRecording,
    };
    return Promise.resolve(this.connectResult ?? ok(pong));
  }

  /** Origine pour laquelle le content script est enregistré dynamiquement, `null` sinon. */
  armedOrigin: string | null = null;

  armRecorder(origin: string) {
    this.armedOrigin = origin;
    return Promise.resolve();
  }

  disarmRecorder() {
    this.armedOrigin = null;
    return Promise.resolve();
  }

  setCapture(tabId: number, recording: boolean): Promise<Result<RecordedEvent[]>> {
    this.calls.push({ op: 'capture', tabId, recording });
    this.contentRecording = recording;
    const flushed = recording ? [] : this.flushOnStop;
    return Promise.resolve(ok(flushed));
  }

  navigate(_tabId: number, url: string, signal: AbortSignal) {
    this.calls.push({ op: 'navigate', url });
    return this.navigateImpl(url, signal);
  }

  waitForNavigation(_tabId: number, url: string, signal: AbortSignal) {
    this.calls.push({ op: 'waitForNavigation', url });
    return this.navigateImpl(url, signal);
  }

  perform(_tabId: number, step: ElementStep, signal: AbortSignal) {
    this.calls.push({ op: 'perform', step });
    return this.performImpl(step, signal);
  }

  /** AI recovery settings returned to the controller (disabled by default, like the real extension). */
  aiSettings: AiSettings = DEFAULT_AI_SETTINGS;
  observation: Observation = { snapshotId: 'snap-1', url: 'http://localhost:5173/', title: 'Démo', elements: [] };
  performRefImpl: (ref: string, confirmed: boolean) => Promise<Result<{ strategy: string }>> = () =>
    Promise.resolve(ok({ strategy: 'ai' }));
  refCalls: { ref: string; confirmed: boolean }[] = [];

  observe(): Promise<Result<Observation>> {
    return Promise.resolve(ok(this.observation));
  }

  performRef(_tabId: number, _step: ElementStep, _snapshotId: string, ref: string, confirmed: boolean) {
    this.refCalls.push({ ref, confirmed });
    return this.performRefImpl(ref, confirmed);
  }

  loadAiSettings() {
    return Promise.resolve(this.aiSettings);
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

export const target = (name: string, extra: Partial<ElementTarget> = {}): ElementTarget => ({
  tag: 'button',
  role: 'button',
  name,
  attributes: {},
  css: `button[data-name="${name}"]`,
  ...extra,
});

export function makeWorkflow(steps: WorkflowStep[], id = 'wf'): Workflow {
  return {
    schemaVersion: 2,
    id,
    name: 'Démo',
    origin: 'http://localhost:5173',
    createdAt: '2026-11-21T10:00:00.000Z',
    steps,
  };
}
