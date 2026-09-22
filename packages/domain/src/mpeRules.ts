/**
 * mpeRules — every legal tolerance in one swappable module.
 *
 * Requirement 7 of the build spec: when OIML revises the standard, this file (and the
 * seeded TestType rows) should be the only thing that changes. So the stepped MPE table
 * is *data*, not control flow, and each fixed-tolerance test gets its own named function
 * whose name matches the test it governs.
 *
 * ---------------------------------------------------------------------------
 * NOTE ON THE CLASS II BAND BOUNDARIES — please read before trusting output.
 *
 * The build spec (section 2.1) specifies Class II bands as 500 / 2000 / 10000 e.
 * Those are the boundaries OIML R76-1 Table 3 assigns to Class *III*; Class II uses
 * 5000 / 20000 e. With the NHB150 demo instrument (Max 150 g, e 0.02 g, n = 7500)
 * the two readings disagree for loads above 10 g, which is most of the test.
 *
 * `MPE_TABLE_SPEC` reproduces the spec as written and is the default, so this build
 * matches the document it was specified from. `MPE_TABLE_OIML_R76` carries the
 * published boundaries. Switching is a one-line change at the `DEFAULT_MPE_TABLE`
 * export below, and every call site accepts a table override for A/B comparison.
 * Worth resolving against the source report before this leaves prototype status.
 * ---------------------------------------------------------------------------
 */

import type { AccuracyClass, ErrorBasis, InstrumentSpec } from './types.ts';
import { lte, spread, withinTolerance } from './numeric.ts';

// ===========================================================================
// Stepped, load-dependent MPE (used by: INTRINSIC, T1-T4, DAMP*, TARE, ECC, EMC)
// ===========================================================================

/**
 * One step of the MPE staircase.
 * `maxIntervals` is the inclusive upper bound of the band, in units of e.
 * `Infinity` marks the open-ended top band.
 */
export interface MpeBand {
  readonly maxIntervals: number;
  readonly eMultiplier: number;
}

export type MpeTable = Readonly<Record<AccuracyClass, readonly MpeBand[]>>;

/** Class II bands exactly as given in the build spec, section 2.1. */
export const MPE_TABLE_SPEC: MpeTable = {
  I: [
    { maxIntervals: 50_000, eMultiplier: 0.5 },
    { maxIntervals: 200_000, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
  // As specified in the build document. See the note at the top of this file.
  II: [
    { maxIntervals: 500, eMultiplier: 0.5 },
    { maxIntervals: 2_000, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
  III: [
    { maxIntervals: 500, eMultiplier: 0.5 },
    { maxIntervals: 2_000, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
  IIII: [
    { maxIntervals: 50, eMultiplier: 0.5 },
    { maxIntervals: 200, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
};

/** Band boundaries as published in OIML R76-1 Table 3 / EN 45501 Table 3. */
export const MPE_TABLE_OIML_R76: MpeTable = {
  I: [
    { maxIntervals: 50_000, eMultiplier: 0.5 },
    { maxIntervals: 200_000, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
  II: [
    { maxIntervals: 5_000, eMultiplier: 0.5 },
    { maxIntervals: 20_000, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
  III: [
    { maxIntervals: 500, eMultiplier: 0.5 },
    { maxIntervals: 2_000, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
  IIII: [
    { maxIntervals: 50, eMultiplier: 0.5 },
    { maxIntervals: 200, eMultiplier: 1.0 },
    { maxIntervals: Infinity, eMultiplier: 1.5 },
  ],
};

/** The table this build uses: the published OIML R76-1 Table 3 boundaries. */
export const DEFAULT_MPE_TABLE: MpeTable = MPE_TABLE_OIML_R76;

export const MPE_TABLES = {
  spec: MPE_TABLE_SPEC,
  oiml_r76: MPE_TABLE_OIML_R76,
} as const;

export type MpeTableKey = keyof typeof MPE_TABLES;

export function resolveMpeTable(key?: MpeTableKey | null): MpeTable {
  return key && MPE_TABLES[key] ? MPE_TABLES[key] : DEFAULT_MPE_TABLE;
}

/**
 * Load expressed in verification scale intervals: n_i = L / e.
 * This is the quantity the MPE staircase steps on — never the raw load.
 */
export function intervalsForLoad(load: number, e: number): number {
  if (!e) return 0;
  return Math.abs(load) / e;
}

/** The tolerance for a band, as a multiple of e. Exposed because the report prints this. */
export function lookupMpeMultiplier(
  nI: number,
  accuracyClass: AccuracyClass,
  table: MpeTable = DEFAULT_MPE_TABLE,
): number {
  const bands = table[accuracyClass] ?? table.II;
  for (const band of bands) {
    // `lte` so a load sitting exactly on a boundary falls in the lower (tighter) band,
    // which is what "0 <= n_i <= 500" in the standard's notation means.
    if (lte(nI, band.maxIntervals)) return band.eMultiplier;
  }
  return bands[bands.length - 1]!.eMultiplier;
}

/** Absolute MPE in the instrument's unit, for any accuracy class. */
export function lookupMPE(
  nI: number,
  e: number,
  accuracyClass: AccuracyClass,
  table: MpeTable = DEFAULT_MPE_TABLE,
): number {
  return lookupMpeMultiplier(nI, accuracyClass, table) * e;
}

/**
 * Class II convenience wrapper, matching the signature named in the build spec.
 * Prefer `lookupMPE` in new code so the accuracy class stays explicit.
 */
export function lookupMPE_ClassII(nI: number, e: number): number {
  return lookupMPE(nI, e, 'II', DEFAULT_MPE_TABLE);
}

/** MPE for a given applied load. The form most call sites actually want. */
export function mpeForLoad(
  load: number,
  spec: Pick<InstrumentSpec, 'e' | 'accuracyClass'>,
  table: MpeTable = DEFAULT_MPE_TABLE,
): { mpe: number; mpeInE: number; nI: number } {
  const nI = intervalsForLoad(load, spec.e);
  const mpeInE = lookupMpeMultiplier(nI, spec.accuracyClass, table);
  return { nI, mpeInE, mpe: mpeInE * spec.e };
}

// ===========================================================================
// Error formulas
// ===========================================================================

/**
 * Standard error: E = I + 0.5e - L.
 *
 * The +0.5e term recovers the true value from a rounded indication: a display
 * reading I means the true mass lies in [I - 0.5e, I + 0.5e), so the midpoint
 * estimate sits half an interval above the reading.
 */
export function computeError(indication: number, load: number, e: number): number {
  return indication + 0.5 * e - load;
}

/**
 * Changeover error: E = I + ½e − ΔL − L.
 *
 * When the instrument lacks standard resolution (d ≥ 0.2e), the rounded
 * indication alone cannot locate the true error: small weights ΔL (≈ e/10)
 * find the changeover point, and the formula above recovers the pre-rounding
 * value. With ΔL = 0 this reduces exactly to `computeError`, so rows recorded
 * before the ΔL column existed evaluate identically.
 */
export function computeChangeoverError(
  indication: number,
  load: number,
  e: number,
  deltaL: number | null | undefined,
): number {
  return indication + 0.5 * e - (deltaL ?? 0) - load;
}

/**
 * Standard resolution check: d < 0.2e.
 *
 * Below a fifth of e the indication resolves finely enough to read the error
 * directly (E = I − L) with no changeover weights; at or above it the
 * changeover method is mandatory. Recorded here as a predicate only — switching
 * the default error formula for fine-resolution instruments would re-judge every
 * stored verdict, so that switch rides with the Class II band decision, not here.
 */
export function hasStandardResolution(d: number, e: number): boolean {
  return e > 0 && d < 0.2 * e;
}

/**
 * Corrected error: Ec = E - E0, where E0 is the error at zero load.
 * Subtracting the zero-load error isolates genuine drift from a fixed offset.
 */
export function computeCorrectedError(error: number, errorAtZero: number): number {
  return error - errorAtZero;
}

/** Does this error pass? Boundary-inclusive, per `abs(E) <= MPE`. */
export function isWithinMPE(error: number, mpe: number): boolean {
  return withinTolerance(error, mpe);
}

/**
 * Up/down loading rows pass only if BOTH directions are within MPE (spec 2.2).
 * A `null` direction is treated as not-applicable rather than as a failure.
 */
export function bothDirectionsPass(
  errorUp: number | null,
  errorDown: number | null,
  mpe: number,
): boolean {
  const checks = [errorUp, errorDown].filter((v): v is number => v !== null);
  if (checks.length === 0) return false;
  return checks.every((v) => isWithinMPE(v, mpe));
}

// ===========================================================================
// Fixed tolerances — load-independent. One named function per test.
// These deliberately do NOT reuse the staircase table above.
// ===========================================================================

/**
 * Configurable constants for the fixed-tolerance tests, as multiples of e.
 * Surfaced as data so a standard revision is a value change, not a code change.
 */
export const FIXED_TOLERANCES = {
  /** Stability of equilibrium: spread across repeated readings. */
  EQUIL_SPREAD_IN_E: 1.0,
  /** Zero return after load removal. */
  ZERO_RETURN_IN_E: 0.25,
  /** Creep drift over the 30-minute hold. */
  CREEP_IN_E: 0.5,
  /** Temperature effect on no-load indication, per 5 degrees C (scaled by pi). */
  TEMP_NO_LOAD_IN_E_PER_5C: 1.0,
} as const;

export interface RuleResult {
  /** The measured quantity the rule evaluates. `null` when there is not enough data yet. */
  value: number | null;
  /** The tolerance it was compared against, in the instrument's unit. */
  tolerance: number;
  /** Tolerance as a multiple of e, for display. `null` for absolute tolerances. */
  toleranceInE: number | null;
  pass: boolean;
  /** Human-readable rule statement, shown in the UI and printed in the report. */
  label: string;
}

/**
 * Repeatability: the spread of repeated readings at one load must stay within the
 * MPE *at that load* — so this rule does consult the staircase table, evaluated once.
 */
export function evaluateRepeatability(
  readings: readonly (number | null)[],
  load: number,
  spec: Pick<InstrumentSpec, 'e' | 'accuracyClass'>,
  table: MpeTable = DEFAULT_MPE_TABLE,
): RuleResult {
  const { mpe, mpeInE } = mpeForLoad(load, spec, table);
  const value = spread(readings);
  return {
    value,
    tolerance: mpe,
    toleranceInE: mpeInE,
    pass: value !== null && lte(value, mpe),
    label: `max(P) − min(P) ≤ MPE at ${load} (${mpeInE} e)`,
  };
}

/** Stability of equilibrium: spread across the readings must not exceed 1 e. */
export function evaluateStabilityOfEquilibrium(
  readings: readonly (number | null)[],
  spec: Pick<InstrumentSpec, 'e'>,
  multiplierInE: number = FIXED_TOLERANCES.EQUIL_SPREAD_IN_E,
): RuleResult {
  const tolerance = multiplierInE * spec.e;
  const value = spread(readings);
  return {
    value,
    tolerance,
    toleranceInE: multiplierInE,
    pass: value !== null && lte(value, tolerance),
    label: `spread across readings ≤ ${multiplierInE} e`,
  };
}

/** Zero return: residual indication after removing the load must not exceed 0.25 e. */
export function evaluateZeroReturn(
  residualIndication: number | null,
  spec: Pick<InstrumentSpec, 'e'>,
  multiplierInE: number = FIXED_TOLERANCES.ZERO_RETURN_IN_E,
): RuleResult {
  const tolerance = multiplierInE * spec.e;
  return {
    value: residualIndication,
    tolerance,
    toleranceInE: multiplierInE,
    pass: residualIndication !== null && withinTolerance(residualIndication, tolerance),
    label: `|zero return| ≤ ${multiplierInE} e`,
  };
}

/** Creep: drift while held under load must not exceed 0.5 e. */
export function evaluateCreep(
  driftReadings: readonly (number | null)[],
  spec: Pick<InstrumentSpec, 'e'>,
  multiplierInE: number = FIXED_TOLERANCES.CREEP_IN_E,
): RuleResult {
  const tolerance = multiplierInE * spec.e;
  const value = spread(driftReadings);
  return {
    value,
    tolerance,
    toleranceInE: multiplierInE,
    pass: value !== null && lte(value, tolerance),
    label: `drift under load ≤ ${multiplierInE} e`,
  };
}

/**
 * Temperature effect on no-load indication: zero drift per 5 degrees C must not
 * exceed pi * e, where pi is the instrument's fractional factor.
 */
export function evaluateTemperatureNoLoad(
  zeroDrift: number | null,
  temperatureSpanC: number,
  spec: Pick<InstrumentSpec, 'e' | 'fractionalFactorPi'>,
  multiplierInE: number = FIXED_TOLERANCES.TEMP_NO_LOAD_IN_E_PER_5C,
): RuleResult {
  const intervalsOf5C = Math.max(1, Math.abs(temperatureSpanC) / 5);
  const perInterval = multiplierInE * spec.fractionalFactorPi * spec.e;
  const tolerance = perInterval * intervalsOf5C;
  return {
    value: zeroDrift,
    tolerance,
    toleranceInE: multiplierInE * spec.fractionalFactorPi * intervalsOf5C,
    pass: zeroDrift !== null && withinTolerance(zeroDrift, tolerance),
    label: `|zero drift| ≤ ${multiplierInE} · pi · e per 5 °C over ${temperatureSpanC} °C`,
  };
}

/**
 * Span stability: the spread of corrected errors across the whole campaign must stay
 * within `mpd`, an absolute value carried per instrument model — not a multiple of e.
 */
export function evaluateSpanStability(
  correctedErrors: readonly (number | null)[],
  spec: Pick<InstrumentSpec, 'mpdSpanStability'>,
): RuleResult {
  const value = spread(correctedErrors);
  return {
    value,
    tolerance: spec.mpdSpanStability,
    toleranceInE: null,
    pass: value !== null && lte(value, spec.mpdSpanStability),
    label: `max(Ec) − min(Ec) ≤ mpd (${spec.mpdSpanStability})`,
  };
}

// ===========================================================================
// Rule registry — lets seeded TestType rows name a rule without a code change
// ===========================================================================

/**
 * Evaluate a `fixed_tolerance_expression` such as "1*e" or "0.25*e" from a seeded
 * TestType row. Supports `<number>*e` and bare absolute numbers; anything else
 * throws rather than silently returning a wrong tolerance.
 */
export function evaluateToleranceExpression(
  expression: string,
  spec: Pick<InstrumentSpec, 'e' | 'fractionalFactorPi'>,
): number {
  const trimmed = expression.replace(/\s+/g, '').toLowerCase();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;

  const match = /^(-?\d*\.?\d+)\*(e|pi\*e)$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Unsupported tolerance expression "${expression}". Use "<number>*e", "<number>*pi*e", or an absolute number.`,
    );
  }
  const factor = Number(match[1]);
  const usesPi = match[2] === 'pi*e';
  return factor * spec.e * (usesPi ? spec.fractionalFactorPi : 1);
}

/** Which error column decides pass/fail, per test type code. */
const CORRECTED_ERROR_TESTS = new Set(['ECC', 'SPAN1', 'SPAN2', 'SPAN3', 'SPAN', 'TARE']);

export function errorBasisFor(testTypeCode: string): ErrorBasis {
  return CORRECTED_ERROR_TESTS.has(testTypeCode.toUpperCase())
    ? 'corrected_error'
    : 'error';
}

// ===========================================================================
// Modular error allocation (OIML R76-2 research §2.3, Clause 12 task)
// ===========================================================================

/**
 * Default error fractions per module kind. Data, not control flow: a lab that
 * qualifies a module at a non-default pi stores it against the module, and the
 * functions below take it as an argument.
 */
export const MODULE_PI_DEFAULTS = {
  /** Indicator / analogue data processing. */
  indicator: 0.5,
  /** Load cell per R60. */
  loadCell: 0.7,
  /** Digital data processing and displays. */
  digital: 0.0,
  /** Complete weighing module tested as a unit. */
  completeModule: 1.0,
} as const;

export type ModuleKind = keyof typeof MODULE_PI_DEFAULTS;

/** A module's share of the whole-instrument tolerance: mpe_module = pi × mpe_total. */
export function moduleMpe(totalMpe: number, pi: number): number {
  return pi * totalMpe;
}

export interface PiBudgetEntry {
  name: string;
  pi: number;
}

export interface PiBudgetResult {
  sumSquares: number;
  pass: boolean;
  label: string;
}

/**
 * Compatibility budget: Σ pi² ≤ 1 over connector, indicator and load cell.
 * Pure check — no verdict logic for any instrument lives here.
 */
export function checkPiBudget(entries: readonly PiBudgetEntry[]): PiBudgetResult {
  const sumSquares = entries.reduce((sum, e) => sum + e.pi * e.pi, 0);
  return {
    sumSquares,
    pass: sumSquares <= 1 + 1e-12,
    label: `Σ pi² = ${sumSquares.toFixed(3)} ≤ 1.0`,
  };
}
