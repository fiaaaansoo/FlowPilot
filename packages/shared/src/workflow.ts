import { isNonEmptyString, isRecord } from './guards.js';
import { fail, ok, type Result } from './result.js';
import { isSupportedUrl } from './origin.js';

/**
 * Format de workflow persisté (JSON). Versionné dès le départ : toute lecture
 * passe par `parseWorkflow`, qui rejette ce qu'elle ne sait pas interpréter
 * plutôt que de deviner. Les étapes `click` / `input` arrivent au Sprint 2 ;
 * ajouter un `kind` = étendre l'union + le validateur, sans casser les données
 * existantes.
 */
export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export interface NavigateStep {
  id: string;
  kind: 'navigate';
  url: string;
}

export type WorkflowStep = NavigateStep;

export interface WorkflowV1 {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  /** Origine sur laquelle le workflow a été enregistré (ex. `http://localhost:5173`). */
  origin: string;
  /** ISO 8601. */
  createdAt: string;
  steps: WorkflowStep[];
}

export type Workflow = WorkflowV1;

function parseStep(raw: unknown, index: number): Result<WorkflowStep> {
  if (!isRecord(raw)) return fail('INVALID_WORKFLOW', `Étape ${index + 1} : objet attendu.`);
  if (!isNonEmptyString(raw.id)) return fail('INVALID_WORKFLOW', `Étape ${index + 1} : id manquant.`);
  switch (raw.kind) {
    case 'navigate':
      if (!isNonEmptyString(raw.url) || !isSupportedUrl(raw.url)) {
        return fail('INVALID_WORKFLOW', `Étape ${index + 1} : URL http(s) attendue.`);
      }
      return ok({ id: raw.id, kind: 'navigate', url: raw.url });
    default:
      return fail('INVALID_WORKFLOW', `Étape ${index + 1} : type « ${String(raw.kind)} » inconnu.`);
  }
}

/** Valide une donnée inconnue (stockage, import) et renvoie un workflow typé. */
export function parseWorkflow(raw: unknown): Result<Workflow> {
  if (!isRecord(raw)) return fail('INVALID_WORKFLOW', 'Workflow : objet attendu.');
  if (raw.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    return fail('INVALID_WORKFLOW', `Version de schéma non supportée : ${String(raw.schemaVersion)}.`);
  }
  if (!isNonEmptyString(raw.id)) return fail('INVALID_WORKFLOW', 'Workflow : id manquant.');
  if (typeof raw.name !== 'string') return fail('INVALID_WORKFLOW', 'Workflow : nom manquant.');
  if (!isNonEmptyString(raw.origin)) return fail('INVALID_WORKFLOW', 'Workflow : origine manquante.');
  if (!isNonEmptyString(raw.createdAt) || Number.isNaN(Date.parse(raw.createdAt))) {
    return fail('INVALID_WORKFLOW', 'Workflow : date de création invalide.');
  }
  if (!Array.isArray(raw.steps)) return fail('INVALID_WORKFLOW', 'Workflow : liste d’étapes attendue.');

  const steps: WorkflowStep[] = [];
  for (const [index, rawStep] of raw.steps.entries()) {
    const step = parseStep(rawStep, index);
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
