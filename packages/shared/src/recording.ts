import { isFiniteNumber, isNonEmptyString, isRecord } from './guards.js';
import { fail, ok, type Result } from './result.js';
import { isSupportedUrl } from './origin.js';
import {
  LIMITS,
  WORKFLOW_SCHEMA_VERSION,
  parseWorkflowStep,
  type ElementStep,
  type Workflow,
  type WorkflowStep,
} from './workflow.js';

/**
 * Enregistrement en deux temps :
 *
 * 1. Capture : le content script émet des `RecordedEvent` (interactions
 *    réelles, champs sensibles déjà filtrés) et le service worker ajoute des
 *    `NavigationEvent` (changements d'URL de l'onglet, SPA comprises). Tous
 *    sont horodatés et stockés bruts dans le brouillon.
 * 2. Compilation (`compileSteps`, pure) : tri chronologique, fusion des
 *    saisies, dédoublonnage, classement des navigations. Rejouable à
 *    l'identique sur le même brouillon.
 */

/** Interaction capturée dans la page : une étape sans id, horodatée (epoch ms). */
export type RecordedEvent = DistributiveOmit<ElementStep, 'id'> & { at: number };

/** Changement d'URL de l'onglet enregistré, observé par le service worker. */
export interface NavigationEvent {
  kind: 'navigation';
  at: number;
  url: string;
}

export type DraftEvent = RecordedEvent | NavigationEvent;

export interface RecordingDraft {
  workflowId: string;
  origin: string;
  startUrl: string;
  startedAt: number;
  events: DraftEvent[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Nombre max d'événements bruts par enregistrement (protège le stockage). */
export const MAX_DRAFT_EVENTS = 1_000;

/** Une navigation survenant dans ce délai après une interaction en est la conséquence. */
export const NAVIGATION_CAUSE_WINDOW_MS = 3_000;
/** Navigations successives plus rapprochées : chaîne de redirections, une seule étape. */
export const REDIRECT_WINDOW_MS = 1_500;
/** Deux clics identiques plus rapprochés : double-clic, un seul clic rejoué. */
export const DOUBLE_CLICK_WINDOW_MS = 400;

// --- Validation -------------------------------------------------------------

export function parseRecordedEvent(raw: unknown): Result<RecordedEvent> {
  if (!isRecord(raw) || !isFiniteNumber(raw.at)) return fail('INVALID_WORKFLOW', 'Événement : horodatage manquant.');
  if (raw.kind === 'navigate' || raw.kind === 'waitForNavigation') {
    return fail('INVALID_WORKFLOW', 'Événement : les navigations ne viennent pas de la page.');
  }
  const step = parseWorkflowStep({ ...raw, id: 'event' }, 0);
  if (!step.ok) return step;
  if (step.value.kind === 'navigate' || step.value.kind === 'waitForNavigation') {
    return fail('INVALID_WORKFLOW', 'Événement : type inattendu.');
  }
  const { id: _id, ...rest } = step.value;
  return ok({ ...rest, at: raw.at });
}

function parseDraftEvent(raw: unknown): DraftEvent | null {
  if (isRecord(raw) && raw.kind === 'navigation') {
    return isFiniteNumber(raw.at) && isNonEmptyString(raw.url) && isSupportedUrl(raw.url)
      ? { kind: 'navigation', at: raw.at, url: raw.url }
      : null;
  }
  const event = parseRecordedEvent(raw);
  return event.ok ? event.value : null;
}

/** Relit un brouillon depuis le stockage ; `null` s'il est absent ou corrompu. Les événements invalides sont ignorés. */
export function parseRecordingDraft(raw: unknown): RecordingDraft | null {
  if (!isRecord(raw)) return null;
  const { workflowId, origin, startUrl, startedAt, events } = raw;
  if (
    !isNonEmptyString(workflowId) ||
    !isNonEmptyString(origin) ||
    !isNonEmptyString(startUrl) ||
    !isSupportedUrl(startUrl) ||
    !isFiniteNumber(startedAt) ||
    !Array.isArray(events)
  ) {
    return null;
  }
  const parsed = (events as unknown[]).slice(0, MAX_DRAFT_EVENTS).map(parseDraftEvent);
  return { workflowId, origin, startUrl, startedAt, events: parsed.filter((e): e is DraftEvent => e !== null) };
}

// --- Compilation ------------------------------------------------------------

const sameTarget = (a: ElementStep, b: RecordedEvent) => a.target.css === b.target.css;

/** URL comparée sans fragment vide (`/page#` ≡ `/page`). */
const normalizeUrl = (url: string): string => {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
};

/**
 * Compile les événements bruts en étapes de workflow, dans l'ordre chronologique.
 *
 * - La première étape ouvre toujours la page de départ.
 * - Saisies successives dans le même champ, sélections et cases successives
 *   sur la même cible : seule la dernière valeur est gardée.
 * - Double-clic sur la même cible : un seul clic.
 * - Navigation : ignorée si l'URL ne change pas (rechargement) ; fusionnée
 *   avec la précédente si elles se suivent de près (redirections) ;
 *   `waitForNavigation` si elle suit une interaction (lien, formulaire, routeur
 *   SPA), `navigate` sinon (URL saisie, historique).
 */
export function compileSteps(draft: Pick<RecordingDraft, 'startUrl' | 'startedAt' | 'events'>): WorkflowStep[] {
  const events = [...draft.events].sort((a, b) => a.at - b.at);
  const steps: WorkflowStep[] = [{ id: 's1', kind: 'navigate', url: draft.startUrl }];
  let currentUrl = normalizeUrl(draft.startUrl);
  let lastInteractionAt = Number.NEGATIVE_INFINITY;
  let lastNavigationAt = Number.NEGATIVE_INFINITY;
  let lastClickAt = Number.NEGATIVE_INFINITY;

  const push = (step: DistributiveOmit<WorkflowStep, 'id'>) => {
    if (steps.length < LIMITS.steps) steps.push({ ...step, id: `s${steps.length + 1}` });
  };
  const replaceLast = (step: DistributiveOmit<WorkflowStep, 'id'>) => {
    const last = steps[steps.length - 1];
    if (last) steps[steps.length - 1] = { ...step, id: last.id };
  };

  for (const event of events) {
    const last = steps[steps.length - 1];

    if (event.kind === 'navigation') {
      const url = normalizeUrl(event.url);
      if (url === currentUrl) continue;
      const isRedirect =
        (last?.kind === 'navigate' || last?.kind === 'waitForNavigation') &&
        steps.length > 1 &&
        event.at - lastNavigationAt < REDIRECT_WINDOW_MS;
      const caused = event.at - lastInteractionAt <= NAVIGATION_CAUSE_WINDOW_MS;
      const kind = isRedirect ? last.kind : caused ? 'waitForNavigation' : 'navigate';
      if (isRedirect) replaceLast({ kind, url: event.url });
      else push({ kind, url: event.url });
      currentUrl = url;
      lastNavigationAt = event.at;
      continue;
    }

    const { at, ...step } = event;
    lastInteractionAt = at;
    const mergeable =
      last !== undefined &&
      'target' in last &&
      last.kind === step.kind &&
      sameTarget(last, event) &&
      (step.kind === 'input' || step.kind === 'manualInput' || step.kind === 'select' || step.kind === 'check');

    if (mergeable) {
      replaceLast(step);
    } else if (
      step.kind === 'click' &&
      last?.kind === 'click' &&
      sameTarget(last, event) &&
      at - lastClickAt < DOUBLE_CLICK_WINDOW_MS
    ) {
      // Double-clic : on garde le premier clic.
    } else {
      push(step);
    }
    if (step.kind === 'click') lastClickAt = at;
  }
  return steps;
}

/** Construit le workflow final à partir d'un brouillon. */
export function workflowFromDraft(draft: RecordingDraft, name: string): Workflow {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: draft.workflowId,
    name,
    origin: draft.origin,
    createdAt: new Date(draft.startedAt).toISOString(),
    steps: compileSteps(draft),
  };
}
