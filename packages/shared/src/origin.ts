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
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);

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
