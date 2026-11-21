/** Offres fictives. Aucune donnée réelle, aucun appel réseau. */
export type Contract = 'CDI' | 'CDD' | 'Stage' | 'Alternance';

export interface Job {
  id: string;
  title: string;
  company: string;
  city: string;
  contract: Contract;
  remote: boolean;
  salary: string;
  summary: string;
}

export const CONTRACTS: readonly Contract[] = ['CDI', 'CDD', 'Stage', 'Alternance'];

export const JOBS: readonly Job[] = [
  {
    id: 'dev-front-lyon',
    title: 'Développeur·se front-end React',
    company: 'Atelier Brume',
    city: 'Lyon',
    contract: 'CDI',
    remote: true,
    salary: '42 000 – 50 000 € brut/an',
    summary: 'Refonte d’une application de réservation, TypeScript et tests end-to-end.',
  },
  {
    id: 'data-paris',
    title: 'Data engineer junior',
    company: 'Relais Numérique',
    city: 'Paris',
    contract: 'CDI',
    remote: false,
    salary: '40 000 – 46 000 € brut/an',
    summary: 'Pipelines Python, PostgreSQL et supervision des flux quotidiens.',
  },
  {
    id: 'stage-ia-grenoble',
    title: 'Stage ingénierie IA agentique',
    company: 'Laboratoire Cime',
    city: 'Grenoble',
    contract: 'Stage',
    remote: false,
    salary: 'Gratification 1 100 €/mois',
    summary: 'Évaluation d’agents web sur des tâches de navigation réelles.',
  },
  {
    id: 'alt-dev-lyon',
    title: 'Alternance développeur·se full-stack',
    company: 'Coopérative Tisse',
    city: 'Lyon',
    contract: 'Alternance',
    remote: true,
    salary: 'Selon grille alternance',
    summary: 'API FastAPI et interface React pour un outil de planification.',
  },
  {
    id: 'qa-nantes',
    title: 'Ingénieur·e QA automatisation',
    company: 'Port Logiciel',
    city: 'Nantes',
    contract: 'CDD',
    remote: true,
    salary: '38 000 € brut/an',
    summary: 'Tests Playwright, intégration continue et suivi de la qualité.',
  },
  {
    id: 'dev-back-paris',
    title: 'Développeur·se back-end Python',
    company: 'Atelier Brume',
    city: 'Paris',
    contract: 'CDI',
    remote: true,
    salary: '45 000 – 55 000 € brut/an',
    summary: 'Services FastAPI, files de messages et observabilité.',
  },
];

export interface SearchQuery {
  keywords: string;
  city: string;
  contracts: Contract[];
  remoteOnly: boolean;
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function searchJobs(query: SearchQuery, jobs: readonly Job[] = JOBS): Job[] {
  const words = normalize(query.keywords).split(/\s+/).filter(Boolean);
  return jobs.filter((job) => {
    const haystack = normalize(`${job.title} ${job.company} ${job.summary}`);
    if (!words.every((word) => haystack.includes(word))) return false;
    if (query.city && job.city !== query.city) return false;
    if (query.contracts.length > 0 && !query.contracts.includes(job.contract)) return false;
    if (query.remoteOnly && !job.remote) return false;
    return true;
  });
}

export function queryFromParams(params: URLSearchParams): SearchQuery {
  const contracts = params.getAll('contrat').filter((c): c is Contract => (CONTRACTS as readonly string[]).includes(c));
  return {
    keywords: params.get('q') ?? '',
    city: params.get('ville') ?? '',
    contracts,
    remoteOnly: params.get('teletravail') === 'oui',
  };
}
