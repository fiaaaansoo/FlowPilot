import type { Mode } from '@flowpilot/evaluation';

/**
 * Configuration grammar: `<mode>[:<model>][@<context>][#<prompt>]`, for example
 * `deterministic`, `semantic`, `llm:qwen2.5:3b`, `llm-memory:qwen2.5:3b`,
 * `llm:qwen2.5:3b@extended`, `llm:qwen2.5:3b#v2`.
 *
 * - deterministic: AI recovery disabled (Sprint 2 engine only).
 * - semantic: recovery service without a model, memory off (semantic grounding only).
 * - llm: local model through Ollama, memory off.
 * - llm-memory: same, with the verified-correction memory on.
 */

export const CONTEXT_STRATEGIES = {
  /** A: only the few most relevant candidates. */
  minimal: { maxElements: 3, maxChars: 1_500, ranking: true, numCtx: 4096 },
  /** B: bounded ranked context (production default). */
  ranked: { maxElements: 12, maxChars: 6_000, ranking: true, numCtx: 4096 },
  /** C: many more candidates and characters. */
  extended: { maxElements: 80, maxChars: 40_000, ranking: true, numCtx: 8192 },
  /** Control: same size as B, but candidates in page order (no relevance ranking). */
  unranked: { maxElements: 12, maxChars: 6_000, ranking: false, numCtx: 4096 },
} as const;
export type ContextStrategy = keyof typeof CONTEXT_STRATEGIES;

export const PROMPTS = { v1: 'recovery-v1', v2: 'recovery-v2' } as const;

export interface EvalConfig {
  id: string;
  mode: Mode;
  provider: 'none' | 'ollama' | null;
  model: string | null;
  promptVersion: string;
  contextStrategy: ContextStrategy;
  memory: boolean;
  /** Backend environment; null when AI recovery is disabled. */
  backendEnv: Record<string, string> | null;
  numCtx: number | null;
}

const MODES: readonly Mode[] = ['deterministic', 'semantic', 'llm', 'llm-memory'];

export function parseConfig(spec: string): EvalConfig {
  const match = /^([a-z-]+)(?::([^@#]+))?(?:@([a-z]+))?(?:#(v\d))?$/.exec(spec.trim());
  if (!match) throw new Error(`Invalid configuration "${spec}"`);
  const [, rawMode = '', model, rawContext = 'ranked', rawPrompt = 'v1'] = match;
  if (!(MODES as readonly string[]).includes(rawMode)) throw new Error(`Unknown mode "${rawMode}"`);
  const mode = rawMode as Mode;
  if (!(rawContext in CONTEXT_STRATEGIES)) throw new Error(`Unknown context strategy "${rawContext}"`);
  if (!(rawPrompt in PROMPTS)) throw new Error(`Unknown prompt "${rawPrompt}"`);
  const contextStrategy = rawContext as ContextStrategy;
  const promptVersion = PROMPTS[rawPrompt as keyof typeof PROMPTS];
  const usesModel = mode === 'llm' || mode === 'llm-memory';
  if (usesModel && !model) throw new Error(`Mode "${mode}" needs a model: ${mode}:<model>`);
  if (!usesModel && model) throw new Error(`Mode "${mode}" takes no model`);
  const context = CONTEXT_STRATEGIES[contextStrategy];
  const memory = mode === 'llm-memory';
  const backendEnv =
    mode === 'deterministic'
      ? null
      : {
          FLOWPILOT_PROVIDER: usesModel ? 'ollama' : 'none',
          ...(model ? { FLOWPILOT_MODEL: model } : {}),
          FLOWPILOT_MEMORY: memory ? 'on' : 'off',
          FLOWPILOT_PROMPT_VERSION: promptVersion,
          FLOWPILOT_CONTEXT_MAX_ELEMENTS: String(context.maxElements),
          FLOWPILOT_CONTEXT_MAX_CHARS: String(context.maxChars),
          FLOWPILOT_CONTEXT_RANKING: context.ranking ? 'on' : 'off',
          FLOWPILOT_OLLAMA_NUM_CTX: String(context.numCtx),
          FLOWPILOT_OLLAMA_KEEP_ALIVE: '10m',
        };
  return {
    id: spec.trim(),
    mode,
    provider: mode === 'deterministic' ? null : usesModel ? 'ollama' : 'none',
    model: model ?? null,
    promptVersion: mode === 'deterministic' ? 'none' : promptVersion,
    contextStrategy,
    memory,
    backendEnv,
    numCtx: usesModel ? context.numCtx : null,
  };
}
