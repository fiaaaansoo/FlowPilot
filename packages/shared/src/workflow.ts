import { isFiniteNumber, isNonEmptyString, isRecord } from './guards.js';
import { fail, ok, type Result } from './result.js';
import { isSupportedUrl } from './origin.js';

/**
 * Format de workflow persisté (JSON), versionné. Toute lecture passe par
 * `parseWorkflow`, qui reconstruit un objet typé champ par champ, migre les
 * versions antérieures et rejette ce qu'il ne sait pas interpréter.
 *
 * Historique :
 * - v1 (Sprint 1) : uniquement des étapes `navigate`.
 * - v2 (Sprint 2) : interactions (click, input, select, check, submit),
 *   attentes de navigation, saisies manuelles et cibles multi-indices.
 */
export const WORKFLOW_SCHEMA_VERSION = 2 as const;

/** Limites de taille : un workflow est construit à partir de données de pages non fiables. */
export const LIMITS = {
  text: 200,
  value: 2_000,
  css: 1_000,
  attributes: 12,
  attributeValue: 300,
  steps: 500,
} as const;

/**
 * Indices d'identification d'un élément, du plus stable au plus fragile.
 * Le grounding déterministe (content script) les essaie dans un ordre fixe ;
 * le grounding sémantique (Sprint 3) pourra s'appuyer sur les mêmes champs.
 */
export interface ElementTarget {
  /** Nom de balise en minuscules (`button`, `input`...). */
  tag: string;
  /** Rôle ARIA explicite ou implicite. */
  role?: string;
  /** Nom accessible (label, aria-label, texte du bouton...). */
  name?: string;
  /** Texte visible normalisé, tronqué. */
  text?: string;
  /** Attributs jugés stables : id non généré, name, data-testid, aria-label, placeholder, type, href... */
  attributes: Record<string, string>;
  /**
   * Texte de la ligne qui contient l'élément (élément de liste, rangée, carte) :
   * distingue des boutons identiques d'une liste sans dépendre de leur position.
   */
  context?: string;
  /** Sélecteur CSS unique au moment de l'enregistrement (indice fragile : position). */
  css: string;
}

interface StepBase {
  id: string;
}

/** Ouvre une URL (page de départ ou navigation saisie par l'utilisateur). */
export interface NavigateStep extends StepBase {
  kind: 'navigate';
  url: string;
}

/** Attend que l'onglet atteigne une URL, déclenchée par l'étape précédente (lien, formulaire, routeur SPA). */
export interface WaitForNavigationStep extends StepBase {
  kind: 'waitForNavigation';
  url: string;
}

export interface ClickStep extends StepBase {
  kind: 'click';
  target: ElementTarget;
  /** Action potentiellement irréversible : le replay demande une confirmation humaine. */
  confirm?: true;
}

export interface InputStep extends StepBase {
  kind: 'input';
  target: ElementTarget;
  value: string;
}

/** Champ sensible : la valeur n'est jamais enregistrée, l'utilisateur la saisit lui-même au replay. */
export interface ManualInputStep extends StepBase {
  kind: 'manualInput';
  target: ElementTarget;
}

export interface SelectStep extends StepBase {
  kind: 'select';
  target: ElementTarget;
  value: string;
  /** Libellé de l'option, pour l'affichage. */
  label?: string;
}

export interface CheckStep extends StepBase {
  kind: 'check';
  target: ElementTarget;
  checked: boolean;
}

/** Touche Entrée dans un champ hors formulaire (recherche d'application monopage). */
export interface PressStep extends StepBase {
  kind: 'press';
  target: ElementTarget;
  key: 'Enter';
}

/** Soumission d'un formulaire sans clic sur un bouton (touche Entrée). */
export interface SubmitStep extends StepBase {
  kind: 'submit';
  target: ElementTarget;
  confirm?: true;
}

export type WorkflowStep =
  | NavigateStep
  | WaitForNavigationStep
  | ClickStep
  | InputStep
  | ManualInputStep
  | SelectStep
  | CheckStep
  | PressStep
  | SubmitStep;

export type StepKind = WorkflowStep['kind'];
export type ElementStep = Extract<WorkflowStep, { target: ElementTarget }>;

export interface WorkflowV2 {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  /** Origine sur laquelle le workflow a été enregistré (ex. `http://localhost:5173`). */
  origin: string;
  /** ISO 8601. */
  createdAt: string;
  steps: WorkflowStep[];
}

export type Workflow = WorkflowV2;

export const isElementStep = (step: WorkflowStep): step is ElementStep => 'target' in step;

/** Étape qui exige une intervention humaine au replay (confirmation ou saisie manuelle). */
export const needsHuman = (step: WorkflowStep): boolean =>
  step.kind === 'manualInput' || ((step.kind === 'click' || step.kind === 'submit') && step.confirm === true);

// --- Validation -------------------------------------------------------------

type Parsed<T> = Result<T>;
const invalid = (index: number, message: string): Parsed<never> =>
  fail('INVALID_WORKFLOW', `Étape ${index + 1} : ${message}`);

const isBoundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

function parseTarget(raw: unknown, index: number): Parsed<ElementTarget> {
  if (!isRecord(raw)) return invalid(index, 'cible attendue.');
  const { tag, role, name, text, context, attributes, css } = raw;
  if (!isNonEmptyString(tag) || !/^[a-z][a-z0-9-]*$/.test(tag)) return invalid(index, 'balise de la cible invalide.');
  if (!isNonEmptyString(css) || css.length > LIMITS.css) return invalid(index, 'sélecteur CSS de la cible invalide.');
  for (const [label, value] of [
    ['rôle', role],
    ['nom', name],
    ['texte', text],
    ['contexte', context],
  ] as const) {
    if (value !== undefined && !isBoundedString(value, LIMITS.text)) return invalid(index, `${label} de la cible invalide.`);
  }
  if (!isRecord(attributes)) return invalid(index, 'attributs de la cible attendus.');
  const entries = Object.entries(attributes);
  if (entries.length > LIMITS.attributes) return invalid(index, 'trop d’attributs sur la cible.');
  const cleanAttributes: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_:-]*$/i.test(key) || !isBoundedString(value, LIMITS.attributeValue)) {
      return invalid(index, `attribut « ${key} » invalide.`);
    }
    cleanAttributes[key] = value;
  }
  return ok({
    tag,
    ...(typeof role === 'string' && role ? { role } : {}),
    ...(typeof name === 'string' && name ? { name } : {}),
    ...(typeof text === 'string' && text ? { text } : {}),
    ...(typeof context === 'string' && context ? { context } : {}),
    attributes: cleanAttributes,
    css,
  });
}

function parseUrlStep(raw: Record<string, unknown>, index: number): Parsed<string> {
  return isNonEmptyString(raw.url) && isSupportedUrl(raw.url) ? ok(raw.url) : invalid(index, 'URL http(s) attendue.');
}

/** Valide une étape isolée (index utilisé dans les messages d’erreur). */
export function parseWorkflowStep(raw: unknown, index: number): Result<WorkflowStep> {
  if (!isRecord(raw)) return invalid(index, 'objet attendu.');
  const { id, kind } = raw;
  if (!isNonEmptyString(id)) return invalid(index, 'id manquant.');

  if (kind === 'navigate' || kind === 'waitForNavigation') {
    const url = parseUrlStep(raw, index);
    return url.ok ? ok({ id, kind, url: url.value }) : url;
  }

  const target = parseTarget(raw.target, index);
  if (!target.ok) {
    // Type inconnu : message plus utile que « cible attendue ».
    if (!['click', 'input', 'manualInput', 'select', 'check', 'press', 'submit'].includes(String(kind))) {
      return invalid(index, `type « ${String(kind)} » inconnu.`);
    }
    return target;
  }
  const confirm = raw.confirm === true ? { confirm: true as const } : {};

  switch (kind) {
    case 'click':
      return ok({ id, kind, target: target.value, ...confirm });
    case 'submit':
      return ok({ id, kind, target: target.value, ...confirm });
    case 'manualInput':
      return ok({ id, kind, target: target.value });
    case 'input':
      if (!isBoundedString(raw.value, LIMITS.value)) return invalid(index, 'valeur saisie invalide.');
      return ok({ id, kind, target: target.value, value: raw.value });
    case 'select':
      if (!isBoundedString(raw.value, LIMITS.value)) return invalid(index, 'valeur sélectionnée invalide.');
      if (raw.label !== undefined && !isBoundedString(raw.label, LIMITS.text)) return invalid(index, 'libellé invalide.');
      return ok({ id, kind, target: target.value, value: raw.value, ...(typeof raw.label === 'string' ? { label: raw.label } : {}) });
    case 'check':
      if (typeof raw.checked !== 'boolean') return invalid(index, 'état coché attendu.');
      return ok({ id, kind, target: target.value, checked: raw.checked });
    case 'press':
      if (raw.key !== 'Enter') return invalid(index, 'seule la touche Entrée est prise en charge.');
      return ok({ id, kind, target: target.value, key: raw.key });
    default:
      return invalid(index, `type « ${String(kind)} » inconnu.`);
  }
}

/**
 * Valide une donnée inconnue (stockage, import) et renvoie un workflow typé à
 * la version courante. Les workflows v1 sont migrés (leurs étapes `navigate`
 * sont valides telles quelles en v2).
 */
export function parseWorkflow(raw: unknown): Result<Workflow> {
  if (!isRecord(raw)) return fail('INVALID_WORKFLOW', 'Workflow : objet attendu.');
  const version = raw.schemaVersion;
  if (!isFiniteNumber(version) || (version !== 1 && version !== WORKFLOW_SCHEMA_VERSION)) {
    return fail('INVALID_WORKFLOW', `Version de schéma non supportée : ${String(version)}.`);
  }
  if (!isNonEmptyString(raw.id)) return fail('INVALID_WORKFLOW', 'Workflow : id manquant.');
  if (!isBoundedString(raw.name, LIMITS.text)) return fail('INVALID_WORKFLOW', 'Workflow : nom manquant.');
  if (!isNonEmptyString(raw.origin)) return fail('INVALID_WORKFLOW', 'Workflow : origine manquante.');
  if (!isNonEmptyString(raw.createdAt) || Number.isNaN(Date.parse(raw.createdAt))) {
    return fail('INVALID_WORKFLOW', 'Workflow : date de création invalide.');
  }
  if (!Array.isArray(raw.steps)) return fail('INVALID_WORKFLOW', 'Workflow : liste d’étapes attendue.');
  if (raw.steps.length > LIMITS.steps) return fail('INVALID_WORKFLOW', `Workflow : plus de ${LIMITS.steps} étapes.`);

  const steps: WorkflowStep[] = [];
  for (const [index, rawStep] of (raw.steps as unknown[]).entries()) {
    // v1 ne connaissait que `navigate` : toute autre étape dans un v1 est invalide.
    if (version === 1 && isRecord(rawStep) && rawStep.kind !== 'navigate') {
      return invalid(index, `type « ${String(rawStep.kind)} » inconnu en v1.`);
    }
    const step = parseWorkflowStep(rawStep, index);
    if (!step.ok) return step;
    steps.push(step.value);
  }

  return ok({
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    origin: raw.origin,
    createdAt: raw.createdAt,
    steps,
  });
}

// --- Affichage --------------------------------------------------------------

/**
 * Libellé court d'une cible : nom accessible, puis texte, puis attribut parlant,
 * puis balise ; suivi de la ligne qui la contient, pour savoir laquelle parmi
 * des éléments identiques (indispensable avant de confirmer une action).
 */
export function targetLabel(target: ElementTarget): string {
  const label =
    target.name ?? target.text ?? target.attributes['aria-label'] ?? target.attributes.placeholder ?? target.attributes.name;
  const base = label ? `« ${label} »` : `<${target.tag}>`;
  if (!target.context || target.context === label) return base;
  const context = target.context.length > 60 ? `${target.context.slice(0, 59)}…` : target.context;
  return `${base} (ligne « ${context} »)`;
}

const pathOf = (url: string): string => {
  try {
    const { pathname, search, hash } = new URL(url);
    return `${pathname}${search}${hash}`;
  } catch {
    return url;
  }
};

/** Description lisible d'une étape (Side Panel, journaux, futur contexte du Recovery Agent). */
export function describeStep(step: WorkflowStep): string {
  switch (step.kind) {
    case 'navigate':
      return `Ouvrir ${pathOf(step.url)}`;
    case 'waitForNavigation':
      return `Attendre la page ${pathOf(step.url)}`;
    case 'click':
      return `Cliquer sur ${targetLabel(step.target)}`;
    case 'input':
      return `Saisir « ${step.value} » dans ${targetLabel(step.target)}`;
    case 'manualInput':
      return `Saisie manuelle dans ${targetLabel(step.target)} (champ sensible, non enregistré)`;
    case 'select':
      return `Choisir « ${step.label ?? step.value} » dans ${targetLabel(step.target)}`;
    case 'check':
      return `${step.checked ? 'Cocher' : 'Décocher'} ${targetLabel(step.target)}`;
    case 'press':
      return `Appuyer sur Entrée dans ${targetLabel(step.target)}`;
    case 'submit':
      return `Valider le formulaire ${targetLabel(step.target)}`;
  }
}
