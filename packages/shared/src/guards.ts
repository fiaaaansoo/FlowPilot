/** Gardes de type élémentaires pour valider les données `unknown` (stockage, messages). */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
