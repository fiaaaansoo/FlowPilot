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
