import { fail, ok, type ElementStep, type PerformResponse } from '@flowpilot/shared';
import { isDisabled } from '../grounding/dom';
import { waitForTarget } from '../grounding/resolve';

/**
 * Exécution d'une étape dans la page (content script). Seules des actions
 * DOM prédéfinies existent ici : aucun code reçu n'est jamais évalué.
 *
 * Les valeurs sont posées via les setters natifs puis signalées par des
 * événements `input`/`change`, ce que les frameworks (React, Vue...) observent.
 */
export async function performStep(step: ElementStep, timeoutMs: number, doc: Document = document): Promise<PerformResponse> {
  const resolved = await waitForTarget(step.target, timeoutMs, doc);
  if (!resolved.ok) return resolved;
  const { element: el, strategy } = resolved.value;

  if (step.kind !== 'manualInput' && isDisabled(el)) {
    return fail('TARGET_NOT_INTERACTABLE', 'La cible est désactivée.');
  }
  if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', inline: 'nearest' });

  const done = ok({ strategy });
  switch (step.kind) {
    case 'click':
      if (!(el instanceof HTMLElement)) return fail('TARGET_NOT_INTERACTABLE', 'La cible ne peut pas être cliquée.');
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
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
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

    case 'submit': {
      const form = el instanceof HTMLFormElement ? el : el.closest('form');
      if (!form) return fail('TARGET_NOT_INTERACTABLE', 'Aucun formulaire à valider.');
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
