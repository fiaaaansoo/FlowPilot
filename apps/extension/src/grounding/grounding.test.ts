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

describe('boutons identiques d’une liste (aucun arbitrage par la position)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="alerts">
        <li>data, Chaque jour <button type="button">Supprimer l’alerte</button></li>
        <li>qa, Chaque semaine <button type="button">Supprimer l’alerte</button></li>
      </ul>`;
  });

  const second = () => describeElement($('#alerts li:nth-of-type(2) button'));

  it('enregistre la ligne comme contexte et la retrouve après insertion d’une ligne au-dessus', () => {
    const target = second();
    expect(target.context).toBe('qa, Chaque semaine Supprimer l’alerte');
    $('#alerts').insertAdjacentHTML('afterbegin', '<li>react, Chaque jour <button type="button">Supprimer l’alerte</button></li>');
    const result = resolveTarget(target);
    expect(result.ok && result.value.strategy).toBe('context');
    expect(result.ok && result.value.element.parentElement?.textContent).toContain('qa, Chaque semaine');
  });

  it('sans contexte, refuse même si le sélecteur CSS désigne un seul élément', () => {
    const { context: _context, ...target } = second();
    expect(document.querySelectorAll(target.css)).toHaveLength(1);
    expect(resolveTarget(target)).toMatchObject({ ok: false, error: { code: 'TARGET_AMBIGUOUS' } });
  });

  it('ne clique pas sur l’élément qui a pris la place d’une ligne supprimée', () => {
    const target = second();
    $('#alerts li:nth-of-type(2)').remove();
    $('#alerts').insertAdjacentHTML('beforeend', '<li>java, Chaque jour <button type="button">Supprimer l’alerte</button></li>');
    expect(resolveTarget(target)).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });
  });

  it('indices forts obsolètes : introuvable plutôt que l’élément à la même position', () => {
    document.body.innerHTML = '<div><button type="button">Valider</button></div>';
    const target = describeElement($('button'));
    $('button').textContent = 'Annuler';
    expect(document.querySelectorAll(target.css)).toHaveLength(1);
    expect(resolveTarget(target)).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });
  });
});

describe('liens relatifs', () => {
  it('retrouve un lien sans nom par son href relatif', () => {
    document.body.innerHTML = '<nav><a href="offer.html?id=a"><img alt=""></a><a href="offer.html?id=b"><img alt=""></a></nav>';
    const target = describeElement($('a[href="offer.html?id=b"]'));
    expect(target.attributes.href).toBe('offer.html?id=b');
    const result = resolveTarget(target);
    expect(result.ok && result.value.element.getAttribute('href')).toBe('offer.html?id=b');
  });
});

describe('confidentialité des descriptions', () => {
  it('retire les jetons des liens enregistrés', () => {
    document.body.innerHTML = '<a href="/reset?token=s3cr3t&lang=fr">Réinitialiser</a><a href="https://x.fr/cb#access_token=abc">OAuth</a>';
    const [reset, oauth] = Array.from(document.querySelectorAll('a'), (a) => describeElement(a).attributes.href);
    // Lien porteur de secret : stocké sous sa forme absolue assainie.
    expect(reset).toMatch(/\/reset\?lang=fr$/);
    expect(reset).not.toContain('s3cr3t');
    expect(oauth).toBe('https://x.fr/cb');
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

describe('waitForTarget — adaptive settle (Sprint 4)', () => {
  const missing = { tag: 'button', name: 'Absent', role: 'button', attributes: {}, css: '#absent' };
  const late = { tag: 'button', role: 'button', name: 'Tardif', attributes: { id: 'tardif' }, css: '#tardif' };
  const insertLate = () => document.body.insertAdjacentHTML('beforeend', '<button id="tardif">Tardif</button>');

  it('gives up early once the page is settled (no DOM change, no loading indicator)', async () => {
    const started = Date.now();
    const result = await waitForTarget(missing, 3_000, document, 10, undefined, 100);
    expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps waiting while the DOM keeps changing', async () => {
    const ticker = setInterval(() => document.body.insertAdjacentHTML('beforeend', '<span>…</span>'), 30);
    setTimeout(() => {
      clearInterval(ticker);
      insertLate();
    }, 400);
    const result = await waitForTarget(late, 3_000, document, 10, undefined, 100);
    clearInterval(ticker);
    expect(result.ok).toBe(true);
  });

  it('keeps waiting while a loading indicator is shown', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="spinner" aria-busy="true">Chargement…</div>');
    setTimeout(() => {
      document.getElementById('spinner')?.remove();
      insertLate();
    }, 400);
    const result = await waitForTarget(late, 3_000, document, 10, undefined, 100);
    expect(result.ok).toBe(true);
  });

  it('documents the trade-off: an element added after a silent pause longer than the settle window is missed', async () => {
    setTimeout(insertLate, 500);
    const result = await waitForTarget(late, 3_000, document, 10, undefined, 100);
    expect(result.ok).toBe(false);
  });

  it('settle 0 keeps the legacy behaviour (waits up to the timeout)', async () => {
    setTimeout(insertLate, 300);
    const result = await waitForTarget(late, 3_000, document, 10, undefined, 0);
    expect(result.ok).toBe(true);
  });
});

