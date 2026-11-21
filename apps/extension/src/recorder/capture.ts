import { LIMITS, type RecordedEvent } from '@flowpilot/shared';
import { describeElement, normalizeText } from '../grounding/dom';
import { isIgnoredField, isIrreversibleAction, isSensitiveField } from './classify';

/**
 * Capture des interactions dans la page (content script).
 *
 * - Seuls les événements `isTrusted` (gestes réels) sont retenus : un script
 *   de la page ne peut pas fabriquer d'étapes.
 * - Clics : ramenés à l'élément interactif le plus proche. Les clics de mise au
 *   focus d'un champ, ou sur une case / son label, sont ignorés (la case est
 *   capturée par `change`).
 * - Saisies : mises en attente pendant la frappe, émises à la validation
 *   (`change`) ou avant toute action qui pourrait quitter la page (clic,
 *   Entrée, soumission). Valeur jamais lue pour un champ sensible.
 * - Soumission : émise seulement sans bouton déclencheur (Entrée sans bouton
 *   d'envoi) ; sinon le clic sur le bouton suffit.
 */

type Emit = (event: RecordedEvent) => void;

/** Vrai pour un geste réel de l'utilisateur. Injectable pour les tests (jsdom ne crée que des événements non fiables). */
export type TrustCheck = (event: Event) => boolean;
const isTrustedEvent: TrustCheck = (event) => event.isTrusted;

const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [onclick], [tabindex]:not([tabindex="-1"])';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);

const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type));

const isToggle = (el: Element): el is HTMLInputElement =>
  el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');

const isEditable = (el: Element): boolean => el instanceof HTMLElement && el.isContentEditable;

export class InteractionCapture {
  /** Champs texte modifiés mais pas encore validés. */
  private pending = new Map<Element, number>();
  private listening = false;

  constructor(
    private readonly doc: Document,
    private readonly emit: Emit,
    private readonly now: () => number = () => Date.now(),
    private readonly trusted: TrustCheck = isTrustedEvent,
  ) {}

  get active(): boolean {
    return this.listening;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.doc.addEventListener('click', this.onClick, true);
    this.doc.addEventListener('input', this.onInput, true);
    this.doc.addEventListener('change', this.onChange, true);
    this.doc.addEventListener('keydown', this.onKeydown, true);
    this.doc.addEventListener('submit', this.onSubmit, true);
  }

  /** Arrête la capture et renvoie les saisies encore en attente. */
  stop(): RecordedEvent[] {
    const flushed: RecordedEvent[] = [];
    this.flush((event) => flushed.push(event));
    this.listening = false;
    this.doc.removeEventListener('click', this.onClick, true);
    this.doc.removeEventListener('input', this.onInput, true);
    this.doc.removeEventListener('change', this.onChange, true);
    this.doc.removeEventListener('keydown', this.onKeydown, true);
    this.doc.removeEventListener('submit', this.onSubmit, true);
    return flushed;
  }

  /** Émet les saisies en attente (avant une action qui peut changer de page). */
  flush(emit: Emit = this.emit): void {
    for (const [el, at] of this.pending) {
      const event = this.fieldEvent(el, at);
      if (event) emit(event);
    }
    this.pending.clear();
  }

  private readonly onClick = (event: MouseEvent) => {
    if (!this.trusted(event) || !(event.target instanceof Element)) return;
    // Clic hors élément interactif (texte, fond de page) : bruit, sans effet à rejouer.
    const el = event.target.closest(INTERACTIVE);
    if (!el) return;
    // Focus d'un champ, ouverture d'une liste, case à cocher et son label : capturés par input/change.
    if (isTextField(el) || el instanceof HTMLSelectElement || isToggle(el) || isEditable(el)) return;
    if (el instanceof HTMLLabelElement && el.control && !(el.control instanceof HTMLButtonElement)) return;
    if (el instanceof HTMLOptionElement) return;
    this.flush();
    this.emit({
      kind: 'click',
      at: this.now(),
      target: describeElement(el),
      ...(isIrreversibleAction(el) ? { confirm: true as const } : {}),
    });
  };

  private readonly onInput = (event: Event) => {
    if (!this.trusted(event) || !(event.target instanceof Element)) return;
    const el = event.target;
    if (isTextField(el) && !isIgnoredField(el)) this.pending.set(el, this.now());
  };

  private readonly onChange = (event: Event) => {
    if (!this.trusted(event) || !(event.target instanceof Element)) return;
    const el = event.target;
    if (isIgnoredField(el)) return;
    if (isTextField(el)) {
      this.pending.delete(el);
      const fieldEvent = this.fieldEvent(el, this.now());
      if (fieldEvent) this.emit(fieldEvent);
    } else if (el instanceof HTMLSelectElement && !el.multiple) {
      const option = el.selectedOptions[0];
      this.emit({
        kind: 'select',
        at: this.now(),
        target: describeElement(el),
        value: el.value.slice(0, LIMITS.value),
        ...(option ? { label: normalizeText(option.textContent) } : {}),
      });
    } else if (isToggle(el)) {
      this.emit({ kind: 'check', at: this.now(), target: describeElement(el), checked: el.checked });
    }
  };

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (this.trusted(event) && event.key === 'Enter') this.flush();
  };

  private readonly onSubmit = (event: SubmitEvent) => {
    if (!this.trusted(event) || !(event.target instanceof HTMLFormElement)) return;
    this.flush();
    // Un bouton a déclenché l'envoi (clic, ou Entrée qui clique le bouton par défaut) : déjà capturé.
    if (event.submitter) return;
    const form = event.target;
    this.emit({
      kind: 'submit',
      at: this.now(),
      target: describeElement(form),
      ...(isIrreversibleAction(form) ? { confirm: true as const } : {}),
    });
  };

  /** Événement d'un champ texte : valeur réelle, ou saisie manuelle si le champ est sensible. */
  private fieldEvent(el: Element, at: number): RecordedEvent | null {
    if (!isTextField(el) || !el.isConnected) return null;
    const target = describeElement(el);
    if (isSensitiveField(el)) return { kind: 'manualInput', at, target };
    return { kind: 'input', at, target, value: el.value.slice(0, LIMITS.value) };
  }
}
