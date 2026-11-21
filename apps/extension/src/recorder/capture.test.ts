import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecordedEvent } from '@flowpilot/shared';
import { InteractionCapture } from './capture';
import { isIrreversibleAction, isSensitiveField } from './classify';

/**
 * jsdom ne produit que des événements `isTrusted: false` (non redéfinissable).
 * Les tests marquent les « gestes réels » simulés ; les autres restent non fiables.
 */
const TRUSTED = new WeakSet<Event>();
function trusted<E extends Event>(event: E): E {
  TRUSTED.add(event);
  return event;
}

const click = (el: Element) => el.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, cancelable: true })));
const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(trusted(new Event('input', { bubbles: true })));
};
const change = (el: Element) => el.dispatchEvent(trusted(new Event('change', { bubbles: true })));

let events: RecordedEvent[];
let capture: InteractionCapture;
let clock = 0;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;

beforeEach(() => {
  document.body.innerHTML = `
    <form id="search">
      <label for="q">Mots-clés</label><input id="q" name="q" type="text" />
      <label><input type="checkbox" name="cdi" value="CDI" /> CDI</label>
      <select name="ville"><option value="">Toutes</option><option value="Lyon">Lyon</option></select>
      <button type="submit">Rechercher</button>
    </form>
    <form id="login">
      <label for="pwd">Mot de passe</label><input id="pwd" type="password" />
      <label for="card">Numéro de carte</label><input id="card" autocomplete="cc-number" />
      <div data-flowpilot-sensitive><label for="note">Note</label><input id="note" /></div>
      <button type="submit">Payer</button>
    </form>
    <p id="texte">Du texte sans action</p>
  `;
  events = [];
  clock = 0;
  capture = new InteractionCapture(document, (event) => events.push(event), () => ++clock, (event) => TRUSTED.has(event));
  capture.start();
});

afterEach(() => {
  capture.stop();
});

describe('InteractionCapture', () => {
  it('enregistre saisie, case, liste et clic dans l’ordre', () => {
    type($('#q'), 'data');
    change($('#q'));
    const box = $<HTMLInputElement>('input[name="cdi"]');
    box.checked = true;
    change(box);
    const select = $<HTMLSelectElement>('select');
    select.value = 'Lyon';
    change(select);
    click($('#search button'));
    expect(events.map((e) => e.kind)).toEqual(['input', 'check', 'select', 'click']);
    expect(events[0]).toMatchObject({ kind: 'input', value: 'data', target: { name: 'Mots-clés' } });
    expect(events[1]).toMatchObject({ kind: 'check', checked: true });
    expect(events[2]).toMatchObject({ kind: 'select', value: 'Lyon', label: 'Lyon' });
    expect(events[3]).toMatchObject({ kind: 'click', target: { name: 'Rechercher' } });
  });

  it('ignore les événements fabriqués par la page (isTrusted false)', () => {
    $('#search button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(events).toEqual([]);
  });

  it('ignore les clics de mise au focus, sur une case ou son label, et hors élément interactif', () => {
    click($('#q'));
    click($('label[for="q"]'));
    click($('input[name="cdi"]'));
    click($('#texte'));
    expect(events).toEqual([]);
  });

  it('vide une saisie non validée avant un clic qui peut quitter la page', () => {
    type($('#q'), 'en cours');
    click($('#search button'));
    expect(events.map((e) => e.kind)).toEqual(['input', 'click']);
  });

  it('renvoie les saisies en attente à l’arrêt', () => {
    type($('#q'), 'pas validé');
    expect(capture.stop()).toMatchObject([{ kind: 'input', value: 'pas validé' }]);
  });

  it('ne lit jamais la valeur d’un champ sensible : étape de saisie manuelle', () => {
    for (const selector of ['#pwd', '#card', '#note']) {
      type($(selector), '4111 1111 1111 1111');
      change($(selector));
    }
    expect(events.map((e) => e.kind)).toEqual(['manualInput', 'manualInput', 'manualInput']);
    expect(JSON.stringify(events)).not.toContain('4111');
  });

  it('marque les actions irréversibles pour confirmation au replay', () => {
    click($('#login button'));
    expect(events[0]).toMatchObject({ kind: 'click', confirm: true });
    click($('#search button'));
    expect(events[1]).not.toHaveProperty('confirm');
  });

  it('enregistre une soumission par Entrée seulement sans bouton déclencheur', () => {
    const form = $<HTMLFormElement>('#search');
    form.dispatchEvent(trusted(new SubmitEvent('submit', { bubbles: true, submitter: null })));
    form.dispatchEvent(trusted(new SubmitEvent('submit', { bubbles: true, submitter: $('#search button') })));
    expect(events.map((e) => e.kind)).toEqual(['submit']);
  });

  it('n’écoute plus rien après l’arrêt', () => {
    capture.stop();
    click($('#search button'));
    expect(events).toEqual([]);
  });
});

describe('classement', () => {
  it.each([
    ['<input type="password">', true],
    ['<input autocomplete="one-time-code">', true],
    ['<input name="iban">', true],
    ['<input placeholder="Code de vérification">', true],
    ['<input aria-label="CVV">', true],
    ['<input name="q" placeholder="Rechercher">', false],
    ['<input name="email" type="email">', false],
  ])('%s sensible : %s', (html, expected) => {
    document.body.innerHTML = html;
    expect(isSensitiveField(document.body.firstElementChild as Element)).toBe(expected);
  });

  it.each([
    ['<button>Envoyer la candidature</button>', true],
    ['<button>Supprimer l’alerte</button>', true],
    ['<button>Payer 30 €</button>', true],
    ['<button>Rechercher</button>', false],
    ['<a href="/x">Voir l’offre</a>', false],
  ])('%s irréversible : %s', (html, expected) => {
    document.body.innerHTML = html;
    expect(isIrreversibleAction(document.body.firstElementChild as Element)).toBe(expected);
  });
});
