import {
  PROTOCOL_VERSION,
  errorMessage,
  fail,
  isContentPong,
  ok,
  originOf,
  originPatternFor,
  parsePerformResponse,
  parseRecordAck,
  type ContentPong,
  type ContentRequest,
  type ElementStep,
  type Result,
  type SessionStatus,
} from '@flowpilot/shared';
import type { BrowserEnv } from './controller';

/** Délai max d'un chargement de page pendant un replay. */
export const NAVIGATION_TIMEOUT_MS = 15_000;
/** Délai max d'apparition d'un élément (contenu chargé en différé). */
export const ELEMENT_TIMEOUT_MS = 10_000;
const POLL_MS = 150;
const CONTENT_SCRIPT_FILE = 'content.js';
const RECORDER_SCRIPT_ID = 'flowpilot-recorder';
const ABORTED_MESSAGE = 'Exécution arrêtée.';

const INDICATOR: Record<SessionStatus, { text: string; color: string }> = {
  idle: { text: '', color: '#000000' },
  recording: { text: 'REC', color: '#c62828' },
  replaying: { text: '▶', color: '#1565c0' },
};

/** URL comparée sous sa forme normalisée. */
const sameUrl = (a: string | undefined, b: string): boolean => {
  if (a === undefined) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Implémentation Chrome de `BrowserEnv`. Toute l'API `chrome.*` du service worker est ici. */
export const chromeEnv: BrowserEnv = {
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return null;
    return { id: tab.id, url: tab.url };
  },

  async hasOriginAccess(url) {
    const pattern = originPatternFor(url);
    if (pattern === null) return false;
    return chrome.permissions.contains({ origins: [pattern] });
  },

  async connectContent(tabId) {
    // Injection idempotente : on n'injecte que si aucun content script vivant ne répond.
    // Un script orphelin (extension rechargée) ne répond plus, il est donc remplacé.
    const alive = await ping(tabId);
    if (alive.ok) return alive;
    try {
      // Frame principale uniquement (valeur par défaut) : pas d'iframes tierces.
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } catch (error) {
      return fail('INJECTION_FAILED', `Impossible d’accéder à la page : ${errorMessage(error)}`);
    }
    return ping(tabId);
  },

  async armRecorder(origin) {
    const pattern = originPatternFor(origin);
    if (pattern === null) return;
    await chromeEnv.disarmRecorder();
    await chrome.scripting.registerContentScripts([
      {
        id: RECORDER_SCRIPT_ID,
        matches: [pattern],
        js: [CONTENT_SCRIPT_FILE],
        runAt: 'document_end',
        allFrames: false,
        persistAcrossSessions: false,
      },
    ]);
  },

  async disarmRecorder() {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [RECORDER_SCRIPT_ID] });
    } catch {
      // Aucun script enregistré : rien à faire.
    }
  },

  async setCapture(tabId, recording) {
    const request: ContentRequest = { type: 'content/record', recording };
    try {
      const ack = parseRecordAck(await chrome.tabs.sendMessage(tabId, request));
      return ack ? ok(ack) : fail('CONTENT_UNREACHABLE', 'Réponse inattendue du content script.');
    } catch (error) {
      return fail('CONTENT_UNREACHABLE', `Le content script ne répond pas : ${errorMessage(error)}`);
    }
  },

  async navigate(tabId, url, signal) {
    if (signal.aborted) return fail('NAVIGATION_FAILED', ABORTED_MESSAGE);
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (error) {
      return fail('NAVIGATION_FAILED', `Navigation vers ${url} impossible : ${errorMessage(error)}`);
    }
    return waitForUrl(tabId, url, signal);
  },

  waitForNavigation: (tabId, url, signal) => waitForUrl(tabId, url, signal),

  async perform(tabId, step, signal) {
    if (signal.aborted) return fail('NAVIGATION_FAILED', ABORTED_MESSAGE);
    const connected = await chromeEnv.connectContent(tabId);
    if (!connected.ok) return connected;
    const request: ContentRequest = { type: 'content/perform', step, timeoutMs: ELEMENT_TIMEOUT_MS };
    const response = chrome.tabs.sendMessage(tabId, request).then(
      (raw: unknown) =>
        parsePerformResponse(raw) ?? fail('CONTENT_UNREACHABLE', 'Réponse inattendue du content script.'),
      (error: unknown) => unreachableAfterAction(step, error),
    );
    return raceAbort(response, signal);
  },

  async setIndicator(status) {
    const { text, color } = INDICATOR[status];
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color });
  },
};

async function ping(tabId: number): Promise<Result<ContentPong>> {
  const request: ContentRequest = { type: 'content/ping' };
  try {
    const response: unknown = await chrome.tabs.sendMessage(tabId, request);
    if (isContentPong(response)) return ok(response);
    return fail('CONTENT_UNREACHABLE', `Réponse inattendue du content script (protocole v${PROTOCOL_VERSION} attendu).`);
  } catch (error) {
    return fail('CONTENT_UNREACHABLE', `Le content script ne répond pas : ${errorMessage(error)}`);
  }
}

/**
 * Un clic ou une soumission peut décharger la page avant que le content script
 * ne réponde : l'action a eu lieu, l'étape suivante (attente de navigation)
 * vérifiera son effet. Pour les autres étapes, c'est un échec.
 */
function unreachableAfterAction(step: ElementStep, error: unknown): Result<{ strategy: string }> {
  const message = errorMessage(error);
  if ((step.kind === 'click' || step.kind === 'submit') && /message port closed|back\/forward cache/i.test(message)) {
    return ok({ strategy: 'unconfirmed' });
  }
  return fail('CONTENT_UNREACHABLE', `La page ne répond plus : ${message}`);
}

function raceAbort<T>(promise: Promise<Result<T>>, signal: AbortSignal): Promise<Result<T>> {
  return new Promise((resolve) => {
    const onAbort = () => resolve(fail('NAVIGATION_FAILED', ABORTED_MESSAGE));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then((result) => {
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    });
  });
}

/**
 * Attend que l'onglet affiche `url` et ait fini de charger, puis que le
 * content script réponde depuis cette page. Interroge l'état de l'onglet
 * plutôt que d'écouter des événements : une navigation déjà terminée (clic
 * rapide, SPA) est vue immédiatement, sans course.
 */
async function waitForUrl(tabId: number, url: string, signal: AbortSignal): Promise<Result<void>> {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  let lastUrl: string | undefined;
  for (;;) {
    if (signal.aborted) return fail('NAVIGATION_FAILED', ABORTED_MESSAGE);
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return fail('NAVIGATION_FAILED', 'L’onglet a été fermé pendant l’exécution.');
    }
    lastUrl = tab.url;
    if (sameUrl(tab.url, url) && tab.status === 'complete') break;
    if (Date.now() >= deadline) {
      return fail(
        'NAVIGATION_FAILED',
        `La page ${url} n’a pas été atteinte en ${NAVIGATION_TIMEOUT_MS / 1000} s (page actuelle : ${lastUrl ?? 'inconnue ou non autorisée'}).`,
      );
    }
    await sleep(POLL_MS);
  }

  const connected = await chromeEnv.connectContent(tabId);
  if (!connected.ok) return connected;
  // Le content script doit répondre depuis la page visée, pas depuis un document précédent.
  if (originOf(connected.value.url) !== originOf(url)) {
    return fail('NAVIGATION_FAILED', `La page chargée (${connected.value.url}) ne correspond pas à ${url}.`);
  }
  return ok(undefined);
}

