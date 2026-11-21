import { describe, expect, it } from 'vitest';
import {
  hostLabel,
  isGrantablePattern,
  isSupportedUrl,
  originOf,
  originPatternFor,
  patternFromUserInput,
  patternLabel,
  sanitizeUrl,
  withoutQueryValues,
  urlMatches,
} from './origin.js';

describe('originPatternFor', () => {
  it.each([
    ['http://localhost:5173/results.html?q=dev', 'http://localhost/*'],
    ['https://www.exemple.fr/emplois', 'https://www.exemple.fr/*'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1/*'],
  ])('%s → %s', (url, pattern) => {
    expect(originPatternFor(url)).toBe(pattern);
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abc/sidepanel.html',
    'file:///C:/page.html',
    'about:blank',
    'pas une url',
  ])('refuse les pages non supportées : %s', (url) => {
    expect(originPatternFor(url)).toBeNull();
    expect(isSupportedUrl(url)).toBe(false);
  });
});

describe('originOf', () => {
  it('garde le port', () => {
    expect(originOf('http://localhost:5173/a/b')).toBe('http://localhost:5173');
  });
});

describe('patternFromUserInput', () => {
  it.each([
    ['localhost:5173', 'http://localhost/*'],
    ['127.0.0.1', 'http://127.0.0.1/*'],
    ['exemple.fr', 'https://exemple.fr/*'],
    ['  https://jobs.exemple.fr/recherche  ', 'https://jobs.exemple.fr/*'],
  ])('%s → %s', (input, pattern) => {
    expect(patternFromUserInput(input)).toBe(pattern);
  });

  it.each(['', '   ', 'ftp://exemple.fr', 'chrome://settings', 'http://intranet', 'http://192.168.1.5'])('refuse « %s »', (input) => {
    expect(patternFromUserInput(input)).toBeNull();
  });
});

describe('isGrantablePattern', () => {
  it.each([
    ['https://exemple.fr/*', true],
    ['http://localhost/*', true],
    ['http://127.0.0.1/*', true],
    ['http://exemple.fr/*', false],
    ['https://exemple.fr/page', false],
  ])('%s → %s', (pattern, expected) => {
    expect(isGrantablePattern(pattern)).toBe(expected);
  });
});

describe('libellés', () => {
  it('retire le schéma ou le joker', () => {
    expect(hostLabel('http://localhost:5173')).toBe('localhost:5173');
    expect(patternLabel('http://localhost/*')).toBe('http://localhost');
  });
});

describe('sanitizeUrl', () => {
  it.each([
    ['http://x.fr/reset?token=abc&lang=fr', 'http://x.fr/reset?lang=fr'],
    ['http://x.fr/cb?code=123&state=xyz', 'http://x.fr/cb'],
    ['http://x.fr/app#access_token=secret&expires=1', 'http://x.fr/app'],
    ['http://x.fr/app#/profil', 'http://x.fr/app#/profil'],
    ['http://x.fr/results.html?q=data&ville=Lyon', 'http://x.fr/results.html?q=data&ville=Lyon'],
    ['http://x.fr/villes?state=CA', 'http://x.fr/villes?state=CA'],
    ['http://x.fr/dept?code=75', 'http://x.fr/dept?code=75'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeUrl(input)).toBe(expected);
  });
});

describe('withoutQueryValues', () => {
  it.each([
    ['https://bucket.example/f.pdf?X-Amz-Signature=abc&X-Amz-Credential=k', 'https://bucket.example/f.pdf?X-Amz-Signature&X-Amz-Credential'],
    ['/offer.html?id=qa-nantes#apply', '/offer.html?id#apply'],
    ['/app#access_token=secret', '/app'],
    ['/results.html', '/results.html'],
  ])('%s → %s', (input, expected) => {
    expect(withoutQueryValues(input)).toBe(expected);
  });
});

describe('urlMatches', () => {
  const expected = 'http://x.fr/results.html?q=data&ville=Lyon';
  it.each([
    ['même URL', expected, true],
    ['paramètre volatil en plus', `${expected}&utm_source=mail&ts=123`, true],
    ['paramètres dans un autre ordre', 'http://x.fr/results.html?ville=Lyon&q=data', true],
    ['valeur différente', 'http://x.fr/results.html?q=qa&ville=Lyon', false],
    ['autre chemin', 'http://x.fr/offer.html?q=data&ville=Lyon', false],
    ['autre origine', 'http://y.fr/results.html?q=data&ville=Lyon', false],
    ['URL inconnue', undefined, false],
  ])('%s', (_label, actual, result) => {
    expect(urlMatches(actual, expected)).toBe(result);
  });

  it('tient compte du fragment seulement pour le routage par ancre', () => {
    expect(urlMatches('http://x.fr/app#/a', 'http://x.fr/app#/b')).toBe(false);
    expect(urlMatches('http://x.fr/page#haut', 'http://x.fr/page#bas')).toBe(true);
  });
});
