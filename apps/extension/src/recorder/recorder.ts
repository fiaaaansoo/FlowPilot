import { WORKFLOW_SCHEMA_VERSION, hostLabel, type Workflow } from '@flowpilot/shared';

/**
 * Recorder — Sprint 1 : un enregistrement capture uniquement la page de départ
 * (étape `navigate`). La capture des clics et saisies (Sprint 2) se branchera
 * ici : le content script enverra des événements que `appendStep` ajoutera
 * au brouillon, après filtrage des champs sensibles.
 */

export interface DraftInput {
  id: string;
  stepId: string;
  origin: string;
  startUrl: string;
  now: Date;
}

export function createDraftWorkflow({ id, stepId, origin, startUrl, now }: DraftInput): Workflow {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id,
    name: defaultWorkflowName(origin),
    origin,
    createdAt: now.toISOString(),
    steps: [{ id: stepId, kind: 'navigate', url: startUrl }],
  };
}

/** Nom par défaut ; la date de création est affichée à part dans la liste. */
export function defaultWorkflowName(origin: string): string {
  return `Procédure sur ${hostLabel(origin)}`;
}
