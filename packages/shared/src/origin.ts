/**
 * Helpers d'origine. FlowPilot ne demande l'accès qu'à des domaines précis,
 * choisis par l'utilisateur (optional_host_permissions), jamais à <all_urls>.
 */

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

/** Vrai si FlowPilot peut techniquement agir sur cette URL (http/https uniquement). */
export function isSupportedUrl(url: string | undefined): url is string {
  if (url === undefined) return false;
  try {
    return SUPPORTED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Motif de permission Chrome couvrant un domaine (tous ports confondus), par
 * exemple `http://localhost/*`. Renvoie `null` pour les pages protégées
 * (chrome://, chrome-extension://, file://, Web Store...) ou une URL invalide.
 */
export function originPatternFor(url: string): string | null {
  if (!isSupportedUrl(url)) return null;
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

/** Origine lisible (`http://localhost:5173`) ou `null` si non supportée. */
export function originOf(url: string): string | null {
  if (!isSupportedUrl(url)) return null;
  return new URL(url).origin;
}

/** Hôtes accessibles en http clair (développement local), cf. `optional_host_permissions`. */
export const LOCAL_HTTP_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * Vrai si le motif est couvert par `optional_host_permissions` du manifest
 * (https, ou http limité à localhost et 127.0.0.1). Chrome rejette
 * toute demande hors de ce périmètre.
 */
export function isGrantablePattern(pattern: string): boolean {
  const match = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match) return false;
  const [, scheme, host] = match;
  return scheme === 'https' || LOCAL_HTTP_HOSTS.has(host ?? '');
}

/** `http://localhost:5173` → `localhost:5173` (affichage). */
export function hostLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '');
}

/** `http://localhost/*` → `http://localhost` (affichage d'une permission). */
export function patternLabel(pattern: string): string {
  return pattern.replace(/\/\*$/, '');
}

/**
 * Normalise une saisie utilisateur (« localhost:5173 », « https://exemple.fr/page »)
 * en motif de permission accordable, ou `null`. Ajoute `https://` si aucun schéma n'est fourni, sauf
 * pour localhost / 127.0.0.1 où `http://` est le cas usuel en développement.
 */
export function patternFromUserInput(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const isLocal = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `${isLocal ? 'http' : 'https'}://${trimmed}`;
  const pattern = originPatternFor(candidate);
  return pattern !== null && isGrantablePattern(pattern) ? pattern : null;
}

// --- URL enregistrées : confidentialité et comparaison ---------------------

/** Paramètres porteurs de secrets : jamais stockés. */
const SECRET_PARAM = /^(token|access_token|id_token|refresh_token|session|sessionid|sid|api_?key|auth|password|passwd|pwd|secret|signature|sig|otp|nonce|ticket)$/i;
/** `code` et `state` ensemble : retour d'autorisation OAuth. Séparément, ce sont souvent des paramètres métier. */
const OAUTH_PAIR = ['code', 'state'] as const;
/** Paramètres qui changent d'une visite à l'autre : ignorés à la comparaison. */
const VOLATILE_PARAM = /^(utm_\w+|gclid|fbclid|msclkid|_|cb|ts|timestamp|t|rnd|random|cache|v)$/i;

/**
 * URL (absolute or relative) with every query value removed, keys kept, and a fragment that
 * carries parameters dropped. Used for what is sent to the recovery service: a link may carry
 * credentials under any parameter name (pre-signed URLs, reset links, e-mail addresses).
 */
export function withoutQueryValues(url: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const rest = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = rest.indexOf('?');
  if (queryAt === -1) return rest + (hash.includes('=') ? '' : hash);
  const keys = rest
    .slice(queryAt + 1)
    .split('&')
    .map((pair) => pair.split('=')[0] ?? '')
    .filter(Boolean);
  return rest.slice(0, queryAt) + (keys.length ? `?${keys.join('&')}` : '') + (hash.includes('=') ? '' : hash);
}

/**
 * Retire d'une URL ce qui ne doit jamais être stocké : paramètres de type jeton,
 * code, session, signature, et fragment porteur de paramètres (`#access_token=…`).
 */
export function sanitizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) parsed.searchParams.delete(name);
  }
  if (OAUTH_PAIR.every((name) => parsed.searchParams.has(name))) {
    for (const name of OAUTH_PAIR) parsed.searchParams.delete(name);
  }
  if (parsed.hash.includes('=')) parsed.hash = '';
  return parsed.href;
}

/**
 * L'URL atteinte au replay correspond-elle à l'URL enregistrée ? Même origine et
 * même chemin ; chaque paramètre enregistré non volatil doit avoir la même valeur ;
 * le fragment ne compte que pour le routage par ancre (`#/vue`).
 */
export function urlMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  let a: URL;
  let e: URL;
  try {
    a = new URL(actual);
    e = new URL(expected);
  } catch {
    return actual === expected;
  }
  if (a.origin !== e.origin || a.pathname !== e.pathname) return false;
  for (const [name, value] of e.searchParams) {
    if (VOLATILE_PARAM.test(name) || SECRET_PARAM.test(name)) continue;
    if (a.searchParams.get(name) !== value) return false;
  }
  return e.hash.startsWith('#/') ? a.hash === e.hash : true;
}
