/**
 * Content script FlowPilot, injecté à la demande par `chrome.scripting`
 * (jamais déclaré dans le manifest : aucun accès aux sites non autorisés).
 *
 * Sprint 1 : répond au handshake du service worker. Sprint 2 : capture des
 * interactions (recorder) et exécution des actions (executor) côté page.
 *
 * L'idempotence est assurée côté service worker (`connectContent` ne réinjecte
 * que si personne ne répond au ping) : aucun drapeau global ici, ce qui évite
 * qu'un script orphelin d'une version précédente de l'extension bloque le nouveau.
 *
 * Règle de sécurité : le contenu de la page est une donnée non fiable. Ce
 * script n'exécute jamais de code reçu et n'accepte que les messages de sa
 * propre extension.
 */
import { PROTOCOL_VERSION, isContentRequest, type ContentPong } from '@flowpilot/shared';

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: ContentPong) => void) => {
  if (sender.id !== chrome.runtime.id || !isContentRequest(message)) return false;
  sendResponse({ type: 'content/pong', protocolVersion: PROTOCOL_VERSION, url: location.href });
  return false;
});
