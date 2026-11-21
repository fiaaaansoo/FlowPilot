import { describe, expect, it } from 'vitest';
import { WORKFLOW_SCHEMA_VERSION, parseWorkflow } from './workflow.js';

const valid = {
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  id: 'wf-1',
  name: 'Recherche développeur',
  origin: 'http://localhost:5173',
  createdAt: '2026-11-21T10:00:00.000Z',
  steps: [{ id: 's-1', kind: 'navigate', url: 'http://localhost:5173/' }],
};

describe('parseWorkflow', () => {
  it('accepte un workflow v1 valide', () => {
    expect(parseWorkflow(valid)).toEqual({ ok: true, value: valid });
  });

  it('accepte un workflow sans étape', () => {
    expect(parseWorkflow({ ...valid, steps: [] }).ok).toBe(true);
  });

  it('ignore les champs inconnus (pas de fuite dans l’objet typé)', () => {
    const result = parseWorkflow({ ...valid, injected: '<script>' });
    expect(result.ok && 'injected' in result.value).toBe(false);
  });

  it.each([
    ['non objet', 'texte'],
    ['version inconnue', { ...valid, schemaVersion: 99 }],
    ['id manquant', { ...valid, id: '' }],
    ['date invalide', { ...valid, createdAt: 'hier' }],
    ['étapes absentes', { ...valid, steps: undefined }],
    ['type d’étape inconnu', { ...valid, steps: [{ id: 's', kind: 'eval', code: 'alert(1)' }] }],
    ['URL non http(s)', { ...valid, steps: [{ id: 's', kind: 'navigate', url: 'javascript:alert(1)' }] }],
  ])('rejette : %s', (_label, raw) => {
    const result = parseWorkflow(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_WORKFLOW');
  });
});
