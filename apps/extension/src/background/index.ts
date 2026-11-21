/**
 * Service worker FlowPilot (Manifest V3). Point d'entrée unique : branche les
 * écouteurs Chrome sur le `SessionController`. Aucune logique métier ici.
 *
 * Les écouteurs sont enregistrés de façon synchrone au chargement du script,
 * condition pour que Chrome réveille le worker sur ces événements (le worker
 * peut être arrêté entre deux interactions d'un enregistrement).
 */
import { RECORDER_PORT, fail, isCommand, isContentHello, parseContentEvent, type CommandResponse, type ContentHelloReply } from '@flowpilot/shared';
import { chromeArea } from '../storage/area';
import { RunStore } from '../storage/run-store';
import { SessionStore } from '../storage/session-store';
import { WorkflowStore } from '../storage/workflow-store';
import { chromeEnv } from './chrome-env';
import { SessionController } from './controller';

const controller = new SessionController({
  env: chromeEnv,
  sessions: new SessionStore(chromeArea(chrome.storage.session)),
  workflows: new WorkflowStore(chromeArea(chrome.storage.local)),
  runs: new RunStore(chromeArea(chrome.storage.local)),
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
});

// Le clic sur l'icône ouvre le Side Panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
  console.error('[FlowPilot] setPanelBehavior', error);
});

void controller.recover();

type Reply = (response: CommandResponse | ContentHelloReply) => void;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: Reply) => {
  // 1. Content scripts : uniquement ceux de cette extension, frame principale.
  //    Le contrôleur ne retient que l'onglet en cours d'enregistrement.
  if (isFromContentScript(sender)) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    if (isContentHello(message)) {
      controller.isRecordingTab(tabId).then(
        (recording) => sendResponse({ recording }),
        () => sendResponse({ recording: false }),
      );
      return true;
    }
    const event = parseContentEvent(message);
    if (event) void controller.recordEvents(tabId, [event]);
    return false;
  }
  // 2. Commandes : uniquement depuis les pages de l'extension (Side Panel).
  if (!isFromExtensionPage(sender)) return false;
  if (!isCommand(message)) {
    sendResponse(fail('UNKNOWN_COMMAND', 'Commande inconnue.'));
    return false;
  }
  controller.handle(message).then(sendResponse, (error: unknown) => {
    console.error('[FlowPilot] commande', message.type, error);
    sendResponse(fail('INTERNAL', 'Erreur interne de l’extension.'));
  });
  return true; // réponse asynchrone
});

// Port of the recorded tab's content script: its heartbeat keeps this worker alive during a
// recording (see `RECORDER_PORT`). It carries no command. Each heartbeat checks that the tab is
// still the recorded one (not at connection: the page starts capturing just before the session
// becomes `recording`); otherwise (a page restored from the back/forward cache after the
// recording ended) it is told to stop and closed, so the worker is not kept alive for nothing.
chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  if (port.name !== RECORDER_PORT || port.sender === undefined || !isFromContentScript(port.sender) || tabId === undefined) {
    port.disconnect();
    return;
  }
  const refuse = () => {
    try {
      port.postMessage({ type: 'stop' });
      port.disconnect();
    } catch {
      // Already disconnected by the page.
    }
  };
  port.onMessage.addListener(() => {
    controller.isRecordingTab(tabId).then((recording) => {
      if (!recording) refuse();
    }, refuse);
  });
});

// Navigations de l'onglet enregistré. `changeInfo.url` n'est fourni que pour
// les sites autorisés (pas de permission `tabs`) ; il couvre aussi les
// changements d'URL des applications SPA (`history.pushState`).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) void controller.recordNavigation(tabId, changeInfo.url, Date.now());
  if (changeInfo.status === 'complete') void controller.onTabLoaded(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void controller.onTabRemoved(tabId);
});

function isFromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')) === true;
}

function isFromContentScript(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab !== undefined && sender.frameId === 0 && !isFromExtensionPage(sender);
}
