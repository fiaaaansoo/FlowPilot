import { describe, expect, it } from 'vitest';
import { parseConfig } from './configs';

describe('evaluation configurations', () => {
  it('deterministic runs without any backend', () => {
    expect(parseConfig('deterministic')).toMatchObject({ mode: 'deterministic', provider: null, backendEnv: null, model: null });
  });

  it('semantic uses the service without a model and without memory', () => {
    expect(parseConfig('semantic').backendEnv).toMatchObject({ FLOWPILOT_PROVIDER: 'none', FLOWPILOT_MEMORY: 'off' });
  });

  it('llm and llm-memory differ only by memory', () => {
    const plain = parseConfig('llm:qwen2.5:3b');
    const memory = parseConfig('llm-memory:qwen2.5:3b');
    expect(plain.model).toBe('qwen2.5:3b');
    expect({ ...plain.backendEnv, FLOWPILOT_MEMORY: 'x' }).toEqual({ ...memory.backendEnv, FLOWPILOT_MEMORY: 'x' });
    expect([plain.backendEnv?.FLOWPILOT_MEMORY, memory.backendEnv?.FLOWPILOT_MEMORY]).toEqual(['off', 'on']);
  });

  it('context strategies and prompt versions are explicit', () => {
    expect(parseConfig('llm:qwen2.5:7b@extended#v2')).toMatchObject({
      contextStrategy: 'extended',
      promptVersion: 'recovery-v2',
      numCtx: 8192,
      backendEnv: { FLOWPILOT_CONTEXT_MAX_ELEMENTS: '80', FLOWPILOT_PROMPT_VERSION: 'recovery-v2' },
    });
    expect(parseConfig('llm:llama3.2:3b@unranked').backendEnv).toMatchObject({ FLOWPILOT_CONTEXT_RANKING: 'off' });
  });

  it.each(['llm', 'semantic:qwen2.5:3b', 'llm:m@huge', 'llm:m#v9', 'magic'])('rejects %s', (spec) => {
    expect(() => parseConfig(spec)).toThrow();
  });
});
