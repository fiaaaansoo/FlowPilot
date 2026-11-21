import { queryFromParams, searchJobs, type Job } from './jobs';

const params = new URLSearchParams(location.search);
const query = queryFromParams(params);
const jobs = searchJobs(query);

const summary = document.querySelector<HTMLParagraphElement>('#results-summary');
const list = document.querySelector<HTMLUListElement>('#results');
const edit = document.querySelector<HTMLAnchorElement>('#edit-search');
if (!summary || !list || !edit) throw new Error('results.html : structure inattendue');

edit.href = `/?${params.toString()}`;

const criteria = [
  query.keywords && `« ${query.keywords} »`,
  query.city,
  query.contracts.join(', '),
  query.remoteOnly && 'télétravail',
].filter(Boolean);

summary.textContent =
  `${jobs.length} offre${jobs.length > 1 ? 's' : ''}` + (criteria.length ? ` pour ${criteria.join(', ')}` : '') + '.';

if (jobs.length === 0) {
  const empty = document.createElement('li');
  empty.className = 'empty';
  empty.textContent = 'Aucune offre ne correspond. Retirez un filtre pour élargir la recherche.';
  list.append(empty);
}

for (const job of jobs) list.append(renderJob(job));

function renderJob(job: Job): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'result';
  item.dataset.jobId = job.id;

  const link = document.createElement('a');
  link.href = `/offer.html?id=${encodeURIComponent(job.id)}&${params.toString()}`;
  link.textContent = job.title;

  const title = document.createElement('h2');
  title.append(link);

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${job.company}, ${job.city}. ${job.contract}${job.remote ? ', télétravail possible' : ''}.`;

  const text = document.createElement('p');
  text.textContent = job.summary;

  item.append(title, meta, text);
  return item;
}
