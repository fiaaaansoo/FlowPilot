/**
 * Service worker FlowPilot (Manifest V3). Point d'entrée unique : branche les
 * écouteurs Chrome sur le `SessionController`. Aucune logique métier ici.
 *
 * Les écouteurs sont enregistrés de façon synchrone au chargement du script,
 * condition pour que Chrome réveille le worker sur ces événements.
 */
import { fail, isCommand, type CommandResponse } from '@flowpilot/shared';
import { chromeArea } from '../storage/area';
import { SessionStore } from '../storage/session-store';
import { WorkflowStore } from '../storage/workflow-store';
import { chromeEnv } from './chrome-env';
import { SessionController } from './controller';

const controller = new SessionController({
  env: chromeEnv,
  sessions: new SessionStore(chromeArea(chrome.storage.session)),
  workflows: new WorkflowStore(chromeArea(chrome.storage.local)),
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
});

// Le clic sur l'icône ouvre le Side Panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
  console.error('[FlowPilot] setPanelBehavior', error);
});

void controller.recover();

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: CommandResponse) => void) => {
  // Commandes acceptées uniquement depuis les pages de l'extension (Side Panel),
  // jamais depuis un content script (son `sender.url` est celle du site).
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

function isFromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')) === true;
}
