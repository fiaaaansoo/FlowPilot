/**
 * Résultat explicite plutôt qu'exceptions pour les erreurs attendues
 * (transition invalide, workflow corrompu, page non autorisée...).
 */
export type Result<T, E = FlowPilotError> = { ok: true; value: T } | { ok: false; error: E };

export const ERROR_CODES = [
  'NO_ACTIVE_TAB',
  'UNSUPPORTED_PAGE',
  'ORIGIN_NOT_ALLOWED',
  'INJECTION_FAILED',
  'CONTENT_UNREACHABLE',
  'INVALID_TRANSITION',
  'WORKFLOW_NOT_FOUND',
  'INVALID_WORKFLOW',
  'NAVIGATION_FAILED',
  /** Aucune stratégie de grounding ne trouve la cible (après attente). */
  'TARGET_NOT_FOUND',
  /** Plusieurs éléments correspondent, ou deux stratégies désignent des éléments différents. */
  'TARGET_AMBIGUOUS',
  /** Cible trouvée mais masquée ou désactivée. */
  'TARGET_NOT_INTERACTABLE',
  /** L'action a été exécutée mais son effet attendu n'est pas constaté. */
  'VERIFICATION_FAILED',
  /** La page juge l'élément résolu irréversible alors que l'étape n'a pas été confirmée. */
  'CONFIRMATION_REQUIRED',
  'UNKNOWN_COMMAND',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);
export const isErrorCode = (value: unknown): value is ErrorCode => typeof value === 'string' && ERROR_CODE_SET.has(value);

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
