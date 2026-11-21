import {
  MAX_DRAFT_EVENTS,
  hostLabel,
  type DraftEvent,
  type RecordingDraft,
} from '@flowpilot/shared';

/**
 * Recorder côté service worker : gestion du brouillon d'enregistrement.
 * La capture a lieu dans la page (`capture.ts`), la compilation en étapes
 * dans le paquet partagé (`compileSteps`).
 */

export function createDraft(input: { workflowId: string; origin: string; startUrl: string; startedAt: number }): RecordingDraft {
  return { ...input, events: [] };
}

/**
 * Ajoute des événements au brouillon. Les horodatages venus de la page sont
 * bornés à la durée de l'enregistrement ; au-delà de `MAX_DRAFT_EVENTS`, les
 * événements sont ignorés (protection du stockage).
 */
export function appendEvents(draft: RecordingDraft, events: readonly DraftEvent[], now: number): RecordingDraft {
  const room = MAX_DRAFT_EVENTS - draft.events.length;
  if (room <= 0 || events.length === 0) return draft;
  const clamped = events.slice(0, room).map((event) => ({ ...event, at: Math.min(Math.max(event.at, draft.startedAt), now) }));
  return { ...draft, events: [...draft.events, ...clamped] };
}

/** Nom par défaut ; la date de création est affichée à part dans la liste. */
export function defaultWorkflowName(origin: string): string {
  return `Procédure sur ${hostLabel(origin)}`;
}
