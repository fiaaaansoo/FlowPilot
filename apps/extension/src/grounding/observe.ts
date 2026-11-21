import { LIMITS, fail, ok, sanitizeUrl, type Candidate, type Observation, type Result } from '@flowpilot/shared';
import { isIrreversibleAction, isSensitiveField } from '../recorder/classify';
import { accessibleName, isDisabled, isVisible, normalizeText, roleOf, rowContext, stableAttributes, textOf } from './dom';

/**
 * Page observation for AI recovery (content script).
 *
 * Produces a bounded snapshot of the visible interactive elements, each with a
 * snapshot-local `ref`. Data minimization:
 * - sensitive fields (passwords, payment, OTP, explicitly marked) are excluded;
 * - field values are never read; only roles, accessible names, stable
 *   attributes (sanitized URLs) and short surrounding texts;
 * - texts are bounded.
 *
 * The registry maps refs to elements for *this* snapshot only. Executing a ref
 * later requires the same snapshot id, the same URL, and an element whose
 * identity still matches what was observed (stale proposals are rejected).
 */

const OBSERVABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, form, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="textbox"], [role="searchbox"], [role="combobox"]';

export const MAX_OBSERVED_ELEMENTS = 300;

interface Snapshot {
  id: string;
  url: string;
  refs: Map<string, WeakRef<Element>>;
  observed: Map<string, Candidate>;
}

let current: Snapshot | null = null;

const SECTION = 'form, section, nav, header, footer, aside, main, fieldset, dialog, [role="dialog"], [role="region"]';

/** Label of the enclosing form, section or landmark: aria-label, legend, or first heading. */
function sectionLabel(el: Element): string | undefined {
  const container = el.parentElement?.closest(SECTION);
  if (!container) return undefined;
  const label =
    container.getAttribute('aria-label') ??
    container.querySelector(':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4')?.textContent ??
    container.ownerDocument.querySelector('h1')?.textContent;
  const text = normalizeText(label);
  return text || undefined;
}

const CONTRACT_TAG = /^[a-z][a-z0-9-]{0,31}$/;

function sameOrigin(el: Element): boolean {
  const href = el.getAttribute('href');
  if (!href || !(el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement)) return true;
  try {
    return new URL(href, el.ownerDocument.baseURI).origin === el.ownerDocument.defaultView?.location.origin;
  } catch {
    return false;
  }
}

/** Observed identity of an element: what must still hold when a proposal is executed. */
export function describeCandidate(el: Element, ref: string): Candidate {
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const role = roleOf(el);
  const name = accessibleName(el);
  const text = isField ? '' : normalizeText(textOf(el), 100);
  const context = rowContext(el);
  const section = sectionLabel(el);
  const candidate: Candidate = { ref, tag: el.tagName.toLowerCase(), attributes: stableAttributes(el) };
  if (role) candidate.role = role;
  if (name) candidate.name = name;
  if (text && text !== name) candidate.text = text;
  if (context && context !== name) candidate.context = context.slice(0, LIMITS.text);
  if (section && section !== name) candidate.section = section;
  if (isDisabled(el)) candidate.disabled = true;
  if (isIrreversibleAction(el)) candidate.irreversible = true;
  if (!sameOrigin(el)) candidate.sameOrigin = false;
  return candidate;
}

export function observePage(doc: Document = document, newId: () => string = () => crypto.randomUUID()): Observation {
  const refs = new Map<string, WeakRef<Element>>();
  const observed = new Map<string, Candidate>();
  const elements: Candidate[] = [];
  for (const el of Array.from(doc.querySelectorAll(OBSERVABLE))) {
    if (elements.length >= MAX_OBSERVED_ELEMENTS) break;
    if (!(el instanceof HTMLFormElement) && !isVisible(el)) continue;
    if (isSensitiveField(el)) continue;
    // Tags outside the recovery contract (e.g. custom elements with "_" or ".") are not observable.
    if (!CONTRACT_TAG.test(el.tagName.toLowerCase())) continue;
    const ref = `e${elements.length + 1}`;
    const candidate = describeCandidate(el, ref);
    refs.set(ref, new WeakRef(el));
    observed.set(ref, candidate);
    elements.push(candidate);
  }
  const url = doc.defaultView?.location.href ?? '';
  current = { id: newId(), url, refs, observed };
  return { snapshotId: current.id, url: sanitizeUrl(url), title: normalizeText(doc.title), elements };
}

/** Identity check: tag, role and accessible name must be unchanged since the snapshot. */
const sameIdentity = (a: Candidate, b: Candidate): boolean =>
  a.tag === b.tag && (a.role ?? '') === (b.role ?? '') && (a.name ?? '') === (b.name ?? '');

/**
 * Resolve a ref from the latest snapshot, refusing anything stale: other
 * snapshot, page navigated, element removed, hidden, or changed identity.
 */
export function resolveRef(snapshotId: string, ref: string, doc: Document = document): Result<Element> {
  if (!current || current.id !== snapshotId) return fail('TARGET_NOT_FOUND', 'Proposition périmée : la page a été observée de nouveau.');
  if (doc.defaultView?.location.href !== current.url) return fail('TARGET_NOT_FOUND', 'Proposition périmée : la page a changé.');
  const el = current.refs.get(ref)?.deref();
  const observed = current.observed.get(ref);
  if (!el || !observed || !el.isConnected) return fail('TARGET_NOT_FOUND', 'L’élément proposé n’est plus dans la page.');
  if (!(el instanceof HTMLFormElement) && !isVisible(el)) return fail('TARGET_NOT_INTERACTABLE', 'L’élément proposé est masqué.');
  if (isSensitiveField(el)) return fail('TARGET_NOT_INTERACTABLE', 'Champ sensible : jamais utilisé par la récupération.');
  if (!sameIdentity(observed, describeCandidate(el, ref))) {
    return fail('TARGET_NOT_FOUND', 'L’élément proposé a changé depuis l’observation.');
  }
  return ok(el);
}

/** For tests: forget the current snapshot. */
export function resetSnapshot(): void {
  current = null;
}
