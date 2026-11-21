import { LIMITS, type PageEvent, type RecordedEvent } from '@flowpilot/shared';
import { describeElement, normalizeText } from '../grounding/dom';
import { isIgnoredField, isIrreversibleAction, isSensitiveField } from './classify';

/**
 * Capture des interactions dans la page (content script).
 *
 * - Seuls les événements `isTrusted` (gestes réels) sont retenus : un script
 *   de la page ne peut pas fabriquer d'étapes.
 * - Clics : ramenés à l'élément interactif le plus proche, ou à défaut à un
 *   élément affiché comme cliquable (`cursor: pointer`). Les clics de mise au
 *   focus d'un champ, ou sur une case / son label, sont ignorés (la case est
 *   capturée par `change`).
 * - Saisies : mises en attente pendant la frappe, émises à la validation
 *   (`change`) ou avant toute action qui pourrait quitter la page (clic,
 *   Entrée, soumission). Valeur jamais lue pour un champ sensible, liste et
 *   case comprises : l'étape devient une saisie manuelle.
 * - Entrée : soumission de formulaire sans bouton déclencheur (`submit`), ou
 *   touche transmise aux scripts de la page (`press`) si rien n'a été soumis.
 * - Départ de page (`beforeunload`) : signalé, pour relier une navigation lente
 *   à l'interaction qui l'a causée.
 */

type Emit = (event: PageEvent) => void;

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

/**
 * Élément sans sémantique mais affiché comme cliquable (div/span avec gestionnaire JS).
 * `cursor` s'hérite : on remonte jusqu'au plus haut ancêtre qui le porte encore
 * (la carte entière plutôt que le texte cliqué), sur quelques niveaux au plus.
 */
function pointerTarget(el: Element): Element | null {
  const doc = el.ownerDocument;
  const isPointer = (node: Element | null): node is Element =>
    node !== null && node !== doc.body && node !== doc.documentElement && doc.defaultView?.getComputedStyle(node).cursor === 'pointer';
  if (!isPointer(el)) return null;
  let current: Element = el;
  for (let depth = 0; depth < 4 && isPointer(current.parentElement); depth += 1) current = current.parentElement;
  return current;
}

export class InteractionCapture {
  /** Champs texte modifiés mais pas encore validés. */
  private pending = new Map<Element, number>();
  private listening = false;
  /** Horodatage du dernier clic ou de la dernière soumission (pour décider si Entrée a soumis quelque chose). */
  private lastActionAt = Number.NEGATIVE_INFINITY;
  /** Dernier élément cliqué (pour savoir si le bouton d'envoi a déjà été capturé). */
  private lastClicked: Element | null = null;

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
    this.doc.defaultView?.addEventListener('beforeunload', this.onLeave, true);
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
    this.doc.defaultView?.removeEventListener('beforeunload', this.onLeave, true);
    return flushed;
  }

  /** Émet les saisies en attente (avant une action qui peut changer de page). */
  flush(emit: (event: RecordedEvent) => void = this.emit): void {
    for (const [el, at] of this.pending) {
      const event = this.fieldEvent(el, at);
      if (event) emit(event);
    }
    this.pending.clear();
  }

  private readonly onClick = (event: MouseEvent) => {
    if (!this.trusted(event) || !(event.target instanceof Element)) return;
    // Hors élément interactif ou cliquable (texte, fond de page) : bruit, sans effet à rejouer.
    const el = event.target.closest(INTERACTIVE) ?? pointerTarget(event.target);
    if (!el) return;
    // Focus d'un champ, ouverture d'une liste, case à cocher et son label : capturés par input/change.
    if (isTextField(el) || el instanceof HTMLSelectElement || isToggle(el) || isEditable(el)) return;
    if (el instanceof HTMLLabelElement && el.control && !(el.control instanceof HTMLButtonElement)) return;
    if (el instanceof HTMLOptionElement) return;
    this.emitClick(el);
  };

  private emitClick(el: Element): void {
    this.flush();
    this.lastActionAt = this.now();
    this.lastClicked = el;
    this.emit({
      kind: 'click',
      at: this.lastActionAt,
      target: describeElement(el),
      ...(isIrreversibleAction(el) ? { confirm: true as const } : {}),
    });
  }

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
      return;
    }
    if (!(el instanceof HTMLSelectElement && !el.multiple) && !isToggle(el)) return;
    const at = this.now();
    const target = describeElement(el);
    // Liste ou case sensible (mois d'expiration, type de carte...) : valeur jamais lue.
    if (isSensitiveField(el)) {
      this.emit({ kind: 'manualInput', at, target });
    } else if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions[0];
      this.emit({
        kind: 'select',
        at,
        target,
        value: el.value.slice(0, LIMITS.value),
        ...(option ? { label: normalizeText(option.textContent) } : {}),
      });
    } else {
      this.emit({ kind: 'check', at, target, checked: el.checked });
    }
  };

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (!this.trusted(event) || event.key !== 'Enter') return;
    this.flush();
    const el = event.target;
    if (!(el instanceof Element) || !isTextField(el) || el instanceof HTMLTextAreaElement) return;
    const at = this.now();
    // Si Entrée soumet un formulaire, l'événement submit (ou le clic du bouton par défaut)
    // arrive avant la prochaine tâche ; sinon la touche est destinée aux scripts de la page.
    setTimeout(() => {
      if (!this.listening || this.lastActionAt >= at || !el.isConnected) return;
      this.emit({ kind: 'press', at, target: describeElement(el), key: 'Enter' });
    }, 0);
  };

  private readonly onSubmit = (event: SubmitEvent) => {
    if (!this.trusted(event) || !(event.target instanceof HTMLFormElement)) return;
    this.flush();
    const { submitter } = event;
    if (submitter) {
      // Envoi par un bouton : déjà capturé si on a vu son clic ; sinon (Entrée qui « clique »
      // le bouton par défaut sans événement fiable) on enregistre ce clic.
      if (this.lastClicked !== submitter || this.now() - this.lastActionAt > 1_000) this.emitClick(submitter);
      this.lastActionAt = this.now();
      return;
    }
    this.lastActionAt = this.now();
    const form = event.target;
    this.emit({
      kind: 'submit',
      at: this.lastActionAt,
      target: describeElement(form),
      ...(isIrreversibleAction(form) ? { confirm: true as const } : {}),
    });
  };

  private readonly onLeave = (event: Event) => {
    if (!this.trusted(event)) return;
    this.flush();
    this.emit({ kind: 'leave', at: this.now() });
  };

  /** Événement d'un champ texte : valeur réelle, ou saisie manuelle si le champ est sensible. */
  private fieldEvent(el: Element, at: number): RecordedEvent | null {
    if (!isTextField(el) || !el.isConnected) return null;
    const target = describeElement(el);
    if (isSensitiveField(el)) return { kind: 'manualInput', at, target };
    return { kind: 'input', at, target, value: el.value.slice(0, LIMITS.value) };
  }
}
