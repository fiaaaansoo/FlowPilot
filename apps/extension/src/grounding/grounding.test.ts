import { beforeEach, describe, expect, it } from 'vitest';
import { accessibleName, describeElement, isStableId, roleOf, uniqueSelector } from './dom';
import { resolveTarget, waitForTarget } from './resolve';

const $ = <T extends Element = HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`fixture : ${selector} introuvable`);
  return el;
};

beforeEach(() => {
  document.body.innerHTML = `
    <form id="search">
      <label for="q">Mots-clés</label><input id="q" name="q" type="search" />
      <label class="choice"><input type="checkbox" name="contrat" value="CDI" /> CDI</label>
      <label class="choice"><input type="checkbox" name="contrat" value="CDD" /> CDD</label>
      <select id="ville" name="ville"><option value="">Toutes</option><option>Lyon</option></select>
      <button type="submit">Rechercher</button>
    </form>
    <ul>
      <li><h2><a href="/offer.html?id=a">Développeur</a></h2><button aria-label="Sauvegarder Développeur">Sauvegarder</button></li>
      <li><h2><a href="/offer.html?id=b">Data engineer</a></h2><button aria-label="Sauvegarder Data engineer">Sauvegarder</button></li>
    </ul>
    <div hidden><button data-testid="cache">Caché</button></div>
    <button id=":r1:">Généré</button>
  `;
});

describe('lecture du DOM', () => {
  it('calcule rôle et nom accessibles', () => {
    expect(roleOf($('#q'))).toBe('searchbox');
    expect(accessibleName($('#q'))).toBe('Mots-clés');
    expect(accessibleName($('input[value="CDI"]'))).toBe('CDI');
    expect(roleOf($('#ville'))).toBe('combobox');
    expect(accessibleName($('a'))).toBe('Développeur');
    expect(accessibleName($('li button'))).toBe('Sauvegarder Développeur');
  });

  it('écarte les ids générés par les frameworks', () => {
    expect(isStableId('search')).toBe(true);
    expect(isStableId(':r1:')).toBe(false);
    expect(isStableId('ember1234')).toBe(false);
    expect(isStableId('a1b2c3d4e5f6')).toBe(false);
  });

  it('produit un sélecteur CSS unique', () => {
    const second = $('li:nth-of-type(2) button');
    const selector = uniqueSelector(second);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(second);
    expect(uniqueSelector($('#q'))).toBe('#q');
  });

  it('décrit un champ sans jamais lire sa valeur', () => {
    const input = $<HTMLInputElement>('#q');
    input.value = 'secret tapé';
    const target = describeElement(input);
    expect(JSON.stringify(target)).not.toContain('secret tapé');
    expect(target).toMatchObject({ tag: 'input', role: 'searchbox', name: 'Mots-clés', attributes: { id: 'q', name: 'q', type: 'search' } });
  });

  it('garde la valeur d’une case à cocher, discriminante', () => {
    expect(describeElement($('input[value="CDD"]')).attributes).toMatchObject({ name: 'contrat', type: 'checkbox', value: 'CDD' });
  });
});

describe('resolveTarget', () => {
  it('retrouve chaque élément enregistré', () => {
    for (const selector of ['#q', 'input[value="CDD"]', '#ville', 'form button', 'li:nth-of-type(2) button', 'li:nth-of-type(1) a']) {
      const el = $(selector);
      const result = resolveTarget(describeElement(el));
      expect(result.ok && result.value.element).toBe(el);
    }
  });

  it('survit à un sélecteur CSS devenu faux (liste réordonnée)', () => {
    const target = describeElement($('li:nth-of-type(2) button'));
    const list = $('ul');
    list.prepend($('li:nth-of-type(2)'));
    const result = resolveTarget(target);
    expect(result.ok && accessibleName(result.value.element)).toBe('Sauvegarder Data engineer');
  });

  it('refuse une cible ambiguë (seul le texte est connu)', () => {
    const result = resolveTarget({ tag: 'button', text: 'Sauvegarder', attributes: {}, css: 'ul button' });
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_AMBIGUOUS' } });
  });

  it('refuse quand deux indices forts désignent des éléments différents', () => {
    const target = describeElement($('li:nth-of-type(1) button'));
    // L'id pointe désormais sur l'autre bouton : conflit, pas de choix arbitraire.
    $('li:nth-of-type(2) button').id = 'favori';
    const result = resolveTarget({ ...target, attributes: { ...target.attributes, id: 'favori' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_AMBIGUOUS' } });
  });

  it('distingue introuvable et masqué', () => {
    expect(resolveTarget({ tag: 'button', name: 'Absent', role: 'button', attributes: {}, css: '#absent' })).toMatchObject({
      ok: false,
      error: { code: 'TARGET_NOT_FOUND' },
    });
    expect(resolveTarget({ tag: 'button', attributes: { 'data-testid': 'cache' }, css: '[data-testid="cache"]' })).toMatchObject({
      ok: false,
      error: { code: 'TARGET_NOT_INTERACTABLE' },
    });
  });

  it('n’est pas piégé par des caractères spéciaux dans les indices', () => {
    const result = resolveTarget({ tag: 'button', name: 'a"]; *', attributes: { name: '"]; *' }, css: '[[[' });
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });
  });
});

describe('waitForTarget', () => {
  it('attend un élément rendu en différé', async () => {
    setTimeout(() => {
      document.body.insertAdjacentHTML('beforeend', '<button id="tard">Plus tard</button>');
    }, 50);
    const result = await waitForTarget({ tag: 'button', role: 'button', name: 'Plus tard', attributes: { id: 'tard' }, css: '#tard' }, 1000, document, 10);
    expect(result.ok).toBe(true);
  });

  it('abandonne après le délai', async () => {
    const result = await waitForTarget({ tag: 'button', name: 'Jamais', role: 'button', attributes: {}, css: '#jamais' }, 30, document, 10);
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });
  });
});
