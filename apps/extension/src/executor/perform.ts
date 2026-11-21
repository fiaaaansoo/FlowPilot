import { fail, ok, type ElementStep, type PerformResponse } from '@flowpilot/shared';
import { isDisabled } from '../grounding/dom';
import { resolveRef } from '../grounding/observe';
import { waitForTarget } from '../grounding/resolve';
import { isIrreversibleAction } from '../recorder/classify';

/**
 * Exécution d'une étape dans la page (content script). Seules des actions
 * DOM prédéfinies existent ici : aucun code reçu n'est jamais évalué.
 *
 * Les valeurs sont posées via les setters natifs puis signalées par des
 * événements `input`/`change`, ce que les frameworks (React, Vue...) observent.
 */
export interface PerformOptions {
  timeoutMs: number;
  /** Un humain a validé l'étape (confirmation au replay). */
  confirmed: boolean;
  signal?: AbortSignal;
  /**
   * Appelé juste avant un clic ou une soumission, qui peuvent décharger la page :
   * permet de répondre au service worker avant que le content script disparaisse.
   */
  beforeLeavingAction?: (strategy: string) => void;
  doc?: Document;
}

export async function performStep(step: ElementStep, options: PerformOptions): Promise<PerformResponse> {
  const { timeoutMs, signal, doc = document } = options;
  const resolved = await waitForTarget(step.target, timeoutMs, doc, 100, signal);
  if (!resolved.ok) return resolved;
  if (signal?.aborted) return fail('NAVIGATION_FAILED', 'Exécution arrêtée.');
  return actOn(resolved.value.element, step, resolved.value.strategy, options);
}

/**
 * Executes an AI-recovered step on an element from the latest observation
 * snapshot. The element is revalidated (`resolveRef`) immediately before acting;
 * the action and its value are those of the recorded step, never the model's.
 */
export function performByRef(
  step: ElementStep,
  snapshotId: string,
  ref: string,
  options: Omit<PerformOptions, 'timeoutMs'>,
): PerformResponse {
  if (options.signal?.aborted) return fail('NAVIGATION_FAILED', 'Exécution arrêtée.');
  const resolved = resolveRef(snapshotId, ref, options.doc);
  if (!resolved.ok) return resolved;
  return actOn(resolved.value, step, 'ai', { ...options, timeoutMs: 0 });
}

/** Deterministic action on an already resolved element, with effect verification. */
function actOn(el: Element, step: ElementStep, strategy: string, options: PerformOptions): PerformResponse {
  const { confirmed, beforeLeavingAction } = options;
  if (step.kind !== 'manualInput' && isDisabled(el)) {
    return fail('TARGET_NOT_INTERACTABLE', 'La cible est désactivée.');
  }
  // Défense en profondeur : l'élément effectivement trouvé est rejugé dans la page.
  // Une action qui paraît irréversible n'est jamais exécutée sans validation humaine.
  if ((step.kind === 'click' || step.kind === 'submit' || step.kind === 'press') && !confirmed && isIrreversibleAction(el)) {
    return fail('CONFIRMATION_REQUIRED', 'Cette action semble irréversible : confirmation humaine requise.');
  }
  if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', inline: 'nearest' });

  const done = ok({ strategy });
  switch (step.kind) {
    case 'click':
      if (!(el instanceof HTMLElement)) return fail('TARGET_NOT_INTERACTABLE', 'La cible ne peut pas être cliquée.');
      beforeLeavingAction?.(strategy);
      el.focus({ preventScroll: true });
      el.click();
      return done;

    case 'input': {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return fail('TARGET_NOT_INTERACTABLE', 'La cible n’est pas un champ de saisie.');
      }
      el.focus({ preventScroll: true });
      setNativeValue(el, step.value);
      dispatch(el, 'input');
      dispatch(el, 'change');
      return el.value === step.value ? done : fail('VERIFICATION_FAILED', 'La valeur saisie n’a pas été conservée par la page.');
    }

    case 'manualInput':
      // La valeur vient de l'humain : on vérifie seulement que le champ n'est plus vide.
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return done;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return fail('TARGET_NOT_INTERACTABLE', 'La cible n’est pas un champ de saisie.');
      }
      return el.value !== '' ? done : fail('VERIFICATION_FAILED', 'Le champ sensible est resté vide.');

    case 'select': {
      if (!(el instanceof HTMLSelectElement)) return fail('TARGET_NOT_INTERACTABLE', 'La cible n’est pas une liste.');
      if (!Array.from(el.options).some((option) => option.value === step.value)) {
        return fail('VERIFICATION_FAILED', `L’option « ${step.label ?? step.value} » n’existe plus.`);
      }
      el.focus({ preventScroll: true });
      setNativeValue(el, step.value);
      dispatch(el, 'input');
      dispatch(el, 'change');
      return el.value === step.value ? done : fail('VERIFICATION_FAILED', 'L’option choisie n’a pas été conservée.');
    }

    case 'check': {
      if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio')) {
        return fail('TARGET_NOT_INTERACTABLE', 'La cible n’est pas une case à cocher.');
      }
      // Un clic natif déclenche les mêmes événements qu'un geste réel.
      if (el.checked !== step.checked) el.click();
      return el.checked === step.checked ? done : fail('VERIFICATION_FAILED', 'L’état de la case n’a pas changé.');
    }

    case 'press': {
      // Les gestionnaires JavaScript de la page reçoivent la touche ; aucune action par défaut n'est simulée.
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
      beforeLeavingAction?.(strategy);
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      return done;
    }

    case 'submit': {
      const form = el instanceof HTMLFormElement ? el : el.closest('form');
      if (!form) return fail('TARGET_NOT_INTERACTABLE', 'Aucun formulaire à valider.');
      beforeLeavingAction?.(strategy);
      form.requestSubmit();
      return done;
    }
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  // Setter natif du prototype : contourne un éventuel setter surchargé sur l'instance (frameworks).
  // eslint-disable-next-line @typescript-eslint/unbound-method -- appelé explicitement avec `this = el` ci-dessous.
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function dispatch(el: Element, type: 'input' | 'change'): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}
