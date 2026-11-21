import { mutationArg } from './mutations';
/**
 * Mini-application monopage : routage par `history.pushState`, contenu rendu
 * en différé (simule un appel réseau), formulaires sans rechargement.
 * Sert à tester la capture et le replay des navigations SPA et des éléments
 * dynamiques. Aucune donnée ne quitte la page.
 */

type View = 'alertes' | 'connexion';

/** Délai de « chargement » de chaque vue, en ms (surchargeable : `?delai=0`). */
const DELAY = Number(new URLSearchParams(location.search).get('delai') ?? mutationArg('spa-delay') ?? 400);
/** Benchmark mutation: mark the loading placeholder as busy (a loading indicator). */
const BUSY = mutationArg('spa-busy') !== undefined;

const viewRoot = document.querySelector<HTMLDivElement>('#view');
if (!viewRoot) throw new Error('spa.html : #view introuvable');
const root: HTMLDivElement = viewRoot;

const alerts: string[] = [];

function currentView(): View {
  return new URLSearchParams(location.search).get('vue') === 'connexion' ? 'connexion' : 'alertes';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function field(label: string, input: HTMLElement): HTMLDivElement {
  const id = `f-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  input.id = id;
  return el('div', { className: 'field' }, el('label', { htmlFor: id }, label), input);
}

function renderAlerts(): HTMLElement {
  const keywords = el('input', { name: 'motscles', type: 'text', autocomplete: 'off' });
  const frequency = el(
    'select',
    { name: 'frequence' },
    el('option', { value: 'jour' }, 'Chaque jour'),
    el('option', { value: 'semaine' }, 'Chaque semaine'),
  );
  const remote = el('input', { type: 'checkbox', name: 'teletravail' });
  const submit = el('button', { type: 'submit', className: 'primary' }, 'Créer l’alerte');
  const form = el(
    'form',
    { className: 'search' },
    field('Mots-clés de l’alerte', keywords),
    field('Fréquence', frequency),
    el('label', { className: 'choice' }, remote, ' Télétravail uniquement'),
    submit,
  );
  const list = el('ul', { className: 'results', id: 'alert-list' });

  const deleteButton = (index: number) => {
    const button = el('button', { type: 'button', className: 'link' }, 'Supprimer l’alerte');
    button.addEventListener('click', () => {
      alerts.splice(index, 1);
      renderList();
    });
    return button;
  };

  const renderList = () => {
    list.replaceChildren(
      ...alerts.map((text, index) =>
        el(
          'li',
          { className: 'result' },
          el('p', {}, text),
          deleteButton(index),
        ),
      ),
    );
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = `${keywords.value || 'Toutes offres'}, ${frequency.selectedOptions[0]?.textContent ?? ''}${remote.checked ? ', télétravail' : ''}`;
    // Confirmation affichée après un délai : élément dynamique pour le replay.
    setTimeout(() => {
      alerts.push(text);
      renderList();
      root.append(el('p', { className: 'done', id: 'alert-created' }, `Alerte créée : ${text}`));
    }, DELAY);
  });

  renderList();
  return el('section', {}, el('h2', {}, 'Mes alertes'), form, list);
}

function renderLogin(): HTMLElement {
  const email = el('input', { name: 'email', type: 'email', autocomplete: 'email' });
  const password = el('input', { name: 'password', type: 'password', autocomplete: 'current-password' });
  const form = el(
    'form',
    { className: 'search' },
    field('E-mail', email),
    field('Mot de passe', password),
    el('button', { type: 'submit', className: 'primary' }, 'Se connecter'),
  );
  const status = el('p', { className: 'done', id: 'login-status', role: 'status' });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = password.value ? `Connecté en tant que ${email.value}` : 'Mot de passe manquant.';
  });
  return el('section', {}, el('h2', {}, 'Connexion'), form, status);
}

function render(): void {
  const view = currentView();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-view]')) {
    link.setAttribute('aria-current', link.dataset.view === view ? 'page' : 'false');
  }
  const loading = el('p', { className: 'summary' }, 'Chargement…');
  if (BUSY) loading.setAttribute('aria-busy', 'true');
  root.replaceChildren(loading);
  setTimeout(() => {
    if (currentView() === view) root.replaceChildren(view === 'connexion' ? renderLogin() : renderAlerts());
  }, DELAY);
}

document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-view]') : null;
  if (!link) return;
  event.preventDefault();
  history.pushState({}, '', link.href);
  render();
});
window.addEventListener('popstate', render);
render();
