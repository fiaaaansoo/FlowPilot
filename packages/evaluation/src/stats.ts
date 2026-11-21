/**
 * Small, dependency-free statistics for benchmark reports. Every function states its
 * assumptions; none of them claims more than the sample supports.
 */

export interface Interval {
  /** Point estimate. */
  estimate: number;
  low: number;
  high: number;
  n: number;
}

/** Wilson score interval for a binomial proportion (95 % by default). Well behaved for small n and k = 0 or n. */
export function wilson(successes: number, n: number, z = 1.959964): Interval {
  if (n === 0) return { estimate: Number.NaN, low: Number.NaN, high: Number.NaN, n };
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { estimate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half), n };
}

function binomialCoefficient(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

/**
 * Exact McNemar test for paired binary outcomes (same scenarios, two configurations).
 * `onlyA` = pairs where only A succeeded, `onlyB` = only B. Two-sided p-value from the
 * binomial distribution of the discordant pairs (p = 0.5 under H0).
 */
export function mcnemarExact(onlyA: number, onlyB: number): { discordant: number; pValue: number } {
  const discordant = onlyA + onlyB;
  if (discordant === 0) return { discordant, pValue: 1 };
  const k = Math.min(onlyA, onlyB);
  let tail = 0;
  for (let i = 0; i <= k; i += 1) tail += binomialCoefficient(discordant, i);
  return { discordant, pValue: Math.min(1, (2 * tail) / 2 ** discordant) };
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
}

/** Linear-interpolation quantile (type 7, as in R and NumPy). */
export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? Number.NaN;
  const high = sorted[upper] ?? Number.NaN;
  return low + (high - low) * (position - lower);
}

export const median = (values: readonly number[]) => quantile(values, 0.5);

/** p95 is reported only from this many samples on; below that it would only restate the maximum. */
export const MIN_SAMPLES_FOR_P95 = 20;

export interface LatencySummary {
  n: number;
  mean: number;
  median: number;
  /** Undefined when n < MIN_SAMPLES_FOR_P95. */
  p95?: number;
  min: number;
  max: number;
}

export function summarizeLatency(values: readonly number[]): LatencySummary | null {
  if (!values.length) return null;
  const summary: LatencySummary = {
    n: values.length,
    mean: mean(values),
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
  if (values.length >= MIN_SAMPLES_FOR_P95) summary.p95 = quantile(values, 0.95);
  return summary;
}
