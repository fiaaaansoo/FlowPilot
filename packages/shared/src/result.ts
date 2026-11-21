/**
 * Résultat explicite plutôt qu'exceptions pour les erreurs attendues
 * (transition invalide, workflow corrompu, page non autorisée...).
 */
export type Result<T, E = FlowPilotError> = { ok: true; value: T } | { ok: false; error: E };

export type ErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'UNSUPPORTED_PAGE'
  | 'ORIGIN_NOT_ALLOWED'
  | 'INJECTION_FAILED'
  | 'CONTENT_UNREACHABLE'
  | 'INVALID_TRANSITION'
  | 'WORKFLOW_NOT_FOUND'
  | 'INVALID_WORKFLOW'
  | 'NAVIGATION_FAILED'
  | 'UNKNOWN_COMMAND'
  | 'INTERNAL';

export interface FlowPilotError {
  code: ErrorCode;
  /** Message lisible, affiché tel quel dans le Side Panel (français). */
  message: string;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const fail = (code: ErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

/** Message d'une erreur attrapée, quel que soit son type. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
