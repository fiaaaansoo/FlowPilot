import { fail, ok, type ElementTarget, type Result } from '@flowpilot/shared';
import { TEST_ID_ATTRIBUTES, accessibleName, cssString, hrefMatches, isVisible, normalizeText, roleOf, rowContext } from './dom';

/**
 * Grounding déterministe : retrouve l'élément décrit par une `ElementTarget`,
 * ou refuse.
 *
 * 1. Indices forts (identifiant de test, id, rôle + nom, attributs) : chacun
 *    produit des candidats visibles ; ceux qui ne trouvent rien sont ignorés,
 *    l'élément retenu est dans l'intersection des autres. S'ils divergent :
 *    `TARGET_AMBIGUOUS`.
 * 2. Plusieurs candidats forts : départagés seulement par la ligne qui les
 *    contient (`context`), jamais par la position (CSS) ni par le texte, qui
 *    désigneraient l'élément situé au même endroit après un changement de liste.
 * 3. Indices fragiles (CSS, texte) : utilisés seuls uniquement si la cible
 *    n'avait aucun indice fort. Si des indices forts existaient mais ne trouvent
 *    plus rien, l'élément a changé : `TARGET_NOT_FOUND` (le Recovery Agent du
 *    Sprint 3 prendra le relais), plutôt qu'un clic sur ce qui occupe sa place.
 *
 * Rien de visible : `TARGET_NOT_INTERACTABLE` si un candidat masqué existe,
 * `TARGET_NOT_FOUND` sinon.
 */

export type StrategyName = 'testid' | 'id' | 'role' | 'attributes' | 'context' | 'css' | 'text';

interface Strategy {
  name: StrategyName;
  /** `null` : la cible n'a pas l'indice nécessaire (stratégie non applicable). */
  find: (target: ElementTarget, root: ParentNode) => Element[] | null;
}

const safeQuery = (root: ParentNode, selector: string): Element[] => {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
};

const ROLE_SCAN = 'a, button, input, select, textarea, [role], summary, h1, h2, h3, h4, h5, h6, li, option, img, form, nav, [tabindex], [onclick]';

const STRONG: readonly Strategy[] = [
  {
    name: 'testid',
    find: (target, root) => {
      const attr = TEST_ID_ATTRIBUTES.find((name) => target.attributes[name]);
      return attr ? safeQuery(root, `[${attr}=${cssString(target.attributes[attr] ?? '')}]`) : null;
    },
  },
  {
    name: 'id',
    find: (target, root) => (target.attributes.id ? safeQuery(root, `[id=${cssString(target.attributes.id)}]`) : null),
  },
  {
    name: 'role',
    find: (target, root) => {
      if (!target.role || !target.name) return null;
      const name = normalizeText(target.name);
      return safeQuery(root, ROLE_SCAN).filter((el) => roleOf(el) === target.role && accessibleName(el) === name);
    },
  },
  {
    name: 'attributes',
    find: (target, root) => {
      // Combinaison d'attributs discriminants (hors identifiants déjà testés).
      const keys = ['name', 'type', 'value', 'aria-label', 'placeholder', 'for'].filter((k) => target.attributes[k]);
      const href = target.attributes.href;
      if (!href && !keys.some((k) => k !== 'type')) return null;
      const selector = target.tag + keys.map((k) => `[${k}=${cssString(target.attributes[k] ?? '')}]`).join('');
      const found = safeQuery(root, href ? `${selector}[href]` : selector);
      // Un lien est comparé par son URL résolue : forme relative ou absolue indifférente.
      return href ? found.filter((el) => hrefMatches(el, href)) : found;
    },
  },
];

const WEAK: readonly Strategy[] = [
  {
    name: 'css',
    find: (target, root) => safeQuery(root, target.css).filter((el) => el.tagName.toLowerCase() === target.tag),
  },
  {
    name: 'text',
    find: (target, root) => {
      const text = target.text ?? target.name;
      if (!text || ['input', 'select', 'textarea'].includes(target.tag)) return null;
      const wanted = normalizeText(text);
      return safeQuery(root, target.tag).filter((el) => accessibleName(el) === wanted || normalizeText(el.textContent) === wanted);
    },
  },
];

export interface Resolution {
  element: Element;
  /** Stratégie qui désigne seule l'élément, `context` si la ligne a départagé, `combined` si seule l'intersection y parvient. */
  strategy: StrategyName | 'combined';
}

interface Evaluated {
  /** Au moins une stratégie de ce groupe était applicable à la cible. */
  applicable: boolean;
  /** Résultats visibles non vides, par stratégie. */
  results: { name: StrategyName; visible: Element[] }[];
  hiddenMatch: boolean;
}

function evaluate(strategies: readonly Strategy[], target: ElementTarget, root: ParentNode): Evaluated {
  const evaluated: Evaluated = { applicable: false, results: [], hiddenMatch: false };
  for (const strategy of strategies) {
    const matches = strategy.find(target, root);
    if (matches === null) continue;
    evaluated.applicable = true;
    const visible = matches.filter(isVisible);
    if (matches.length > visible.length) evaluated.hiddenMatch = true;
    if (visible.length > 0) evaluated.results.push({ name: strategy.name, visible });
  }
  return evaluated;
}

const intersect = (sets: Element[][]): Element[] => {
  const [first, ...rest] = sets;
  if (!first) return [];
  return first.filter((el) => rest.every((set) => set.includes(el)));
};

const soleStrategy = (results: Evaluated['results'], element: Element): StrategyName | 'combined' =>
  results.find((r) => r.visible.length === 1 && r.visible[0] === element)?.name ?? 'combined';

export function resolveTarget(target: ElementTarget, root: ParentNode = document): Result<Resolution> {
  const strong = evaluate(STRONG, target, root);

  if (strong.applicable) {
    if (strong.results.length === 0) return notFound(target, strong.hiddenMatch);
    let candidates = intersect(strong.results.map((r) => r.visible));
    if (candidates.length === 0) {
      return fail('TARGET_AMBIGUOUS', `Les indices de ${label(target)} désignent des éléments différents.`);
    }
    if (candidates.length === 1 && candidates[0]) {
      return ok({ element: candidates[0], strategy: soleStrategy(strong.results, candidates[0]) });
    }
    // Plusieurs candidats : seule la ligne qui les contient peut les départager.
    if (target.context) {
      const wanted = normalizeText(target.context);
      const inRow = candidates.filter((el) => rowContext(el) === wanted);
      if (inRow.length === 1 && inRow[0]) return ok({ element: inRow[0], strategy: 'context' });
      if (inRow.length === 0) {
        return fail('TARGET_NOT_FOUND', `${label(target)} n’est plus dans la ligne enregistrée (« ${target.context} »).`);
      }
      candidates = inRow;
    }
    return ambiguous(target, candidates.length);
  }

  // Aucun indice fort enregistré : les indices fragiles doivent concorder.
  const weak = evaluate(WEAK, target, root);
  if (weak.results.length === 0) return notFound(target, weak.hiddenMatch);
  const candidates = intersect(weak.results.map((r) => r.visible));
  if (candidates.length === 1 && candidates[0]) {
    return ok({ element: candidates[0], strategy: soleStrategy(weak.results, candidates[0]) });
  }
  if (candidates.length === 0) return fail('TARGET_AMBIGUOUS', `Les indices de ${label(target)} désignent des éléments différents.`);
  return ambiguous(target, candidates.length);
}

const label = (target: ElementTarget): string => {
  const text = target.name ?? target.text ?? target.attributes['aria-label'] ?? target.attributes.name;
  return text ? `L’élément « ${text} »` : `L’élément <${target.tag}>`;
};

const notFound = (target: ElementTarget, hidden: boolean): Result<never> =>
  hidden
    ? fail('TARGET_NOT_INTERACTABLE', `${label(target)} est présent mais masqué.`)
    : fail('TARGET_NOT_FOUND', `${label(target)} est introuvable dans la page.`);

const ambiguous = (target: ElementTarget, count: number): Result<never> =>
  fail('TARGET_AMBIGUOUS', `${count} éléments correspondent à ${label(target)}${target.context ? ' dans la ligne enregistrée' : ''}.`);

/**
 * Attend que la cible soit résolue (éléments chargés en différé). Une
 * ambiguïté est renvoyée tout de suite : attendre ne la lève pas. L'arrêt du
 * replay (`signal`) interrompt l'attente.
 */
/** Visible loading indicators: while one is shown, the page is not settled. */
const LOADING = '[aria-busy="true"], [role="progressbar"], progress';

/**
 * Waits for the target. `timeoutMs` bounds the wait. With `settleMs > 0`, a missing
 * target is reported early once the page is settled: document loaded, no DOM change
 * for `settleMs`, no loading indicator. `settleMs = 0` keeps the fixed wait.
 * Trade-off: an element added after a silent pause longer than `settleMs` is missed
 * (measured by the dynamic benchmark scenarios).
 */
export async function waitForTarget(
  target: ElementTarget,
  timeoutMs: number,
  root: ParentNode = document,
  intervalMs = 100,
  signal?: AbortSignal,
  settleMs = 0,
): Promise<Result<Resolution>> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let lastChange = started;
  const doc = root instanceof Document ? root : (root as Node).ownerDocument;
  const observer =
    settleMs > 0 && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          lastChange = Date.now();
        })
      : null;
  observer?.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  const settled = (now: number) =>
    observer !== null &&
    now - lastChange >= settleMs &&
    (doc?.readyState ?? 'complete') === 'complete' &&
    !Array.from((doc ?? document).querySelectorAll(LOADING)).some((el) => !el.closest('[hidden]'));
  try {
    for (;;) {
      if (signal?.aborted) return fail('NAVIGATION_FAILED', 'Exécution arrêtée.');
      const result = resolveTarget(target, root);
      const now = Date.now();
      if (result.ok || result.error.code === 'TARGET_AMBIGUOUS' || now >= deadline || settled(now)) return result;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    observer?.disconnect();
  }
}

