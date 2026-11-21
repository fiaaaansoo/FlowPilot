import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performByRef } from '../executor/perform';
import { observePage, resetSnapshot, resolveRef } from './observe';

beforeEach(() => {
  resetSnapshot();
  document.body.innerHTML = `
    <form aria-label="Recherche">
      <label for="q">Mots-clés</label><input id="q" name="q" value="déjà tapé" />
      <label for="pwd">Mot de passe</label><input id="pwd" type="password" value="s3cr3t" />
      <button type="submit">Trouver des offres</button>
    </form>
    <ul><li>data, Chaque jour <button type="button">Supprimer l’alerte</button></li></ul>
    <a href="https://evil.example/collect">Partenaire</a>
    <button hidden>Caché</button>
  `;
  Element.prototype.scrollIntoView = vi.fn();
});

let seq = 0;
const ids = () => `snap-${++seq}`;

describe('observePage', () => {
  it('lists visible interactive elements with roles, names and context, never values or sensitive fields', () => {
    const observation = observePage(document, ids);
    const names = observation.elements.map((e) => e.name);
    expect(names).toContain('Trouver des offres');
    expect(names).toContain('Mots-clés');
    expect(names).not.toContain('Mot de passe');
    expect(names).not.toContain('Caché');
    expect(JSON.stringify(observation)).not.toMatch(/s3cr3t|déjà tapé/);

    const submit = observation.elements.find((e) => e.name === 'Trouver des offres');
    expect(submit).toMatchObject({ tag: 'button', role: 'button', section: 'Recherche' });
    const remove = observation.elements.find((e) => e.name === 'Supprimer l’alerte');
    expect(remove).toMatchObject({ context: 'data, Chaque jour Supprimer l’alerte', irreversible: true });
    expect(observation.elements.find((e) => e.name === 'Partenaire')).toMatchObject({ sameOrigin: false });
  });
});

describe('resolveRef / performByRef', () => {
  const refOf = (name: string) => observePage(document, ids).elements.find((e) => e.name === name)?.ref ?? '';

  it('executes the recorded action on the observed element', () => {
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')?.addEventListener('submit', clicked);
    const ref = refOf('Trouver des offres');
    const result = performByRef({ id: 's', kind: 'click', target: { tag: 'button', attributes: {}, css: 'x' } }, `snap-${seq}`, ref, {
      confirmed: false,
    });
    expect(result).toMatchObject({ ok: true, value: { strategy: 'ai' } });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('rejects stale proposals: other snapshot, element removed, or identity changed', () => {
    const ref = refOf('Trouver des offres');
    const snapshotId = `snap-${seq}`;
    expect(resolveRef('snap-old', ref).ok).toBe(false);

    const button = document.querySelector('form button');
    if (button) button.textContent = 'Supprimer mon compte';
    expect(resolveRef(snapshotId, ref)).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });

    button?.remove();
    expect(resolveRef(snapshotId, ref).ok).toBe(false);
  });

  it('still requires a human for an irreversible element, even when proposed by recovery', () => {
    const ref = refOf('Supprimer l’alerte');
    const step = { id: 's', kind: 'click' as const, target: { tag: 'button', attributes: {}, css: 'x' } };
    expect(performByRef(step, `snap-${seq}`, ref, { confirmed: false })).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(performByRef(step, `snap-${seq}`, ref, { confirmed: true }).ok).toBe(true);
  });
});

describe('review regressions', () => {
  it('never sends prefilled textarea content, option texts or scripts through an element text', () => {
    document.body.innerHTML = `
      <form aria-label="Note">
        <textarea name="note">brouillon confidentiel</textarea>
        <select name="choix"><option>option secrète</option></select>
        <script>var token = "abc123";</script>
        <button type="submit">Envoyer la note</button>
      </form>`;
    const serialized = JSON.stringify(observePage(document, ids));
    expect(serialized).not.toMatch(/brouillon confidentiel|option secrète|abc123/);
  });

  it('Enter in a field of a destructive form still needs a human', () => {
    document.body.innerHTML = `
      <form aria-label="Compte"><input name="motif" aria-label="Motif" /><button type="submit">Supprimer mon compte</button></form>`;
    const motif = observePage(document, ids).elements.find((e) => e.name === 'Motif');
    expect(motif?.irreversible).toBe(true); // flagged up front: Enter there submits the destructive form
    const ref = motif?.ref ?? '';
    const step = { id: 's', kind: 'press' as const, key: 'Enter' as const, target: { tag: 'input', attributes: {}, css: 'x' } };
    expect(performByRef(step, `snap-${seq}`, ref, { confirmed: false })).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
  });

  it('never reads what was typed in a rich-text editor', () => {
    document.body.innerHTML = `
      <ul><li><div role="textbox" contenteditable="true" aria-label="Message">Mon message privé : code 4821</div>
      <button type="button">Envoyer plus tard</button></li></ul>`;
    expect(JSON.stringify(observePage(document, ids))).not.toMatch(/4821|privé/);
  });

  it('flags forms that send data off-origin and skips hidden forms', () => {
    document.body.innerHTML = `
      <form action="https://evil.example/collect"><button type="submit">Rechercher</button></form>
      <form hidden aria-label="Caché"><button type="submit">Valider</button></form>`;
    const elements = observePage(document, ids).elements;
    expect(elements.find((e) => e.name === 'Rechercher')).toMatchObject({ sameOrigin: false });
    expect(elements.some((e) => e.name === 'Caché' || e.name === 'Valider')).toBe(false);
  });
});


describe('cross-origin submissions (Sprint 4)', () => {
  const step = (kind: 'click' | 'press') =>
    kind === 'press'
      ? { id: 's', kind: 'press' as const, key: 'Enter' as const, target: { tag: 'input', attributes: {}, css: 'x' } }
      : { id: 's', kind: 'click' as const, target: { tag: 'button', attributes: {}, css: 'x' } };

  beforeEach(() => {
    document.body.innerHTML = `
      <form action="https://evil.example/collect" aria-label="Recherche">
        <input aria-label="Mots-clés" /><button type="button">Aide</button><button type="submit">Rechercher</button>
      </form>`;
  });

  it('a submit control or Enter that would send the form to another site needs a human', () => {
    const elements = observePage(document, ids).elements;
    const ref = (name: string) => elements.find((e) => e.name === name)?.ref ?? '';
    expect(performByRef(step('click'), `snap-${seq}`, ref('Rechercher'), { confirmed: false })).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(performByRef(step('press'), `snap-${seq}`, ref('Mots-clés'), { confirmed: false })).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
  });

  it('names the destination, and also catches a field linked to the form by form="id"', () => {
    document.body.innerHTML = `
      <form id="far" action="https://evil.example/collect"></form>
      <input aria-label="Ville" form="far" />`;
    const ref = observePage(document, ids).elements.find((e) => e.name === 'Ville')?.ref ?? '';
    const result = performByRef(step('press'), `snap-${seq}`, ref, { confirmed: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(result.ok ? '' : result.error.message).toContain('https://evil.example');
  });

  it('a plain button inside that form submits nothing and is not gated', () => {
    const ref = observePage(document, ids).elements.find((e) => e.name === 'Aide')?.ref ?? '';
    expect(performByRef(step('click'), `snap-${seq}`, ref, { confirmed: false }).ok).toBe(true);
  });
});
