import { accessibleName } from '../grounding/dom';

/**
 * Classement des éléments au moment de la capture, dans le content script,
 * avant tout envoi : la valeur d'un champ sensible ne quitte jamais la page.
 */

const SENSITIVE_AUTOCOMPLETE = /\b(cc-[a-z-]+|current-password|new-password|one-time-code|transaction-amount)\b/i;
const SENSITIVE_NAME =
  /(pass(word|wd)?|mot[\s_-]*de[\s_-]*passe|\bmdp\b|\bpwd\b|\bpin\b|cvv|cvc|cryptogramme|card[\s_-]*(number|num|no)|num(é|e)ro[\s_-]*de[\s_-]*carte|\biban\b|\bbic\b|\bssn\b|s(é|e)curit(é|e)[\s_-]*sociale|secret|token|\botp\b|code[\s_-]*(de[\s_-]*)?(v(é|e)rification|confirmation|sms))/i;

/** Marquage explicite par le site ou l'utilisateur : tout le sous-arbre est sensible. */
export const SENSITIVE_MARKER = '[data-flowpilot-sensitive], [data-private], [data-sensitive]';

/** Champ dont la valeur ne doit jamais être enregistrée. */
export function isSensitiveField(el: Element): boolean {
  if (el.closest(SENSITIVE_MARKER)) return true;
  if (el instanceof HTMLInputElement && el.type === 'password') return true;
  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (SENSITIVE_AUTOCOMPLETE.test(autocomplete)) return true;
  const hints = [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    accessibleName(el),
  ]
    .filter(Boolean)
    .join(' ');
  return SENSITIVE_NAME.test(hints);
}

/** Champs jamais capturés : cachés, fichiers (contenu local), couleurs/plages sans intérêt pour le replay. */
export function isIgnoredField(el: Element): boolean {
  return el instanceof HTMLInputElement && ['hidden', 'file'].includes(el.type);
}

/**
 * Racines de verbes (toutes conjugaisons : « Confirmez », « Je confirme »,
 * « Payez maintenant », « Submit application »...). Une confirmation de trop
 * coûte peu ; une action irréversible rejouée sans accord coûte cher.
 */
const IRREVERSIBLE =
  /(^|[^\p{L}])(envo[iy]|pa[yi]|paiement|achat|achet|command|supprim|effac|publi|postul|confirm|souscri|r[ée]serv|virement|transf[ée]r|valid|soum[ei]|d[ée]pos|r[ée]sili|annul|delete|remov|purchas|buy|order|send|submit|publish|apply|checkout|subscri|transfer|cancel|book)/iu;

/**
 * Action potentiellement irréversible (envoi, paiement, suppression, publication) :
 * le replay demandera une confirmation humaine avant de l'exécuter.
 * Heuristique volontairement large : une confirmation de trop coûte peu.
 */
export function isIrreversibleAction(el: Element): boolean {
  const form = el instanceof HTMLFormElement ? el : el.closest('form');
  const labels = [accessibleName(el), el.getAttribute('value'), el.getAttribute('title')];
  if (form && el instanceof HTMLFormElement) {
    // Soumission par Entrée : on juge le formulaire à son bouton d'envoi.
    const submitter = form.querySelector('button:not([type]), button[type="submit"], input[type="submit"]');
    if (submitter) labels.push(accessibleName(submitter));
  }
  return labels.some((text) => text && IRREVERSIBLE.test(text));
}
