import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeElement } from '../grounding/dom';
import { performStep } from './perform';

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;
const opts = { timeoutMs: 100, confirmed: false };

beforeEach(() => {
  document.body.innerHTML = `
    <form id="f">
      <label for="q">Mots-clés</label><input id="q" name="q" />
      <label><input type="checkbox" name="cdi" value="CDI" /> CDI</label>
      <select id="ville" name="ville"><option value="">Toutes</option><option value="Lyon">Lyon</option></select>
      <label for="pwd">Mot de passe</label><input id="pwd" type="password" />
      <button type="submit">Rechercher</button>
      <button type="button" disabled>Bloqué</button>
    </form>
  `;
  Element.prototype.scrollIntoView = vi.fn();
});

describe('performStep', () => {
  it('saisit une valeur et déclenche input puis change', async () => {
    const input = $<HTMLInputElement>('#q');
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));
    const result = await performStep({ id: 's', kind: 'input', target: describeElement(input), value: 'data' }, opts);
    expect(result).toMatchObject({ ok: true });
    expect(input.value).toBe('data');
    expect(seen).toEqual(['input', 'change']);
  });

  it('coche une case et choisit une option, puis vérifie l’effet', async () => {
    const box = $<HTMLInputElement>('input[name="cdi"]');
    expect(await performStep({ id: 's', kind: 'check', target: describeElement(box), checked: true }, opts)).toMatchObject({ ok: true });
    expect(box.checked).toBe(true);
    const select = $<HTMLSelectElement>('#ville');
    expect(await performStep({ id: 's', kind: 'select', target: describeElement(select), value: 'Lyon' }, opts)).toMatchObject({ ok: true });
    expect(select.value).toBe('Lyon');
  });

  it('signale une option disparue', async () => {
    const select = $<HTMLSelectElement>('#ville');
    const result = await performStep({ id: 's', kind: 'select', target: describeElement(select), value: 'Paris' }, opts);
    expect(result).toMatchObject({ ok: false, error: { code: 'VERIFICATION_FAILED' } });
  });

  it('clique et soumet', async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    $('#f').addEventListener('submit', onSubmit);
    expect(await performStep({ id: 's', kind: 'click', target: describeElement($('button[type="submit"]')) }, opts)).toMatchObject({ ok: true });
    expect(await performStep({ id: 's', kind: 'submit', target: describeElement($('#f')) }, opts)).toMatchObject({ ok: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('refuse une cible désactivée', async () => {
    const result = await performStep({ id: 's', kind: 'click', target: describeElement($('button[disabled]')) }, opts);
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_INTERACTABLE' } });
  });

  it('saisie manuelle : vérifie que l’humain a rempli le champ, sans rien écrire', async () => {
    const pwd = $<HTMLInputElement>('#pwd');
    const step = { id: 's', kind: 'manualInput' as const, target: describeElement(pwd) };
    expect(await performStep(step, opts)).toMatchObject({ ok: false, error: { code: 'VERIFICATION_FAILED' } });
    pwd.value = 'tapé par l’humain';
    expect(await performStep(step, opts)).toMatchObject({ ok: true });
    expect(pwd.value).toBe('tapé par l’humain');
  });

  it('refuse une action jugée irréversible sur l’élément trouvé tant qu’elle n’est pas confirmée', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button type="button" id="pay">Payez maintenant</button>');
    const clicked = vi.fn();
    $('#pay').addEventListener('click', clicked);
    const step = { id: 's', kind: 'click' as const, target: describeElement($('#pay')) };
    expect(await performStep(step, opts)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(clicked).not.toHaveBeenCalled();
    expect(await performStep(step, { ...opts, confirmed: true })).toMatchObject({ ok: true });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('abandonne sans agir si le replay est arrêté pendant l’attente de l’élément', async () => {
    const abort = new AbortController();
    const late = vi.fn();
    const pending = performStep(
      { id: 's', kind: 'click', target: { tag: 'button', role: 'button', name: 'Tardif', attributes: { id: 'tardif' }, css: '#tardif' } },
      { timeoutMs: 2_000, confirmed: false, signal: abort.signal },
    );
    abort.abort();
    document.body.insertAdjacentHTML('beforeend', '<button id="tardif">Tardif</button>');
    $('#tardif').addEventListener('click', late);
    expect(await pending).toMatchObject({ ok: false });
    expect(late).not.toHaveBeenCalled();
  });

  it('répond avant un clic qui peut décharger la page', async () => {
    const order: string[] = [];
    $('button[type="submit"]').addEventListener('click', (event) => {
      event.preventDefault();
      order.push('click');
    });
    await performStep(
      { id: 's', kind: 'click', target: describeElement($('button[type="submit"]')) },
      { ...opts, beforeLeavingAction: () => order.push('ack') },
    );
    expect(order).toEqual(['ack', 'click']);
  });

  it('transmet Entrée aux scripts de la page', async () => {
    const keys: string[] = [];
    $('#q').addEventListener('keydown', (event: KeyboardEvent) => keys.push(event.key));
    expect(await performStep({ id: 's', kind: 'press', key: 'Enter', target: describeElement($('#q')) }, opts)).toMatchObject({ ok: true });
    expect(keys).toEqual(['Enter']);
  });
});
