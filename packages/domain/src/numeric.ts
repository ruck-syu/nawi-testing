/**
 * Floating-point helpers.
 *
 * Why this file exists: the arithmetic in this domain is small decimal values
 * (e = 0.02 g, indications like 0.396 g) where IEEE-754 noise is larger than the
 * quantities being compared. `0.396 + 0.01 - 0.4` evaluates to 0.006000000000000005,
 * and a naive `Math.abs(E) <= MPE` comparison at an exact boundary can flip a
 * legitimate PASS into a FAIL. In a legal-metrology tool that is a correctness bug,
 * not a cosmetic one, so all comparisons go through `lte` / `withinTolerance`.
 */

/** Comparison slack. Far below any real instrument resolution, far above float noise. */
export const EPSILON = 1e-9;

/** `a <= b`, tolerant of float representation error. */
export function lte(a: number, b: number): boolean {
  return a - b <= EPSILON;
}

/** `a >= b`, tolerant of float representation error. */
export function gte(a: number, b: number): boolean {
  return b - a <= EPSILON;
}

/** True when |value| is within `tolerance`, inclusive of the boundary. */
export function withinTolerance(value: number, tolerance: number): boolean {
  return lte(Math.abs(value), tolerance);
}

/** Round to a fixed number of decimal places, correcting the usual float drift. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  // The epsilon nudge keeps values like 1.005 from rounding down at 2dp.
  return Math.round((value + Math.sign(value) * EPSILON) * factor) / factor;
}

/**
 * How many decimal places a value should be shown to, given the instrument's
 * scale interval. An instrument with d = 0.002 needs 3 places; e = 0.02 needs 2.
 * We take the finer of e and d and add one place of headroom, because computed
 * errors carry a 0.5e term that is one digit finer than e itself.
 */
export function decimalsFor(e: number, d?: number): number {
  const finest = Math.min(e || 0, d && d > 0 ? d : e || 0);
  if (!finest || !Number.isFinite(finest)) return 3;
  const places = Math.max(0, Math.ceil(-Math.log10(finest)));
  return Math.min(6, places + 1);
}

/** Count of decimal places in a literal number, e.g. 0.002 -> 3. */
export function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const str = String(value);
  if (str.includes('e') || str.includes('E')) {
    const [, exp] = str.split(/[eE]/);
    return Math.max(0, -Number(exp));
  }
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : str.length - dot - 1;
}

/**
 * Format at an explicit number of decimal places.
 *
 * Use this when the caller has already worked out the precision — typically by calling
 * `decimalsFor` once per table and reusing the result down the rows.
 *
 * Keep this distinct from `formatAtPrecision`, which takes a *scale interval* rather than
 * a decimal count. The two are easy to confuse because both parameters are plain numbers,
 * and passing a decimal count where a scale interval belongs silently produces a coarser
 * result instead of an error: `formatAtPrecision(0.396, 4)` reads 4 as "e = 4 g" and
 * rounds to 0.4, discarding the measurement. That bug reached a rendered report once, so
 * the two operations now have names that say which one they are.
 */
export function formatFixed(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const places = Number.isFinite(decimals) ? Math.min(20, Math.max(0, Math.trunc(decimals))) : 0;
  return value.toFixed(places);
}

/**
 * Format for display at the instrument's natural precision.
 *
 * Second argument is the verification scale interval `e`, not a decimal count.
 */
export function formatAtPrecision(value: number | null, e: number, d?: number): string {
  return formatFixed(value, decimalsFor(e, d));
}

/** Numeric min/max that ignore nulls. Return `null` when nothing is present. */
export function minOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return present.length ? Math.min(...present) : null;
}

export function maxOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return present.length ? Math.max(...present) : null;
}

/** Peak-to-peak spread of a set of readings, or `null` if fewer than two are present. */
export function spread(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length < 2) return null;
  return Math.max(...present) - Math.min(...present);
}
