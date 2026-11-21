import {
  PROTOCOL_VERSION,
  errorMessage,
  fail,
  isContentPong,
  ok,
  originOf,
  originPatternFor,
  type ContentPong,
  type ContentRequest,
  type Result,
  type SessionStatus,
} from '@flowpilot/shared';
import type { BrowserEnv } from './controller';

/** Délai max d'un chargement de page pendant un replay. */
const NAVIGATION_TIMEOUT_MS = 15_000;
const CONTENT_SCRIPT_FILE = 'content.js';
const ABORTED_MESSAGE = 'Exécution arrêtée.';

const INDICATOR: Record<SessionStatus, { text: string; color: string }> = {
  idle: { text: '', color: '#000000' },
  recording: { text: 'REC', color: '#c62828' },
  replaying: { text: '▶', color: '#1565c0' },
};

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
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } catch (error) {
      return fail('INJECTION_FAILED', `Impossible d’accéder à la page : ${errorMessage(error)}`);
    }
    return ping(tabId);
  },

  async navigate(tabId, url, signal) {
    if (signal.aborted) return fail('NAVIGATION_FAILED', ABORTED_MESSAGE);

    const load = waitForLoad(tabId, signal);
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (error) {
      load.cancel();
      return fail('NAVIGATION_FAILED', `Navigation vers ${url} impossible : ${errorMessage(error)}`);
    }
    const loaded = await load.done;
    if (!loaded.ok) return loaded;

    const connected = await chromeEnv.connectContent(tabId);
    if (!connected.ok) return connected;
    // Le content script doit répondre depuis la page visée, pas depuis un document précédent.
    if (originOf(connected.value.url) !== originOf(url)) {
      return fail('NAVIGATION_FAILED', `La page chargée (${connected.value.url}) ne correspond pas à ${url}.`);
    }
    return ok(undefined);
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
 * Attend la fin du chargement déclenché par la navigation. À enregistrer
 * **avant** `tabs.update` ; un `complete` n'est accepté qu'après un `loading`,
 * pour ignorer la fin d'un chargement antérieur encore en cours.
 */
function waitForLoad(tabId: number, signal: AbortSignal): { done: Promise<Result<void>>; cancel: () => void } {
  let cancel: () => void = () => undefined;
  const done = new Promise<Result<void>>((resolve) => {
    let sawLoading = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      signal.removeEventListener('abort', onAbort);
    };
    const settle = (result: Result<void>) => {
      cleanup();
      resolve(result);
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      else if (info.status === 'complete' && sawLoading) settle(ok(undefined));
    };
    const onRemoved = (id: number) => {
      if (id === tabId) settle(fail('NAVIGATION_FAILED', 'L’onglet a été fermé pendant l’exécution.'));
    };
    const onAbort = () => settle(fail('NAVIGATION_FAILED', ABORTED_MESSAGE));
    const timer = setTimeout(
      () => settle(fail('NAVIGATION_FAILED', `La page n’a pas fini de charger en ${NAVIGATION_TIMEOUT_MS / 1000} s.`)),
      NAVIGATION_TIMEOUT_MS,
    );

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    signal.addEventListener('abort', onAbort, { once: true });
    cancel = cleanup;
  });
  return { done, cancel: () => cancel() };
}
