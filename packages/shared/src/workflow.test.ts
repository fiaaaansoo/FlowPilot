import { describe, expect, it } from 'vitest';
import { WORKFLOW_SCHEMA_VERSION, describeStep, needsHuman, parseWorkflow, type ElementTarget, type WorkflowStep } from './workflow.js';

const target: ElementTarget = {
  tag: 'button',
  role: 'button',
  name: 'Rechercher',
  attributes: { type: 'submit' },
  css: 'form > button',
};

const valid = {
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  id: 'wf-1',
  name: 'Recherche développeur',
  origin: 'http://localhost:5173',
  createdAt: '2026-11-21T10:00:00.000Z',
  steps: [
    { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
    { id: 's2', kind: 'input', target: { ...target, tag: 'input', role: 'textbox', name: 'Mots-clés' }, value: 'data' },
    { id: 's3', kind: 'select', target: { ...target, tag: 'select' }, value: 'Lyon', label: 'Lyon' },
    { id: 's4', kind: 'check', target: { ...target, tag: 'input' }, checked: true },
    { id: 's5', kind: 'click', target },
    { id: 's6', kind: 'waitForNavigation', url: 'http://localhost:5173/results.html?q=data' },
    { id: 's7', kind: 'manualInput', target: { ...target, tag: 'input', name: 'Mot de passe' } },
    { id: 's8', kind: 'submit', target: { ...target, tag: 'form' }, confirm: true },
  ],
};

describe('parseWorkflow', () => {
  it('accepte un workflow v2 complet', () => {
    expect(parseWorkflow(valid)).toEqual({ ok: true, value: valid });
  });

  it('migre un workflow v1 (Sprint 1) vers v2', () => {
    const v1 = { ...valid, schemaVersion: 1, steps: [{ id: 's1', kind: 'navigate', url: 'http://localhost:5173/' }] };
    expect(parseWorkflow(v1)).toEqual({ ok: true, value: { ...v1, schemaVersion: 2 } });
  });

  it('refuse des interactions dans un workflow v1', () => {
    expect(parseWorkflow({ ...valid, schemaVersion: 1 }).ok).toBe(false);
  });

  it('ignore les champs inconnus (pas de fuite dans l’objet typé)', () => {
    const result = parseWorkflow({ ...valid, injected: '<script>', steps: [{ ...valid.steps[4], onclick: 'x' }] });
    expect(result.ok && 'injected' in result.value).toBe(false);
    expect(result.ok && 'onclick' in (result.value.steps[0] ?? {})).toBe(false);
  });

  it.each([
    ['non objet', 'texte'],
    ['version inconnue', { ...valid, schemaVersion: 99 }],
    ['id manquant', { ...valid, id: '' }],
    ['date invalide', { ...valid, createdAt: 'hier' }],
    ['étapes absentes', { ...valid, steps: undefined }],
    ['type d’étape inconnu', { ...valid, steps: [{ id: 's', kind: 'eval', code: 'alert(1)' }] }],
    ['URL non http(s)', { ...valid, steps: [{ id: 's', kind: 'navigate', url: 'javascript:alert(1)' }] }],
    ['cible sans CSS', { ...valid, steps: [{ id: 's', kind: 'click', target: { ...target, css: '' } }] }],
    ['balise invalide', { ...valid, steps: [{ id: 's', kind: 'click', target: { ...target, tag: '<img>' } }] }],
    ['valeur non textuelle', { ...valid, steps: [{ id: 's', kind: 'input', target, value: 42 }] }],
    ['valeur trop longue', { ...valid, steps: [{ id: 's', kind: 'input', target, value: 'x'.repeat(5_000) }] }],
    ['case sans état', { ...valid, steps: [{ id: 's', kind: 'check', target }] }],
    ['attribut au nom invalide', { ...valid, steps: [{ id: 's', kind: 'click', target: { ...target, attributes: { 'on click': 'x' } } }] }],
  ])('rejette : %s', (_label, raw) => {
    const result = parseWorkflow(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_WORKFLOW');
  });
});

describe('describeStep / needsHuman', () => {
  it('décrit chaque étape en français lisible', () => {
    const steps = valid.steps as WorkflowStep[];
    expect(steps.map(describeStep)).toEqual([
      'Ouvrir /',
      'Saisir « data » dans « Mots-clés »',
      'Choisir « Lyon » dans « Rechercher »',
      'Cocher « Rechercher »',
      'Cliquer sur « Rechercher »',
      'Attendre la page /results.html?q=data',
      'Saisie manuelle dans « Mot de passe » (champ sensible, non enregistré)',
      'Valider le formulaire « Rechercher »',
    ]);
  });

  it('signale les étapes qui exigent un humain', () => {
    expect((valid.steps as WorkflowStep[]).map(needsHuman)).toEqual([false, false, false, false, false, false, true, true]);
  });
});
