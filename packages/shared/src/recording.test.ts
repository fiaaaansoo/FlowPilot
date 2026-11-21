import { describe, expect, it } from 'vitest';
import { compileSteps, parseRecordedEvent, parseRecordingDraft, workflowFromDraft, type DraftEvent } from './recording.js';
import type { ElementTarget } from './workflow.js';

const t = (name: string, css = `#${name}`): ElementTarget => ({ tag: 'button', name, attributes: {}, css });
const START = 'http://localhost:5173/';

const compile = (events: DraftEvent[]) => compileSteps({ startUrl: START, startedAt: 0, events });
const kinds = (events: DraftEvent[]) => compile(events).map((s) => s.kind);

describe('compileSteps', () => {
  it('commence par la page de départ, puis suit l’ordre chronologique', () => {
    const steps = compile([
      { kind: 'click', at: 300, target: t('b') },
      { kind: 'input', at: 100, target: t('q'), value: 'data' },
    ]);
    expect(steps.map((s) => s.kind)).toEqual(['navigate', 'input', 'click']);
    expect(steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('fusionne les saisies successives dans le même champ', () => {
    const steps = compile([
      { kind: 'input', at: 100, target: t('q'), value: 'd' },
      { kind: 'input', at: 200, target: t('q'), value: 'data' },
      { kind: 'input', at: 300, target: t('ville'), value: 'Lyon' },
    ]);
    expect(steps.slice(1)).toMatchObject([{ value: 'data' }, { value: 'Lyon' }]);
  });

  it('garde tous les clics, même rapprochés (deux clics sur « + » en sont deux)', () => {
    expect(kinds([{ kind: 'click', at: 100, target: t('plus') }, { kind: 'click', at: 250, target: t('plus') }])).toEqual([
      'navigate',
      'click',
      'click',
    ]);
  });

  it('relie une navigation lente à l’interaction grâce au départ de page signalé', () => {
    const steps = compile([
      { kind: 'click', at: 1_000, target: t('Envoyer') },
      { kind: 'leave', at: 1_050 },
      { kind: 'navigation', at: 9_000, url: 'http://localhost:5173/confirmation' },
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: 'waitForNavigation' });
  });

  it('un départ de page resté sans suite n’influence pas une navigation ultérieure', () => {
    const steps = compile([
      { kind: 'click', at: 1_000, target: t('Télécharger') },
      { kind: 'leave', at: 1_050 },
      { kind: 'input', at: 5_000, target: t('q'), value: 'x' },
      { kind: 'navigation', at: 120_000, url: 'http://localhost:5173/saisie' },
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: 'navigate' });
  });

  it('un départ de page sans interaction récente (URL saisie, retour) reste une navigation explicite', () => {
    const steps = compile([
      { kind: 'click', at: 1_000, target: t('x') },
      { kind: 'leave', at: 20_000 },
      { kind: 'navigation', at: 20_100, url: 'http://localhost:5173/autre' },
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: 'navigate' });
  });

  it('classe une navigation consécutive à une interaction en attente de navigation', () => {
    const steps = compile([
      { kind: 'click', at: 1_000, target: t('lien') },
      { kind: 'navigation', at: 1_200, url: 'http://localhost:5173/results.html' },
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: 'waitForNavigation', url: 'http://localhost:5173/results.html' });
  });

  it('remet la navigation après le clic même si elle est arrivée avant (course des messages)', () => {
    const steps = compile([
      { kind: 'navigation', at: 1_200, url: 'http://localhost:5173/results.html' },
      { kind: 'click', at: 1_000, target: t('lien') },
    ]);
    expect(steps.map((s) => s.kind)).toEqual(['navigate', 'click', 'waitForNavigation']);
  });

  it('classe une navigation sans interaction préalable (URL saisie) en navigate', () => {
    expect(kinds([{ kind: 'navigation', at: 10_000, url: 'http://localhost:5173/spa.html' }])).toEqual(['navigate', 'navigate']);
  });

  it('fusionne une chaîne de redirections et ignore un rechargement', () => {
    const steps = compile([
      { kind: 'click', at: 1_000, target: t('go') },
      { kind: 'navigation', at: 1_100, url: 'http://localhost:5173/a' },
      { kind: 'navigation', at: 1_300, url: 'http://localhost:5173/b' },
      { kind: 'navigation', at: 9_000, url: 'http://localhost:5173/b' },
    ]);
    expect(steps.slice(1)).toMatchObject([{ kind: 'click' }, { kind: 'waitForNavigation', url: 'http://localhost:5173/b' }]);
  });
});

describe('validation', () => {
  it('rejette un événement de la page qui se ferait passer pour une navigation', () => {
    expect(parseRecordedEvent({ kind: 'navigate', at: 1, url: 'http://x/' }).ok).toBe(false);
    expect(parseRecordedEvent({ kind: 'click', at: 1, target: t('ok') }).ok).toBe(true);
    expect(parseRecordedEvent({ kind: 'click', target: t('sans horodatage') }).ok).toBe(false);
  });

  it('relit un brouillon en ignorant les événements corrompus', () => {
    const draft = parseRecordingDraft({
      workflowId: 'w',
      origin: 'http://localhost:5173',
      startUrl: START,
      startedAt: 0,
      events: [{ kind: 'click', at: 1, target: t('ok') }, { kind: 'eval', code: 'x' }, { kind: 'navigation', at: 2, url: 'javascript:1' }],
    });
    expect(draft?.events).toHaveLength(1);
    expect(parseRecordingDraft({ workflowId: 'w' })).toBeNull();
  });

  it('construit un workflow v2 valide', () => {
    const workflow = workflowFromDraft(
      { workflowId: 'w', origin: 'http://localhost:5173', startUrl: START, startedAt: 0, events: [] },
      'Démo',
    );
    expect(workflow).toMatchObject({ schemaVersion: 2, id: 'w', name: 'Démo', steps: [{ kind: 'navigate', url: START }] });
  });
});
