import { fail, ok, type ElementTarget, type Result } from '@flowpilot/shared';
import { TEST_ID_ATTRIBUTES, accessibleName, cssString, isVisible, normalizeText, roleOf } from './dom';

/**
 * Grounding déterministe : retrouve l'élément décrit par une `ElementTarget`.
 *
 * Chaque stratégie produit un ensemble de candidats visibles. Les stratégies
 * sans résultat sont ignorées (indice devenu obsolète). L'élément retenu est
 * l'intersection des autres : elle doit contenir exactement un élément.
 * - plusieurs éléments : `TARGET_AMBIGUOUS` (jamais de choix arbitraire) ;
 * - stratégies en désaccord : on se replie sur les stratégies fortes
 *   (identifiants, rôle + nom, attributs) ; si elles divergent aussi, ambiguïté ;
 * - rien de visible : `TARGET_NOT_INTERACTABLE` si un candidat masqué existe,
 *   `TARGET_NOT_FOUND` sinon.
 *
 * Le grounding sémantique (Sprint 3) interviendra seulement après un échec ici.
 */

export type StrategyName = 'testid' | 'id' | 'role' | 'attributes' | 'css' | 'text';

interface Strategy {
  name: StrategyName;
  strong: boolean;
  find: (target: ElementTarget, root: ParentNode) => Element[] | null;
}

const safeQuery = (root: ParentNode, selector: string): Element[] => {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
};

const ROLE_SCAN = 'a, button, input, select, textarea, [role], summary, h1, h2, h3, h4, h5, h6, li, option, img, form, nav';

const STRATEGIES: readonly Strategy[] = [
  {
    name: 'testid',
    strong: true,
    find: (target, root) => {
      const attr = TEST_ID_ATTRIBUTES.find((name) => target.attributes[name]);
      return attr ? safeQuery(root, `[${attr}=${cssString(target.attributes[attr] ?? '')}]`) : null;
    },
  },
  {
    name: 'id',
    strong: true,
    find: (target, root) => (target.attributes.id ? safeQuery(root, `[id=${cssString(target.attributes.id)}]`) : null),
  },
  {
    name: 'role',
    strong: true,
    find: (target, root) => {
      if (!target.role || !target.name) return null;
      const name = normalizeText(target.name);
      return safeQuery(root, ROLE_SCAN).filter((el) => roleOf(el) === target.role && accessibleName(el) === name);
    },
  },
  {
    name: 'attributes',
    strong: true,
    find: (target, root) => {
      // Combinaison d'attributs discriminants (hors identifiants déjà testés).
      const keys = ['name', 'type', 'value', 'aria-label', 'placeholder', 'href', 'for'].filter((k) => target.attributes[k]);
      if (!keys.some((k) => k !== 'type')) return null;
      const selector = target.tag + keys.map((k) => `[${k}=${cssString(target.attributes[k] ?? '')}]`).join('');
      return safeQuery(root, selector);
    },
  },
  {
    name: 'css',
    strong: false,
    find: (target, root) => safeQuery(root, target.css).filter((el) => el.tagName.toLowerCase() === target.tag),
  },
  {
    name: 'text',
    strong: false,
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
  /** Stratégie qui désigne seule l'élément, ou `combined` si seule l'intersection y parvient. */
  strategy: StrategyName | 'combined';
}

interface StrategyResult {
  strategy: Strategy;
  visible: Element[];
}

const intersect = (sets: Element[][]): Element[] => {
  const [first, ...rest] = sets;
  if (!first) return [];
  return first.filter((el) => rest.every((set) => set.includes(el)));
};

export function resolveTarget(target: ElementTarget, root: ParentNode = document): Result<Resolution> {
  const results: StrategyResult[] = [];
  let hiddenMatch = false;
  for (const strategy of STRATEGIES) {
    const matches = strategy.find(target, root);
    if (matches === null) continue;
    const visible = matches.filter(isVisible);
    if (matches.length > visible.length) hiddenMatch = true;
    if (visible.length > 0) results.push({ strategy, visible });
  }

  if (results.length === 0) {
    return hiddenMatch
      ? fail('TARGET_NOT_INTERACTABLE', `${label(target)} est présent mais masqué.`)
      : fail('TARGET_NOT_FOUND', `${label(target)} est introuvable dans la page.`);
  }

  let candidates = intersect(results.map((r) => r.visible));
  if (candidates.length === 0) {
    // Désaccord : les indices fragiles (CSS positionnel, texte) ont pu dériver.
    candidates = intersect(results.filter((r) => r.strategy.strong).map((r) => r.visible));
    if (candidates.length !== 1) {
      return fail('TARGET_AMBIGUOUS', `Les indices de ${label(target)} désignent des éléments différents.`);
    }
  }
  if (candidates.length > 1) {
    return fail('TARGET_AMBIGUOUS', `${candidates.length} éléments correspondent à ${label(target)}.`);
  }
  const element = candidates[0];
  if (!element) return fail('TARGET_NOT_FOUND', `${label(target)} est introuvable dans la page.`);
  const sole = results.find((r) => r.visible.length === 1 && r.visible[0] === element);
  return ok({ element, strategy: sole ? sole.strategy.name : 'combined' });
}

const label = (target: ElementTarget): string => {
  const text = target.name ?? target.text ?? target.attributes['aria-label'] ?? target.attributes.name;
  return text ? `L’élément « ${text} »` : `L’élément <${target.tag}>`;
};

/**
 * Attend que la cible soit résolue (éléments chargés en différé). Une
 * ambiguïté est renvoyée tout de suite : attendre ne la lève pas.
 */
export async function waitForTarget(
  target: ElementTarget,
  timeoutMs: number,
  root: ParentNode = document,
  intervalMs = 100,
): Promise<Result<Resolution>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = resolveTarget(target, root);
    if (result.ok || result.error.code === 'TARGET_AMBIGUOUS' || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
