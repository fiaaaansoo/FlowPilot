import { describe, expect, it } from 'vitest';
import {
  hostLabel,
  isGrantablePattern,
  isSupportedUrl,
  originOf,
  originPatternFor,
  patternFromUserInput,
  patternLabel,
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
