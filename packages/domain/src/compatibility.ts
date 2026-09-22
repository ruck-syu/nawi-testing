/**
 * compatibility — OIML R76-1 §3.10 / research summary Clause 12 modular checks.
 *
 * When an instrument is assembled from separately approved modules (indicator,
 * load cells), each module's ratings must cover the complete instrument. These
 * are pure functions over explicit inputs: no storage exists for module data
 * yet, so callers supply what the technician entered. Each check returns a
 * labeled pass/fail pair in the style of the `RuleResult` family.
 */

export interface CompatibilityCheck {
  value: number | null;
  requirement: string;
  pass: boolean;
  label: string;
}

/** Load factor Q = (Max + DL + IZSR + NUD + T⁺) / Max. Dimensionless, ≥ 1. */
export function loadCellFactorQ(input: {
  max: number;
  deadLoad: number;
  initialZeroSettingRange: number;
  nonUniformDistribution: number;
  additiveTare: number;
}): number {
  const { max, deadLoad, initialZeroSettingRange, nonUniformDistribution, additiveTare } = input;
  if (!(max > 0)) return Number.NaN;
  return (max + deadLoad + initialZeroSettingRange + nonUniformDistribution + additiveTare) / max;
}

/**
 * Load cell capacity: Q · Max · R / N ≤ E_max.
 *
 * R is the force reduction ratio of the load-transmitting device (1 when the
 * cell carries the load directly); N is the number of load cells.
 */
export function checkLoadCellCapacity(input: {
  q: number;
  max: number;
  reductionRatio?: number;
  numCells: number;
  cellEmax: number;
}): CompatibilityCheck {
  const r = input.reductionRatio ?? 1;
  const required = (input.q * input.max * r) / input.numCells;
  return {
    value: required,
    requirement: `≤ E_max (${input.cellEmax})`,
    pass: Number.isFinite(required) && required <= input.cellEmax,
    label: `Q · Max · R / N = ${Number.isFinite(required) ? required.toFixed(3) : '—'} ≤ E_max`,
  };
}

/** Minimum verification interval: v_min ≤ e₁ · R / √N. All masses in the same unit. */
export function checkMinVerificationInterval(input: {
  cellVmin: number;
  e: number;
  reductionRatio?: number;
  numCells: number;
}): CompatibilityCheck {
  const r = input.reductionRatio ?? 1;
  const limit = (input.e * r) / Math.sqrt(input.numCells);
  return {
    value: input.cellVmin,
    requirement: `≤ ${limit.toFixed(6)}`,
    pass: Number.isFinite(input.cellVmin) && input.cellVmin <= limit,
    label: `v_min = ${input.cellVmin} ≤ e₁ · R / √N = ${limit.toFixed(6)}`,
  };
}

/**
 * Signal voltage per verification interval, in mV:
 * Δu = C · U_exc · R · e₁ / (E_max · N).
 *
 * C is the load cell rated output (mV/V), U_exc the excitation voltage (V).
 */
export function signalPerInterval(input: {
  cellSensitivityMVV: number;
  excitationVoltageV: number;
  reductionRatio?: number;
  e: number;
  cellEmax: number;
  numCells: number;
}): number {
  const r = input.reductionRatio ?? 1;
  const denom = input.cellEmax * input.numCells;
  if (!(denom > 0)) return Number.NaN;
  return (input.cellSensitivityMVV * input.excitationVoltageV * r * input.e) / denom;
}

/** The per-interval signal must clear the indicator's minimum input voltage. */
export function checkSignalVoltage(
  input: Parameters<typeof signalPerInterval>[0] & { indicatorDeltaUMinMV: number },
): CompatibilityCheck {
  const value = signalPerInterval(input);
  return {
    value,
    requirement: `≥ ${input.indicatorDeltaUMinMV} mV`,
    pass: Number.isFinite(value) && value >= input.indicatorDeltaUMinMV,
    label: `Δu = ${Number.isFinite(value) ? value.toFixed(4) : '—'} mV ≥ Δu_min`,
  };
}

/** Combined cell impedance R_LC / N must sit inside the indicator's input range (Ω). */
export function checkImpedance(input: {
  cellImpedanceOhm: number;
  numCells: number;
  indicatorMinOhm: number;
  indicatorMaxOhm: number;
}): CompatibilityCheck {
  const combined = input.cellImpedanceOhm / input.numCells;
  return {
    value: combined,
    requirement: `${input.indicatorMinOhm}–${input.indicatorMaxOhm} Ω`,
    pass:
      Number.isFinite(combined) &&
      combined >= input.indicatorMinOhm &&
      combined <= input.indicatorMaxOhm,
    label: `R_LC / N = ${Number.isFinite(combined) ? combined.toFixed(1) : '—'} Ω within indicator range`,
  };
}

/** Verification intervals: n_ind ≥ n and n_LC ≥ n (per range for multi-range). */
export function checkVerificationIntervals(input: {
  indicatorN: number;
  loadCellN: number;
  instrumentN: number;
}): CompatibilityCheck {
  const pass =
    Number.isFinite(input.indicatorN) &&
    Number.isFinite(input.loadCellN) &&
    input.indicatorN >= input.instrumentN &&
    input.loadCellN >= input.instrumentN;
  return {
    value: null,
    requirement: `n_ind, n_LC ≥ n (${input.instrumentN})`,
    pass,
    label: `n_ind = ${input.indicatorN}, n_LC = ${input.loadCellN} ≥ n = ${input.instrumentN}`,
  };
}

/** Rated temperature spans of load cell and indicator must cover the instrument's. °C. */
export function checkTemperatureSpan(input: {
  cellMin: number;
  cellMax: number;
  indicatorMin: number;
  indicatorMax: number;
  instrumentMin: number;
  instrumentMax: number;
}): CompatibilityCheck {
  const pass =
    input.cellMin <= input.instrumentMin &&
    input.cellMax >= input.instrumentMax &&
    input.indicatorMin <= input.instrumentMin &&
    input.indicatorMax >= input.instrumentMax;
  return {
    value: null,
    requirement: `LC and indicator spans cover [${input.instrumentMin}, ${input.instrumentMax}] °C`,
    pass,
    label: `LC [${input.cellMin}, ${input.cellMax}] °C, IND [${input.indicatorMin}, ${input.indicatorMax}] °C cover instrument`,
  };
}
