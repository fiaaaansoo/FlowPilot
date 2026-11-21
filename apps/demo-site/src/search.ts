import { queryFromParams } from './jobs';

// « Modifier la recherche » revient ici avec les critères dans l'URL : on pré-remplit le formulaire.
const query = queryFromParams(new URLSearchParams(location.search));
const form = document.querySelector<HTMLFormElement>('#search-form');
if (!form) throw new Error('index.html : formulaire introuvable');

const keywords = form.querySelector<HTMLInputElement>('#q');
if (keywords) keywords.value = query.keywords;
const city = form.querySelector<HTMLSelectElement>('#ville');
if (city) city.value = query.city;
for (const box of form.querySelectorAll<HTMLInputElement>('input[name="contrat"]')) {
  box.checked = (query.contracts as string[]).includes(box.value);
}
const remote = form.querySelector<HTMLInputElement>('input[name="teletravail"]');
if (remote) remote.checked = query.remoteOnly;
