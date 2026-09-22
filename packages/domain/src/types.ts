/**
 * Core domain vocabulary for OIML R76 / EN 45501 type-test reports.
 *
 * The names here deliberately mirror the printed report and the standard
 * (Max, e, d, n, L, I, E, Ec, MPE) so that a metrologist reading this code
 * recognises the terms without a translation layer.
 */

/** OIML accuracy class. The prototype exercises Class II, but the rules are class-aware. */
export type AccuracyClass = 'I' | 'II' | 'III' | 'IIII';

export type ProjectStatus = 'draft' | 'in_progress' | 'completed' | 'approved';

export type TestRunStatus = 'not_started' | 'in_progress' | 'complete';

/**
 * How a test's tolerance is derived.
 *  - MPE_TABLE       : load-dependent, stepped by n_i (intrinsic error, temperature, tare...)
 *  - FIXED_VALUE     : a constant multiple of e, or an absolute value, independent of load
 *  - DERIVED_NO_ENTRY: no operator data entry; result rolls up from other test runs
 */
export type RuleType = 'MPE_TABLE' | 'FIXED_VALUE' | 'DERIVED_NO_ENTRY';

/** Verdict for a row, a test run, or a whole project. */
export type Verdict = 'pass' | 'fail' | 'incomplete';

/**
 * The subset of InstrumentModel that the calculation layer needs.
 *
 * Every test screen reads these values from the InstrumentModel record; they are
 * never re-typed per test. Keeping the calculation input this narrow is what makes
 * the rules unit-testable without a database.
 */
export interface InstrumentSpec {
  /** Maximum capacity, in the instrument's unit (g for the NHB150 demo). */
  max: number;
  /** Minimum capacity. */
  min: number;
  /** Verification scale interval — the legal resolution unit. */
  e: number;
  /** Actual displayed increment. May be finer than e. */
  d: number;
  accuracyClass: AccuracyClass;
  /** Fractional factor pi, used by the temperature-effect-on-no-load rule. Usually 1. */
  fractionalFactorPi: number;
  /** Absolute tolerance (mpd) for the span-stability meta-test. Per-instrument, not global. */
  mpdSpanStability: number;
}

/** A single row of operator-entered data in a weighing-performance test. */
export interface ObservationInput {
  sequenceNo: number;
  /** Applied reference load, L. */
  loadValue: number;
  /** Indication I while loading up. `null` when not yet entered. */
  indicationUp: number | null;
  /** Indication I while loading down. `null` for single-direction tests. */
  indicationDown: number | null;
  /**
   * Small changeover weight ΔL while loading up, in the instrument's unit.
   *
   * Needed for the R76 changeover method (P = I + ½e − ΔL) whenever the
   * instrument lacks standard resolution (d ≥ 0.2e). Optional until the entry
   * forms and the observation table carry the column; the rules treat an
   * absent ΔL as zero (direct-reading path).
   */
  deltaLUp?: number | null;
  /** As `deltaLUp`, loading down. */
  deltaLDown?: number | null;
}

/** A row with every derived column filled in. Nothing here is ever persisted as user input. */
export interface ComputedObservation extends ObservationInput {
  /** Load expressed in verification scale intervals: n_i = L / e. */
  nI: number;
  /** E = I + 0.5e - L, loading up. */
  errorUp: number | null;
  /** E = I + 0.5e - L, loading down. */
  errorDown: number | null;
  /** Ec = E - E0, loading up. */
  correctedErrorUp: number | null;
  /** Ec = E - E0, loading down. */
  correctedErrorDown: number | null;
  /**
   * The error this row's verdict was reached on, loading up — raw or corrected according to
   * `errorBasis`. Anything that plots or highlights an error should use this, so that what the
   * reader sees is the quantity that was judged.
   */
  judgedErrorUp: number | null;
  /** As `judgedErrorUp`, loading down. */
  judgedErrorDown: number | null;
  /** Which column governed the verdict, so a consumer can label it honestly. */
  errorBasis: ErrorBasis;
  /** Absolute tolerance for this row, in the instrument's unit. */
  mpe: number;
  /** Tolerance expressed as a multiple of e — this is what the printed report shows. */
  mpeInE: number;
  /** True when every applicable error on this row is within MPE. */
  rowPass: boolean;
  /** `incomplete` until the required indications are entered. */
  verdict: Verdict;
}

/** Which error column governs the pass/fail decision for a given test type. */
export type ErrorBasis = 'error' | 'corrected_error';

/**
 * OIML R76-2 global environmental operating envelope (research summary §1).
 *
 * Reference data for validation, not control flow: the server and the entry
 * forms check recorded conditions against these bounds. Units are fixed —
 * °C, %RH and hPa — so a value outside its interval is rejected as a data
 * error, never silently stored.
 */
export const OIML_ENV_LIMITS = {
  /** Ambient temperature, °C. */
  temperatureC: { min: -10, max: 40, unit: '°C' },
  /** Relative humidity, %. */
  humidityPct: { min: 20, max: 95, unit: '%RH' },
  /** Barometric pressure, hPa. */
  pressureHPa: { min: 860, max: 1060, unit: 'hPa' },
} as const;

/** Recorded ambient conditions for one test run. All fields nullable: unrecorded stays unrecorded. */
export interface TestConditionInput {
  temperatureC?: number | null;
  chamberTempC?: number | null;
  roomTempC?: number | null;
  humidityPct?: number | null;
  pressureHPa?: number | null;
}
