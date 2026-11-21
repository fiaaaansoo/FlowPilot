import type { RecoveryStrategy } from '@flowpilot/shared';

/** How an AI recovery found the element, in the panel's words. */
export const RECOVERY_STRATEGY_LABEL: Record<RecoveryStrategy, string> = {
  memory: 'correction mémorisée',
  semantic: 'correspondance sémantique',
  llm: 'modèle de langage',
  none: 'aucune',
};
