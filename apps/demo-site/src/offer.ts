import { applyMutations } from './mutations';
import { JOBS } from './jobs';

const params = new URLSearchParams(location.search);
const job = JOBS.find((j) => j.id === params.get('id'));

const offer = document.querySelector<HTMLElement>('#offer');
const apply = document.querySelector<HTMLElement>('#apply');
const form = document.querySelector<HTMLFormElement>('#apply-form');
const done = document.querySelector<HTMLParagraphElement>('#apply-done');
const back = document.querySelector<HTMLAnchorElement>('#back-link');
if (!offer || !apply || !form || !done || !back) throw new Error('offer.html : structure inattendue');

params.delete('id');
back.href = `/results.html?${params.toString()}`;

if (!job) {
  const title = document.createElement('h1');
  title.textContent = 'Offre introuvable';
  const text = document.createElement('p');
  text.textContent = 'Cette offre n’existe pas ou a été retirée. Revenez aux résultats pour en choisir une autre.';
  offer.append(title, text);
} else {
  document.title = `${job.title} | Offres du Coin`;

  const title = document.createElement('h1');
  title.textContent = job.title;

  const facts = document.createElement('dl');
  facts.className = 'facts';
  for (const [term, value] of [
    ['Entreprise', job.company],
    ['Ville', job.city],
    ['Contrat', job.contract],
    ['Télétravail', job.remote ? 'Possible' : 'Non'],
    ['Rémunération', job.salary],
  ] as const) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    facts.append(dt, dd);
  }

  const text = document.createElement('p');
  text.textContent = job.summary;

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'primary';
  cta.id = 'apply-button';
  cta.textContent = 'Postuler';
  cta.addEventListener('click', () => {
    apply.hidden = false;
    cta.hidden = true;
    document.querySelector<HTMLInputElement>('#apply-name')?.focus();
  });

  offer.append(title, facts, text, cta);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  form.hidden = true;
  done.hidden = false;
});

// Controlled interface variation (tests and benchmarks only; none by default).
applyMutations();
