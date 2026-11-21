/**
 * Content script FlowPilot, injecté à la demande par `chrome.scripting` dans
 * la frame principale d'un onglet dont le site est autorisé (jamais déclaré
 * dans le manifest).
 *
 * Rôles : répondre au handshake, capturer les interactions pendant un
 * enregistrement, exécuter les étapes d'un replay.
 *
 * L'idempotence est assurée côté service worker (`connectContent` ne réinjecte
 * que si personne ne répond au ping) : aucun drapeau global ici, ce qui évite
 * qu'un script orphelin d'une version précédente de l'extension bloque le nouveau.
 *
 * Règle de sécurité : le contenu de la page est une donnée non fiable. Ce
 * script n'exécute jamais de code reçu et n'accepte que les messages de sa
 * propre extension.
 */
import {
  PROTOCOL_VERSION,
  fail,
  isContentRequest,
  ok,
  isElementStep,
  parseWorkflowStep,
  type ContentEventMessage,
  type ContentHello,
  type ContentPong,
  type PerformResponse,
  type RecordAck,
  type PageEvent,
} from '@flowpilot/shared';
import { performStep } from '../executor/perform';
import { InteractionCapture } from '../recorder/capture';

const capture = new InteractionCapture(document, (event: PageEvent) => {
  const message: ContentEventMessage = { type: 'recorder/event', event };
  chrome.runtime.sendMessage(message).catch(() => {
    // Extension rechargée ou service worker indisponible : ce script est orphelin.
    capture.stop();
  });
});

type Reply = ContentPong | RecordAck | PerformResponse;

/** Action de replay en cours (attente d'un élément), annulable par `content/cancel`. */
let currentAction: AbortController | null = null;

// Injecté au chargement d'une page pendant un enregistrement : le service worker
// indique si cet onglet est celui qu'on enregistre (les autres onglets du site restent inertes).
const hello: ContentHello = { type: 'content/hello' };
chrome.runtime.sendMessage(hello).then(
  (reply: unknown) => {
    if (typeof reply === 'object' && reply !== null && (reply as { recording?: unknown }).recording === true) capture.start();
  },
  () => undefined,
);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: Reply) => void) => {
  if (sender.id !== chrome.runtime.id || !isContentRequest(message)) return false;
  switch (message.type) {
    case 'content/ping':
      sendResponse({ type: 'content/pong', protocolVersion: PROTOCOL_VERSION, url: location.href, recording: capture.active });
      return false;
    case 'content/record':
      if (message.recording) {
        capture.start();
        sendResponse({ type: 'content/record-ack', flushed: [] });
      } else {
        sendResponse({ type: 'content/record-ack', flushed: capture.stop() });
      }
      return false;
    case 'content/perform': {
      // L'étape est revalidée : ne jamais faire confiance à la forme d'un message.
      const step = parseWorkflowStep(message.step, 0);
      if (!step.ok || !isElementStep(step.value)) {
        sendResponse(fail('INVALID_WORKFLOW', 'Étape invalide reçue par la page.'));
        return false;
      }
      currentAction?.abort();
      const action = new AbortController();
      currentAction = action;
      let replied = false;
      const reply = (response: PerformResponse) => {
        if (replied) return;
        replied = true;
        sendResponse(response);
      };
      performStep(step.value, {
        timeoutMs: message.timeoutMs,
        confirmed: message.confirmed,
        signal: action.signal,
        // Un clic ou une soumission peut décharger la page : on répond avant d'agir.
        beforeLeavingAction: (strategy) => reply(ok({ strategy })),
      }).then(reply, (error: unknown) => {
        reply(fail('INTERNAL', error instanceof Error ? error.message : String(error)));
      });
      return true;
    }
    case 'content/cancel':
      currentAction?.abort();
      return false;
  }
});
