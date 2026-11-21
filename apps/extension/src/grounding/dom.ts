import { LIMITS, sanitizeUrl, type ElementTarget } from '@flowpilot/shared';

/**
 * Lecture du DOM pour le grounding : rôle et nom accessibles (sous-ensemble
 * pragmatique de l'algorithme ARIA), visibilité, attributs stables, sélecteur
 * CSS unique. Aucune écriture dans la page.
 */

export const normalizeText = (text: string | null | undefined, max: number = LIMITS.text): string =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const INPUT_ROLES: Record<string, string> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  search: 'searchbox',
  email: 'textbox',
  tel: 'textbox',
  text: 'textbox',
  url: 'textbox',
  number: 'spinbutton',
};

/** Rôle ARIA explicite, sinon implicite pour les éléments courants. */
export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : undefined;
    case 'button':
      return 'button';
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      return INPUT_ROLES[type] ?? (type === 'password' ? undefined : 'textbox');
    }
    case 'select':
      return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    case 'textarea':
      return 'textbox';
    case 'option':
      return 'option';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'li':
      return 'listitem';
    case 'nav':
      return 'navigation';
    case 'form':
      return 'form';
    case 'img':
      return 'img';
    default:
      return undefined;
  }
}

const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);

const NO_TEXT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/** Explicit marking by the site or the user: the whole subtree is sensitive (values and text). */
export const SENSITIVE_MARKER = '[data-flowpilot-sensitive], [data-private], [data-sensitive]';
const TYPABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

/** A field whose content the user types: native fields, rich-text editors and ARIA text boxes. */
export function isTypingField(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true')) return true;
  return TYPABLE_ROLES.has(el.getAttribute('role') ?? '');
}

/** Texte d'un sous-arbre sans le contenu des champs (jamais de valeur saisie) ni des scripts. */
export function textOf(el: Element): string {
  if (isTypingField(el) || NO_TEXT.has(el.tagName) || el.matches(SENSITIVE_MARKER)) return '';
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof Element && !node.hasAttribute('hidden') && node.getAttribute('aria-hidden') !== 'true') {
      text += ` ${node instanceof HTMLImageElement ? (node.alt || '') : textOf(node)} `;
    }
  }
  return text;
}

/** Nom accessible simplifié : aria-labelledby, aria-label, label associé, alt/title, texte, placeholder. */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => textOf(node))
      .join(' ');
    if (normalizeText(text)) return normalizeText(text);
  }
  const ariaLabel = normalizeText(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const tag = el.tagName.toLowerCase();
  if (LABELABLE.has(tag)) {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0) {
      const text = normalizeText(Array.from(labels, (label) => textOf(label)).join(' '));
      if (text) return text;
    }
  }
  if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type)) {
    const value = normalizeText(el.value || (el.type === 'submit' ? 'Envoyer' : ''));
    if (value) return value;
  }
  if (el instanceof HTMLImageElement) return normalizeText(el.alt);

  if (!isTypingField(el)) {
    const text = normalizeText(textOf(el));
    if (text) return text;
  }
  return normalizeText(el.getAttribute('title') ?? el.getAttribute('placeholder'));
}

/** Visible : rendu (pas `display:none` / `visibility:hidden`), pas dans un sous-arbre `hidden`. */
export function isVisible(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  const html = el as HTMLElement & { checkVisibility?: (opts?: object) => boolean };
  if (typeof html.checkVisibility === 'function') {
    return html.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  // jsdom ne calcule pas la mise en page : on s'en tient au style.
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

export const isDisabled = (el: Element): boolean =>
  el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';

/** Id écrit à la main, pas généré par un framework (`:r1:`, `ember123`, hash...). */
export function isStableId(id: string): boolean {
  return /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}|[0-9a-f]{8,}|^(ember|yui|ext-|react|mui-|radix-)/i.test(id);
}

export const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy'] as const;

const STABLE_ATTRIBUTES = [
  ...TEST_ID_ATTRIBUTES,
  'name',
  'aria-label',
  'placeholder',
  'type',
  'href',
  'for',
  'title',
  'role',
] as const;

/** Attributs stables d'un élément. La valeur n'est gardée que pour les cases, radios et boutons, jamais pour un champ texte. */
export function stableAttributes(el: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  const id = el.getAttribute('id');
  if (id && isStableId(id)) attributes.id = id;
  for (const name of STABLE_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value === null || value === '') continue;
    // Un lien peut porter un jeton (réinitialisation, OAuth) : jamais stocké.
    const safe = name === 'href' ? sanitizeHref(el, value) : value;
    attributes[name] = safe.slice(0, LIMITS.attributeValue);
  }
  if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'submit', 'button', 'reset'].includes(el.type)) {
    const value = el.getAttribute('value');
    if (value) attributes.value = value.slice(0, LIMITS.attributeValue);
  }
  return Object.fromEntries(Object.entries(attributes).slice(0, LIMITS.attributes));
}

/** `href` tel quel s'il ne porte pas de secret, sinon sa forme absolue assainie. */
function sanitizeHref(el: Element, href: string): string {
  try {
    const absolute = new URL(href, el.ownerDocument.baseURI).href;
    const clean = sanitizeUrl(absolute);
    return clean === absolute ? href : clean;
  } catch {
    return href;
  }
}

/**
 * Le lien `el` pointe-t-il vers le `href` enregistré ? Comparaison des URL
 * résolues et assainies, insensible à la forme relative ou absolue de l'attribut.
 */
export function hrefMatches(el: Element, recorded: string): boolean {
  const live = el.getAttribute('href');
  if (live === null) return false;
  try {
    const base = el.ownerDocument.baseURI;
    return sanitizeUrl(new URL(live, base).href) === sanitizeUrl(new URL(recorded, base).href);
  } catch {
    return live === recorded;
  }
}

/** Conteneurs de « ligne » : élément de liste, rangée de tableau, carte. */
export const ROW_CONTAINER = 'li, tr, [role="row"], [role="listitem"], article';

/** D'autres éléments de la page ont-ils le même rôle et le même nom accessible ? */
function hasHomonyms(el: Element, role: string | undefined, name: string): boolean {
  if (!name) return false;
  const tag = el.tagName.toLowerCase();
  let count = 0;
  for (const other of Array.from(el.ownerDocument.querySelectorAll(`${tag}, [role]`))) {
    if (roleOf(other) === role && accessibleName(other) === name && ++count > 1) return true;
  }
  return false;
}

/**
 * Texte de la ligne qui contient l'élément, s'il en a une. Sert à distinguer des
 * boutons identiques (« Supprimer », « Voir ») sans dépendre de leur position.
 */
export function rowContext(el: Element): string | undefined {
  const row = el.parentElement?.closest(ROW_CONTAINER);
  if (!row) return undefined;
  const text = normalizeText(textOf(row));
  return text || undefined;
}

/** `CSS.escape` (absent de jsdom) pour un identifiant. */
export function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/^(\d)/, '\\3$1 ').replace(/[^\w-]/g, (char) => `\\${char}`);
}

/** Valeur d'attribut sûre dans un sélecteur `[attr="..."]`. */
export const cssString = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

/** Sélecteur CSS le plus court qui désigne l'élément de façon unique dans son document. */
export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  const isUnique = (selector: string) => {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== doc.documentElement) {
    const id = current.getAttribute('id');
    if (id && isStableId(id) && isUnique(`#${cssEscape(id)}`)) {
      parts.unshift(`#${cssEscape(id)}`);
      return parts.join(' > ').slice(0, LIMITS.css);
    }
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    let part = tag;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (isUnique(selector)) return selector.slice(0, LIMITS.css);
    current = parent;
  }
  return parts.join(' > ').slice(0, LIMITS.css);
}

/** Empreinte multi-indices d'un élément, enregistrée dans le workflow. */
export function describeElement(el: Element): ElementTarget {
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const role = roleOf(el);
  const name = accessibleName(el);
  const text = isField ? '' : normalizeText(textOf(el));
  // Le contexte ne sert qu'à départager des homonymes : inutile (et bruité) pour un élément unique.
  const context = hasHomonyms(el, role, name) ? rowContext(el) : undefined;
  return {
    tag: el.tagName.toLowerCase(),
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(text && text !== name ? { text } : {}),
    ...(context ? { context } : {}),
    attributes: stableAttributes(el),
    css: uniqueSelector(el),
  };
}

/** Where activating the element sends the user or the form data: a link target, a form action, a formaction. */
export function destination(el: Element): string | null {
  if (el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) return el.getAttribute('href');
  if (el instanceof HTMLFormElement) return el.getAttribute('action');
  if (isSubmitter(el) && el.form) return el.getAttribute('formaction') ?? el.form.getAttribute('action');
  return null;
}

/** A control that submits its form when activated (not `type="button"` or `"reset"`). */
function isSubmitter(el: Element): el is HTMLButtonElement | HTMLInputElement {
  return (el instanceof HTMLButtonElement && el.type === 'submit') || (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image'));
}

/** Does activating the element keep the user and the form data on the page's origin? */
export function sameOrigin(el: Element): boolean {
  return foreignDestination(el) === null; // an unparsable destination counts as foreign
}

/**
 * Would activating this element send form data to another origin? True for a form, or for a
 * submit control of a form, whose action (or formaction) leaves the page's origin. For Enter in
 * a field, pass the field's form (see `submissionScope`).
 */
export function submitsCrossOrigin(el: Element): boolean {
  if (el instanceof HTMLFormElement) return !sameOrigin(el);
  return isSubmitter(el) && el.form !== null && !sameOrigin(el);
}

/** Origin the element would send the user or the form data to, when it differs from the page's. */
export function foreignDestination(el: Element): string | null {
  const target = destination(el);
  if (!target) return null;
  try {
    const origin = new URL(target, el.ownerDocument.baseURI).origin;
    return origin === el.ownerDocument.defaultView?.location.origin ? null : origin;
  } catch {
    return 'une adresse invalide';
  }
}

