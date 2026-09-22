/**
 * calc — turns operator-entered observations into fully computed test results.
 *
 * Everything in here is a pure function of (inputs, instrument spec). Nothing reads a
 * database or a clock. That is what lets the browser recompute a table live as the
 * technician types while the server recomputes the identical values on save, with no
 * risk of the two drifting apart. Per spec requirement 7, no derived column is ever
 * persisted as an editable field.
 */

import type {
  ComputedObservation,
  ErrorBasis,
  InstrumentSpec,
  ObservationInput,
  Verdict,
} from './types.ts';
import {
  DEFAULT_MPE_TABLE,
  type MpeTable,
  bothDirectionsPass,
  computeChangeoverError,
  computeCorrectedError,
  computeError,
  errorBasisFor,
  evaluateRepeatability,
  evaluateSpanStability,
  evaluateStabilityOfEquilibrium,
  evaluateZeroReturn,
  evaluateCreep,
  isWithinMPE,
  mpeForLoad,
} from './mpeRules.ts';
import { maxOf, minOf, roundTo, decimalsFor } from './numeric.ts';

/** Number of verification scale intervals for the whole instrument: n = Max / e. */
export function computeN(max: number, e: number): number {
  if (!e) return 0;
  return Math.round(max / e);
}

export interface ComputeOptions {
  /** Test type code, used to decide which error column governs pass/fail. */
  testTypeCode?: string;
  /** Override the error basis explicitly. */
  errorBasis?: ErrorBasis;
  table?: MpeTable;
  /** Round derived values for display. On by default; disable for exact-math tests. */
  round?: boolean;
}

/**
 * Compute one weighing-performance table.
 *
 * The zero-load error E0 used for the corrected-error column is taken from the row at
 * the lowest load once that row has an indication. For the NHB150 demo the first row is
 * Min (0.4 g) rather than a true zero, which mirrors the printed report: the standard
 * allows the first measured point to serve as the reference for drift correction.
 */
export function computeObservations(
  rows: readonly ObservationInput[],
  spec: InstrumentSpec,
  options: ComputeOptions = {},
): ComputedObservation[] {
  const table = options.table ?? DEFAULT_MPE_TABLE;
  const basis: ErrorBasis =
    options.errorBasis ?? errorBasisFor(options.testTypeCode ?? 'INTRINSIC');
  const shouldRound = options.round !== false;
  const dp = decimalsFor(spec.e, spec.d);
  const r = (v: number | null): number | null =>
    v === null ? null : shouldRound ? roundTo(v, dp) : v;

  const ordered = [...rows].sort((a, b) => a.sequenceNo - b.sequenceNo);

  // Reference row for E0: the lowest load that actually has an indication entered.
  // Its ΔL travels with it, so a changeover-recorded zero stays a changeover zero.
  const referenceRow = [...ordered]
    .filter((row) => row.indicationUp !== null || row.indicationDown !== null)
    .sort((a, b) => a.loadValue - b.loadValue)[0];

  const errorAtZeroUp =
    referenceRow && referenceRow.indicationUp !== null
      ? computeChangeoverError(
          referenceRow.indicationUp,
          referenceRow.loadValue,
          spec.e,
          referenceRow.deltaLUp,
        )
      : null;
  const errorAtZeroDown =
    referenceRow && referenceRow.indicationDown !== null
      ? computeChangeoverError(
          referenceRow.indicationDown,
          referenceRow.loadValue,
          spec.e,
          referenceRow.deltaLDown,
        )
      : errorAtZeroUp;

  return ordered.map((row) => {
    const { mpe, mpeInE, nI } = mpeForLoad(row.loadValue, spec, table);

    const errorUp =
      row.indicationUp !== null
        ? computeChangeoverError(row.indicationUp, row.loadValue, spec.e, row.deltaLUp)
        : null;
    const errorDown =
      row.indicationDown !== null
        ? computeChangeoverError(row.indicationDown, row.loadValue, spec.e, row.deltaLDown)
        : null;

    const correctedUp =
      errorUp !== null && errorAtZeroUp !== null
        ? computeCorrectedError(errorUp, errorAtZeroUp)
        : null;
    const correctedDown =
      errorDown !== null && errorAtZeroDown !== null
        ? computeCorrectedError(errorDown, errorAtZeroDown)
        : null;

    const judgedUp = basis === 'corrected_error' ? correctedUp : errorUp;
    const judgedDown = basis === 'corrected_error' ? correctedDown : errorDown;

    const hasAnyData = judgedUp !== null || judgedDown !== null;
    const rowPass = hasAnyData && bothDirectionsPass(judgedUp, judgedDown, mpe);
    const verdict: Verdict = !hasAnyData ? 'incomplete' : rowPass ? 'pass' : 'fail';

    return {
      ...row,
      nI: roundTo(nI, 1),
      mpe: roundTo(mpe, dp),
      mpeInE,
      errorUp: r(errorUp),
      errorDown: r(errorDown),
      correctedErrorUp: r(correctedUp),
      correctedErrorDown: r(correctedDown),
      // The judged quantities are published rather than left implicit, because every consumer
      // that plots or highlights an error needs the one the verdict was actually reached on.
      // Left to infer it, a chart picks "corrected if present, else raw" — which is right for
      // the tests judged on corrected error and silently wrong for the rest, and produces the
      // worst possible outcome: a marker sitting inside the tolerance band beside a row marked
      // fail. The rule knows which column it used; it should say so.
      judgedErrorUp: r(judgedUp),
      judgedErrorDown: r(judgedDown),
      errorBasis: basis,
      rowPass,
      verdict,
    };
  });
}

export interface TableSummary {
  rows: ComputedObservation[];
  /** True only when every row has data and every row passes. */
  overallPass: boolean;
  verdict: Verdict;
  rowsEntered: number;
  rowsTotal: number;
  failingRows: number[];
  /** Largest absolute judged error across the table, for at-a-glance reporting. */
  worstError: number | null;
  /** The MPE band(s) in play, expressed in e. */
  mpeInERange: [number, number] | null;
}

/** Compute a table and roll it up to a single verdict. */
export function summariseTable(
  rows: readonly ObservationInput[],
  spec: InstrumentSpec,
  options: ComputeOptions = {},
): TableSummary {
  const computed = computeObservations(rows, spec, options);

  const entered = computed.filter((row) => row.verdict !== 'incomplete');
  const failing = computed.filter((row) => row.verdict === 'fail');

  // Read off the rows rather than deciding the basis a second time here. The two derivations
  // agreed, but only because they were given the same options — and a summary that reported the
  // worst raw error while the rows were judged on corrected error would be a discrepancy between
  // a headline figure and the table under it, which is the hardest kind of error to notice.
  const magnitudes = entered
    .flatMap((row) => [row.judgedErrorUp, row.judgedErrorDown])
    .filter((v): v is number => v !== null)
    .map((v) => Math.abs(v));

  const multipliers = computed.map((row) => row.mpeInE);

  const allEntered = computed.length > 0 && entered.length === computed.length;
  const overallPass = allEntered && failing.length === 0;

  return {
    rows: computed,
    overallPass,
    verdict: computed.length === 0 || !allEntered ? 'incomplete' : overallPass ? 'pass' : 'fail',
    rowsEntered: entered.length,
    rowsTotal: computed.length,
    failingRows: failing.map((row) => row.sequenceNo),
    worstError: magnitudes.length ? Math.max(...magnitudes) : null,
    mpeInERange: multipliers.length
      ? [Math.min(...multipliers), Math.max(...multipliers)]
      : null,
  };
}

// ===========================================================================
// Repeatability
// ===========================================================================

export interface RepeatabilityTrial {
  sequenceNo: number;
  indication: number | null;
}

export interface RepeatabilityResult {
  trials: Array<RepeatabilityTrial & { p: number | null }>;
  /** Zero/tare reading I0 subtracted to give P. */
  indicationAtZero: number;
  pMax: number | null;
  pMin: number | null;
  range: number | null;
  mpe: number;
  mpeInE: number;
  overallPass: boolean;
  verdict: Verdict;
  label: string;
}

/**
 * Repeatability: 10 repeated readings at one load. P = I − I0 for each trial,
 * and max(P) − min(P) must stay within the MPE at that load.
 */
export function computeRepeatability(
  trials: readonly RepeatabilityTrial[],
  load: number,
  indicationAtZero: number,
  spec: InstrumentSpec,
  table: MpeTable = DEFAULT_MPE_TABLE,
): RepeatabilityResult {
  const dp = decimalsFor(spec.e, spec.d);
  const withP = [...trials]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((trial) => ({
      ...trial,
      p: trial.indication === null ? null : roundTo(trial.indication - indicationAtZero, dp),
    }));

  const pValues = withP.map((t) => t.p);
  const rule = evaluateRepeatability(pValues, load, spec, table);
  const entered = pValues.filter((v) => v !== null).length;

  return {
    trials: withP,
    indicationAtZero,
    pMax: maxOf(pValues),
    pMin: minOf(pValues),
    range: rule.value === null ? null : roundTo(rule.value, dp),
    mpe: roundTo(rule.tolerance, dp),
    mpeInE: rule.toleranceInE ?? 0,
    overallPass: rule.pass,
    verdict: entered < 2 ? 'incomplete' : rule.pass ? 'pass' : 'fail',
    label: rule.label,
  };
}

// ===========================================================================
// Eccentricity
// ===========================================================================

export type PanShape = 'rectangular_4corner' | 'triangular_3point';

export interface EccentricityPositionInput {
  sequenceNo: number;
  /** Position label: 'a' is centre, then the off-centre positions. */
  positionCode: string;
  positionLabel: string;
  loadZero: number;
  indicationZero: number | null;
  loadValue: number;
  indication: number | null;
}

export interface EccentricityRow extends EccentricityPositionInput {
  error: number | null;
  correctedError: number | null;
  /**
   * The error this row's verdict was reached on. Duplicates `correctedError` today, and is
   * published anyway so that anything plotting an error can read the same field on every table
   * shape instead of knowing, per test, which column was judged.
   */
  judgedError: number | null;
  /** Which column governed the verdict, so a consumer can label it honestly. */
  errorBasis: ErrorBasis;
  nI: number;
  mpe: number;
  mpeInE: number;
  rowPass: boolean;
  verdict: Verdict;
}

export interface EccentricityPosition {
  code: string;
  label: string;
  /**
   * Where the load sits on the receptor, as a fraction of its width and depth. The origin is
   * the rear-left corner: `x` grows to the right, `y` grows towards the front of the
   * instrument. That matches SVG's downward y axis, so a renderer can map these straight into
   * a viewBox without flipping an axis.
   */
  x: number;
  y: number;
}

/**
 * Load positions per pan shape. Centre first, then the off-centre points.
 *
 * The coordinates live here, with the labels, rather than in each renderer. A position code
 * is meaningless on its own — 'd' is only "the rear right corner" because the standard says
 * so — which makes the code-to-place mapping a rule about the test, not a drawing detail. It
 * was previously hardcoded in the report generator and about to be hardcoded a second time in
 * the browser; two copies of a lookup like this drift, and the failure mode is a report that
 * marks the wrong corner as out of tolerance.
 */
export function eccentricityPositions(shape: PanShape): EccentricityPosition[] {
  if (shape === 'triangular_3point') {
    // Three supports 120° apart on a circle about the centre, front point towards the operator.
    return [
      { code: 'a', label: 'Centre', x: 0.5, y: 0.5 },
      { code: 'b', label: 'Point 1 (front)', x: 0.5, y: 0.85 },
      { code: 'c', label: 'Point 2 (rear left)', x: 0.197, y: 0.325 },
      { code: 'd', label: 'Point 3 (rear right)', x: 0.803, y: 0.325 },
    ];
  }
  return [
    { code: 'a', label: 'Centre', x: 0.5, y: 0.5 },
    { code: 'b', label: 'Front left', x: 0.175, y: 0.825 },
    { code: 'c', label: 'Front right', x: 0.825, y: 0.825 },
    { code: 'd', label: 'Rear right', x: 0.825, y: 0.175 },
    { code: 'e', label: 'Rear left', x: 0.175, y: 0.175 },
  ];
}

/**
 * Eccentricity: the same load is placed at the centre and at each off-centre position.
 * Pass/fail is judged on corrected error, referenced to the centre position, because the
 * test is about position sensitivity rather than absolute accuracy.
 */
export function computeEccentricity(
  rows: readonly EccentricityPositionInput[],
  spec: InstrumentSpec,
  table: MpeTable = DEFAULT_MPE_TABLE,
): { rows: EccentricityRow[]; overallPass: boolean; verdict: Verdict; worstError: number | null } {
  const dp = decimalsFor(spec.e, spec.d);
  const ordered = [...rows].sort((a, b) => a.sequenceNo - b.sequenceNo);

  // Named once, then used for the verdict, the published column and the label — so the three
  // cannot disagree. Corrected error, because the test asks whether the reading changes with
  // position rather than whether it is absolutely right: the centre reading is the reference,
  // and any error it already carries is common to every position and cancels.
  const basis: ErrorBasis = 'corrected_error';

  const centre = ordered.find((row) => row.positionCode === 'a') ?? ordered[0];
  const centreError =
    centre && centre.indication !== null
      ? computeError(centre.indication, centre.loadValue, spec.e)
      : null;

  const computed: EccentricityRow[] = ordered.map((row) => {
    const { mpe, mpeInE, nI } = mpeForLoad(row.loadValue, spec, table);
    const error =
      row.indication !== null ? computeError(row.indication, row.loadValue, spec.e) : null;
    const corrected =
      error !== null && centreError !== null ? computeCorrectedError(error, centreError) : null;

    const judged = basis === 'error' ? error : corrected;
    const hasData = judged !== null;
    const rowPass = hasData && isWithinMPE(judged, mpe);

    return {
      ...row,
      nI: roundTo(nI, 1),
      error: error === null ? null : roundTo(error, dp),
      correctedError: corrected === null ? null : roundTo(corrected, dp),
      judgedError: judged === null ? null : roundTo(judged, dp),
      errorBasis: basis,
      mpe: roundTo(mpe, dp),
      mpeInE,
      rowPass,
      verdict: !hasData ? 'incomplete' : rowPass ? 'pass' : 'fail',
    };
  });

  const allEntered = computed.length > 0 && computed.every((r) => r.verdict !== 'incomplete');
  const overallPass = allEntered && computed.every((r) => r.rowPass);
  // Off the judged column, so the headline figure and the table under it cannot report
  // different quantities.
  const magnitudes = computed
    .map((r) => r.judgedError)
    .filter((v): v is number => v !== null)
    .map(Math.abs);

  return {
    rows: computed,
    overallPass,
    verdict: !allEntered ? 'incomplete' : overallPass ? 'pass' : 'fail',
    worstError: magnitudes.length ? Math.max(...magnitudes) : null,
  };
}

// ===========================================================================
// EMC — electrostatic discharge
// ===========================================================================

export interface EsdRowInput {
  sequenceNo: number;
  testVoltageKv: number;
  /** 'contact' or 'air' discharge. */
  applicationMode: string;
  polarity: string;
  loadValue: number;
  indicationBefore: number | null;
  indicationAfter: number | null;
}

export interface EsdRow extends EsdRowInput {
  /** Disturbance-induced change in indication. */
  error: number | null;
  /**
   * The error this row's verdict was reached on. There is no zero-correction step in this test,
   * so it duplicates `error` — published under the common name so a consumer reads one field
   * across every table shape rather than remembering which column each test judges.
   */
  judgedError: number | null;
  /** Which column governed the verdict, so a consumer can label it honestly. */
  errorBasis: ErrorBasis;
  nI: number;
  mpe: number;
  mpeInE: number;
  rowPass: boolean;
  verdict: Verdict;
}

/**
 * ESD immunity: a disturbance must not shift the indication by more than the MPE at the
 * applied load (a "significant fault"). The judged quantity is the before/after
 * difference, so a fixed offset present in both readings correctly cancels.
 */
export function computeEsd(
  rows: readonly EsdRowInput[],
  spec: InstrumentSpec,
  table: MpeTable = DEFAULT_MPE_TABLE,
): { rows: EsdRow[]; overallPass: boolean; verdict: Verdict; worstError: number | null } {
  const dp = decimalsFor(spec.e, spec.d);
  // The before/after difference is the judged quantity: a standing offset present in both
  // readings is not a fault the disturbance caused, so there is nothing to correct against.
  const basis: ErrorBasis = 'error';
  const computed: EsdRow[] = [...rows]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((row) => {
      const { mpe, mpeInE, nI } = mpeForLoad(row.loadValue, spec, table);
      const error =
        row.indicationBefore !== null && row.indicationAfter !== null
          ? row.indicationAfter - row.indicationBefore
          : null;
      const hasData = error !== null;
      const rowPass = hasData && isWithinMPE(error, mpe);
      const rounded = error === null ? null : roundTo(error, dp);
      return {
        ...row,
        nI: roundTo(nI, 1),
        error: rounded,
        judgedError: rounded,
        errorBasis: basis,
        mpe: roundTo(mpe, dp),
        mpeInE,
        rowPass,
        verdict: !hasData ? 'incomplete' : rowPass ? 'pass' : 'fail',
      };
    });

  const allEntered = computed.length > 0 && computed.every((r) => r.verdict !== 'incomplete');
  const overallPass = allEntered && computed.every((r) => r.rowPass);
  const magnitudes = computed
    .map((r) => r.judgedError)
    .filter((v): v is number => v !== null)
    .map(Math.abs);

  return {
    rows: computed,
    overallPass,
    verdict: !allEntered ? 'incomplete' : overallPass ? 'pass' : 'fail',
    worstError: magnitudes.length ? Math.max(...magnitudes) : null,
  };
}

// ===========================================================================
// EMC — radiated electromagnetic fields (frequency sweep)
// ===========================================================================

export interface RadiatedPointInput {
  sequenceNo: number;
  /** Exposure frequency, MHz. */
  frequencyMhz: number | null;
  /** Applied field strength, V/m. */
  fieldStrengthVM: number | null;
  loadValue: number;
  indicationBefore: number | null;
  indicationAfter: number | null;
}

export interface RadiatedPointRow extends RadiatedPointInput {
  /** Disturbance-induced change in indication. */
  error: number | null;
  /**
   * The error this row's verdict was reached on — duplicates `error`, published
   * under the common name so consumers read one field across table shapes.
   */
  judgedError: number | null;
  /** Which column governed the verdict, so a consumer can label it honestly. */
  errorBasis: ErrorBasis;
  nI: number;
  mpe: number;
  mpeInE: number;
  rowPass: boolean;
  verdict: Verdict;
}

/**
 * Radiated immunity: at each frequency step the field must not shift the
 * indication by more than the MPE at the applied load (a "significant fault").
 * Same judgement as ESD — before/after difference against the staircase — over
 * a frequency sweep instead of voltage steps.
 */
export function computeRadiated(
  rows: readonly RadiatedPointInput[],
  spec: InstrumentSpec,
  table: MpeTable = DEFAULT_MPE_TABLE,
): { rows: RadiatedPointRow[]; overallPass: boolean; verdict: Verdict; worstError: number | null } {
  const dp = decimalsFor(spec.e, spec.d);
  const basis: ErrorBasis = 'error';
  const computed: RadiatedPointRow[] = [...rows]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((row) => {
      const { mpe, mpeInE, nI } = mpeForLoad(row.loadValue, spec, table);
      const error =
        row.indicationBefore !== null && row.indicationAfter !== null
          ? row.indicationAfter - row.indicationBefore
          : null;
      const hasData = error !== null;
      const rowPass = hasData && isWithinMPE(error, mpe);
      const rounded = error === null ? null : roundTo(error, dp);
      return {
        ...row,
        nI: roundTo(nI, 1),
        error: rounded,
        judgedError: rounded,
        errorBasis: basis,
        mpe: roundTo(mpe, dp),
        mpeInE,
        rowPass,
        verdict: !hasData ? 'incomplete' : rowPass ? 'pass' : 'fail',
      };
    });

  const allEntered = computed.length > 0 && computed.every((r) => r.verdict !== 'incomplete');
  const overallPass = allEntered && computed.every((r) => r.rowPass);
  const magnitudes = computed
    .map((r) => r.judgedError)
    .filter((v): v is number => v !== null)
    .map(Math.abs);

  return {
    rows: computed,
    overallPass,
    verdict: !allEntered ? 'incomplete' : overallPass ? 'pass' : 'fail',
    worstError: magnitudes.length ? Math.max(...magnitudes) : null,
  };
}

// ===========================================================================
// Span stability
// ===========================================================================

export interface SpanMeasurementInput {
  sequenceNo: number;
  condition: string;
  measuredAt: string | null;
  loadValue: number;
  indication: number | null;
  indicationZero: number | null;
}

export interface SpanMeasurementRow extends SpanMeasurementInput {
  error: number | null;
  correctedError: number | null;
  mpe: number;
  mpeInE: number;
}

export interface SpanStabilityResult {
  rows: SpanMeasurementRow[];
  range: number | null;
  mpd: number;
  overallPass: boolean;
  verdict: Verdict;
  label: string;
}

/**
 * Span stability is a meta-test: it compares the span measurement taken at several points
 * across the whole campaign. The tolerance is `mpd`, an absolute value carried on the
 * instrument model — not a multiple of e, and not from the staircase table.
 */
export function computeSpanStability(
  rows: readonly SpanMeasurementInput[],
  spec: InstrumentSpec,
  table: MpeTable = DEFAULT_MPE_TABLE,
): SpanStabilityResult {
  const dp = decimalsFor(spec.e, spec.d);
  const ordered = [...rows].sort((a, b) => a.sequenceNo - b.sequenceNo);

  const computed: SpanMeasurementRow[] = ordered.map((row) => {
    const { mpe, mpeInE } = mpeForLoad(row.loadValue, spec, table);
    const error =
      row.indication !== null ? computeError(row.indication, row.loadValue, spec.e) : null;
    const zeroError =
      row.indicationZero !== null ? computeError(row.indicationZero, 0, spec.e) : null;
    const corrected =
      error !== null && zeroError !== null ? computeCorrectedError(error, zeroError) : error;
    return {
      ...row,
      error: error === null ? null : roundTo(error, dp),
      correctedError: corrected === null ? null : roundTo(corrected, dp),
      mpe: roundTo(mpe, dp),
      mpeInE,
    };
  });

  const rule = evaluateSpanStability(
    computed.map((r) => r.correctedError),
    spec,
  );
  const entered = computed.filter((r) => r.correctedError !== null).length;

  return {
    rows: computed,
    range: rule.value === null ? null : roundTo(rule.value, dp),
    mpd: spec.mpdSpanStability,
    overallPass: rule.pass,
    verdict: entered < 2 ? 'incomplete' : rule.pass ? 'pass' : 'fail',
    label: rule.label,
  };
}

// ===========================================================================
// Stability of equilibrium
// ===========================================================================

export interface EquilibriumTrial {
  sequenceNo: number;
  indication: number | null;
}

export interface EquilibriumResult {
  trials: Array<EquilibriumTrial & { deviation: number | null }>;
  /** The single load every reading was taken at. */
  load: number;
  /** Spread across the entered readings. */
  spread: number | null;
  /** Fixed tolerance: 1 e. */
  tolerance: number;
  toleranceInE: number;
  overallPass: boolean;
  verdict: Verdict;
  label: string;
}

/**
 * Stability of equilibrium: repeated readings at one load must agree within 1 e.
 * Deviation from the mean is shown per trial for context; the verdict belongs to the
 * spread, exactly like repeatability — an individual reading cannot pass or fail alone.
 */
export function computeEquilibrium(
  trials: readonly EquilibriumTrial[],
  load: number,
  spec: InstrumentSpec,
): EquilibriumResult {
  const dp = decimalsFor(spec.e, spec.d);
  const entered = [...trials]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((t) => t.indication)
    .filter((v): v is number => v !== null);
  const mean = entered.length > 0 ? entered.reduce((a, b) => a + b, 0) / entered.length : null;

  const withDeviation = [...trials]
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((trial) => ({
      ...trial,
      deviation:
        trial.indication === null || mean === null
          ? null
          : roundTo(trial.indication - mean, dp),
    }));

  const rule = evaluateStabilityOfEquilibrium(
    withDeviation.map((t) => t.indication),
    spec,
  );

  return {
    trials: withDeviation,
    load,
    spread: rule.value === null ? null : roundTo(rule.value, dp),
    tolerance: roundTo(rule.tolerance, dp),
    toleranceInE: rule.toleranceInE ?? 1,
    overallPass: rule.pass,
    verdict: entered.length < 2 ? 'incomplete' : rule.pass ? 'pass' : 'fail',
    label: rule.label,
  };
}

// ===========================================================================
// Zero return and creep
// ===========================================================================

export interface ZeroCreepReadingInput {
  sequenceNo: number;
  condition: string;
  measuredAt: string | null;
  loadValue: number;
  indication: number | null;
}

export interface ZeroCreepResult {
  rows: ZeroCreepReadingInput[];
  /** Indication with the receptor empty after the load was removed. */
  zeroResidual: number | null;
  zeroTolerance: number;
  zeroPass: boolean;
  /** Spread of the under-load readings across the hold period. */
  creepRange: number | null;
  creepTolerance: number;
  creepPass: boolean;
  overallPass: boolean;
  verdict: Verdict;
  zeroLabel: string;
  creepLabel: string;
}

/**
 * A reading belongs to the zero-return check when it was taken unloaded. The phase is
 * inferred from the stored columns rather than a dedicated flag: load zero, or a
 * condition naming zero. Everything else counts as a creep reading under load.
 */
export function isZeroReturnRow(row: Pick<ZeroCreepReadingInput, 'loadValue' | 'condition'>): boolean {
  return row.loadValue === 0 || /^zero\b/i.test(row.condition.trim());
}

/**
 * Zero return and creep in one sheet, judged as two sub-checks with one verdict.
 * Zero: residual indication unloaded must stay within 0.25 e. Creep: the spread of the
 * under-load readings across the hold must stay within 0.5 e. Both must pass.
 */
export function computeZeroCreep(
  rows: readonly ZeroCreepReadingInput[],
  spec: InstrumentSpec,
): ZeroCreepResult {
  const dp = decimalsFor(spec.e, spec.d);
  const ordered = [...rows].sort((a, b) => a.sequenceNo - b.sequenceNo);

  const zeroReadings = ordered.filter(isZeroReturnRow).map((r) => r.indication);
  const creepReadings = ordered.filter((r) => !isZeroReturnRow(r)).map((r) => r.indication);

  // The last entered zero reading is the return under test; earlier ones are history.
  const residual = [...zeroReadings].reverse().find((v) => v !== null) ?? null;
  const zeroRule = evaluateZeroReturn(residual, spec);
  const creepRule = evaluateCreep(creepReadings, spec);

  const zeroEntered = zeroReadings.some((v) => v !== null);
  const creepEntered = creepReadings.filter((v) => v !== null).length;
  const complete = zeroEntered && creepEntered >= 2;

  return {
    rows: ordered,
    zeroResidual: residual === null ? null : roundTo(residual, dp),
    zeroTolerance: roundTo(zeroRule.tolerance, dp),
    zeroPass: zeroRule.pass,
    creepRange: creepRule.value === null ? null : roundTo(creepRule.value, dp),
    creepTolerance: roundTo(creepRule.tolerance, dp),
    creepPass: creepRule.pass,
    overallPass: zeroRule.pass && creepRule.pass,
    verdict: !complete ? 'incomplete' : zeroRule.pass && creepRule.pass ? 'pass' : 'fail',
    zeroLabel: zeroRule.label,
    creepLabel: creepRule.label,
  };
}

// ===========================================================================
// Reference weight generation
// ===========================================================================

/**
 * Auto-generate a reference weight set spanning Min to Max.
 *
 * The fractions reproduce the spacing of the DELTA report's NHB150 sheet: a couple of
 * small points near Min to catch zero-region behaviour, then a broad sweep to Max.
 * Values snap to the scale interval so a technician is never asked to apply a load
 * finer than the instrument can resolve.
 */
export const REFERENCE_WEIGHT_FRACTIONS = [
  0.02, 0.033, 0.067, 0.2, 0.33, 0.47, 0.6, 0.73, 0.87, 1.0,
] as const;

export function generateReferenceWeights(
  spec: Pick<InstrumentSpec, 'max' | 'min' | 'e' | 'd'>,
): number[] {
  const { max, min, e } = spec;
  const step = e > 0 ? e : 1;
  const snap = (value: number): number => {
    const snapped = Math.round(value / step) * step;
    return roundTo(snapped, decimalsFor(e, spec.d));
  };

  const points = [min, ...REFERENCE_WEIGHT_FRACTIONS.map((f) => snap(max * f))];

  // Keep it sorted, clamped to [min, max], and free of duplicates after snapping.
  const cleaned = points
    .map((p) => Math.min(Math.max(p, min), max))
    .sort((a, b) => a - b)
    .filter((p, i, arr) => i === 0 || Math.abs(p - arr[i - 1]!) > step / 2);

  if (cleaned[cleaned.length - 1] !== max) cleaned.push(max);
  return cleaned;
}
