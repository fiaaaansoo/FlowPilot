import { describe, expect, it } from 'vitest';
import { queryFromParams, searchJobs } from './jobs';

describe('searchJobs', () => {
  it('filtre par mots-clés sans tenir compte des accents ni de la casse', () => {
    const ids = searchJobs({ keywords: 'DEVELOPPEUR', city: '', contracts: [], remoteOnly: false }).map((j) => j.id);
    expect(ids).toEqual(['dev-front-lyon', 'alt-dev-lyon', 'dev-back-paris']);
  });

  it('combine ville, contrat et télétravail', () => {
    const ids = searchJobs({ keywords: '', city: 'Lyon', contracts: ['CDI'], remoteOnly: true }).map((j) => j.id);
    expect(ids).toEqual(['dev-front-lyon']);
  });

  it('lit la requête depuis l’URL et ignore les contrats inconnus', () => {
    const query = queryFromParams(new URLSearchParams('q=data&ville=Paris&contrat=CDI&contrat=Freelance&teletravail=oui'));
    expect(query).toEqual({ keywords: 'data', city: 'Paris', contracts: ['CDI'], remoteOnly: true });
  });
});
