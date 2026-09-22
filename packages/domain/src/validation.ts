/**
 * validation — range and sanity checks for operator-entered values.
 *
 * Pure functions returning issue lists (never throwing), so the server can turn
 * them into 400s and the entry forms can reuse the same bounds for inline
 * messages. Bounds come from `OIML_ENV_LIMITS` and the instrument spec — never
 * from the value being checked.
 *
 * Deliberately verdict-neutral: rejecting an out-of-envelope recording is not a
 * fail, it is a refusal to store a number the standard says cannot have been
 * produced under valid conditions.
 */

import { OIML_ENV_LIMITS, type InstrumentSpec, type ObservationInput, type TestConditionInput } from './types.ts';

export interface RangeIssue {
  field: string;
  message: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** One bounds check: null/undefined passes (unrecorded stays unrecorded). */
export function checkRange(
  value: number | null | undefined,
  min: number,
  max: number,
  field: string,
  unit: string,
): RangeIssue | null {
  if (value === null || value === undefined) return null;
  if (!finite(value)) return { field, message: `${field} must be a number` };
  if (value < min || value > max) {
    return { field, message: `${field} must be between ${min} and ${max} ${unit}` };
  }
  return null;
}

/** Ambient conditions against the OIML R76-2 operating envelope. */
export function validateTestConditions(input: TestConditionInput): RangeIssue[] {
  const issues: RangeIssue[] = [];
  const checks: Array<[number | null | undefined, keyof typeof OIML_ENV_LIMITS, string]> = [
    [input.temperatureC, 'temperatureC', 'temperature'],
    // Chamber setpoints for the Clause 6.3.1 thermal sequence may exceed the
    // ambient envelope once those tests exist; revisit then.
    [input.chamberTempC, 'temperatureC', 'chamber temperature'],
    [input.roomTempC, 'temperatureC', 'room temperature'],
    [input.humidityPct, 'humidityPct', 'humidity'],
    [input.pressureHPa, 'pressureHPa', 'barometric pressure'],
  ];
  for (const [value, limitKey, field] of checks) {
    const limits = OIML_ENV_LIMITS[limitKey];
    const issue = checkRange(value, limits.min, limits.max, field, limits.unit);
    if (issue) issues.push(issue);
  }
  return issues;
}

/**
 * One observation row across any test type: physical sanity only (no verdict logic).
 *
 * Loads cannot be negative; indications, when entered, must be finite; ΔL, when
 * entered, must sit inside a verification interval — a changeover weight larger
 * than e contradicts the method it serves; disturbance voltages, frequencies, and
 * field strengths must be positive.
 */
export function validateObservationInput(
  row: (Partial<ObservationInput> & Record<string, unknown>),
  spec?: Pick<InstrumentSpec, 'e'>,
): RangeIssue[] {
  const issues: RangeIssue[] = [];
  const tag = `row ${row.sequenceNo ?? 'unknown'}`;

  if (row.loadValue !== undefined && row.loadValue !== null) {
    if (!finite(row.loadValue) || row.loadValue < 0) {
      issues.push({ field: `${tag}.loadValue`, message: `${tag}: load must be a non-negative number` });
    }
  }

  const numericChecks: Array<[string, unknown]> = [
    ['indicationUp', row.indicationUp],
    ['indicationDown', row.indicationDown],
    ['indication', row.indication],
    ['indicationZero', row.indicationZero],
    ['indicationBefore', row.indicationBefore],
    ['indicationAfter', row.indicationAfter],
  ];

  for (const [label, value] of numericChecks) {
    if (value !== null && value !== undefined && !finite(value)) {
      issues.push({ field: `${tag}.${label}`, message: `${tag}: ${label} must be a number` });
    }
  }

  if (spec?.e !== undefined) {
    for (const [label, value] of [
      ['deltaLUp', row.deltaLUp],
      ['deltaLDown', row.deltaLDown],
    ] as const) {
      if (value === null || value === undefined) continue;
      // Unit-agnostic message: the domain layer does not know the instrument's
      // unit (g, kg, mg), only its scale interval e.
      if (!finite(value) || value < 0 || value > spec.e) {
        issues.push({ field: `${tag}.${label}`, message: `${tag}: ${label} must be between 0 and e` });
      }
    }
  }

  if (row.testVoltageKv !== null && row.testVoltageKv !== undefined) {
    if (!finite(row.testVoltageKv) || row.testVoltageKv <= 0) {
      issues.push({ field: `${tag}.testVoltageKv`, message: `${tag}: test voltage must be a positive number of kV` });
    }
  }

  if (row.frequencyMhz !== null && row.frequencyMhz !== undefined) {
    if (!finite(row.frequencyMhz) || row.frequencyMhz <= 0) {
      issues.push({ field: `${tag}.frequencyMhz`, message: `${tag}: frequency must be a positive number of MHz` });
    }
  }

  if (row.fieldStrengthVM !== null && row.fieldStrengthVM !== undefined) {
    if (!finite(row.fieldStrengthVM) || row.fieldStrengthVM <= 0) {
      issues.push({ field: `${tag}.fieldStrengthVM`, message: `${tag}: field strength must be a positive number of V/m` });
    }
  }

  if (row.loadZero !== null && row.loadZero !== undefined) {
    if (!finite(row.loadZero) || row.loadZero < 0) {
      issues.push({ field: `${tag}.loadZero`, message: `${tag}: zero load must be a non-negative number` });
    }
  }

  return issues;
}

/**
 * Instrument specification validation (Max, Min, e, d, accuracy class, n intervals).
 * Enforces metrological coherence before creating or updating an instrument model.
 */
export function validateInstrumentSpecInput(
  spec: Partial<InstrumentSpec> & Record<string, unknown>,
): RangeIssue[] {
  const issues: RangeIssue[] = [];

  const max = spec.max ?? spec.max_capacity;
  if (max === undefined || max === null || !finite(max) || max <= 0) {
    issues.push({ field: 'max_capacity', message: 'Max capacity must be a positive number' });
  }

  const min = spec.min ?? spec.min_capacity;
  if (min === undefined || min === null || !finite(min) || min < 0) {
    issues.push({ field: 'min_capacity', message: 'Min capacity must be a non-negative number' });
  } else if (max !== undefined && max !== null && finite(max) && max > 0 && min >= max) {
    issues.push({ field: 'min_capacity', message: 'Min capacity must be less than Max capacity' });
  }

  const e = spec.e ?? spec.e_value;
  if (e === undefined || e === null || !finite(e) || e <= 0) {
    issues.push({ field: 'e_value', message: 'Verification scale interval (e) must be a positive number' });
  }

  const d = spec.d ?? spec.d_value;
  if (d !== undefined && d !== null && (!finite(d) || d <= 0)) {
    issues.push({ field: 'd_value', message: 'Actual scale interval (d) must be a positive number' });
  }

  if (max && e && finite(max) && finite(e) && max > 0 && e > 0) {
    const n = Math.round(Number(max) / Number(e));
    if (n < 100 || n > 10_000_000) {
      issues.push({
        field: 'n_intervals',
        message: `Verification scale interval count n = ${n} is outside permissible range (100 to 10,000,000)`,
      });
    }
  }

  const accClass = spec.accuracyClass ?? spec.accuracy_class;
  if (accClass !== undefined && accClass !== null) {
    if (!['I', 'II', 'III', 'IIII'].includes(String(accClass))) {
      issues.push({ field: 'accuracy_class', message: 'Accuracy class must be one of: I, II, III, IIII' });
    }
  }

  const pi = spec.fractionalFactorPi ?? spec.fractional_factor_pi;
  if (pi !== undefined && pi !== null) {
    if (!finite(pi) || pi <= 0 || pi > 1) {
      issues.push({ field: 'fractional_factor_pi', message: 'Fractional factor pi must be between 0 and 1' });
    }
  }

  const mpd = spec.mpdSpanStability ?? spec.mpd_span_stability;
  if (mpd !== undefined && mpd !== null) {
    if (!finite(mpd) || mpd <= 0) {
      issues.push({ field: 'mpd_span_stability', message: 'Span stability tolerance (mpd) must be a positive number' });
    }
  }

  const optMin = spec.operating_temp_min;
  const optMax = spec.operating_temp_max;
  if (optMin !== undefined && optMin !== null && optMax !== undefined && optMax !== null) {
    if (finite(optMin) && finite(optMax) && optMin > optMax) {
      issues.push({ field: 'operating_temp_min', message: 'Minimum operating temperature cannot exceed maximum' });
    }
  }

  return issues;
}

export interface ObservationCountRule {
  formKind: string;
  minRows: number;
  minEntered: number;
  description: string;
}

export const MIN_OBSERVATIONS: Record<string, ObservationCountRule> = {
  weighing_performance: {
    formKind: 'weighing_performance',
    minRows: 1,
    minEntered: 1,
    description: 'Weighing performance requires at least 1 observation row',
  },
  repeatability: {
    formKind: 'repeatability',
    minRows: 2,
    minEntered: 2,
    description: 'Repeatability requires at least 2 recorded trials to determine spread',
  },
  eccentricity: {
    formKind: 'eccentricity',
    minRows: 2,
    minEntered: 2,
    description: 'Eccentricity requires at least 2 positions to determine off-centre error',
  },
  esd: {
    formKind: 'esd',
    minRows: 1,
    minEntered: 1,
    description: 'ESD testing requires at least 1 disturbance step with before and after indications',
  },
  radiated: {
    formKind: 'radiated',
    minRows: 1,
    minEntered: 1,
    description: 'Radiated immunity requires at least 1 frequency step with before and after indications',
  },
  span_stability: {
    formKind: 'span_stability',
    minRows: 2,
    minEntered: 2,
    description: 'Span stability requires at least 2 measurements over time to determine drift',
  },
  equilibrium: {
    formKind: 'equilibrium',
    minRows: 2,
    minEntered: 2,
    description: 'Stability of equilibrium requires at least 2 readings to determine spread',
  },
  zero_creep: {
    formKind: 'zero_creep',
    minRows: 3,
    minEntered: 3,
    description: 'Zero/creep requires at least 1 zero return reading and at least 2 creep hold readings',
  },
};

/**
 * Validate that an observation set meets minimum observation count requirements for evaluation.
 */
export function validateObservationCount(
  formKind: string | null,
  rows: readonly Record<string, unknown>[],
): RangeIssue[] {
  if (!formKind || !MIN_OBSERVATIONS[formKind]) return [];
  const rule = MIN_OBSERVATIONS[formKind]!;
  const issues: RangeIssue[] = [];

  if (rows.length < rule.minRows) {
    issues.push({
      field: 'rows',
      message: `${rule.description} (found ${rows.length} rows, minimum ${rule.minRows})`,
    });
    return issues;
  }

  let entered = 0;
  switch (formKind) {
    case 'weighing_performance':
      entered = rows.filter((r) => {
        const u = r.indicationUp ?? r.indication_up;
        const d = r.indicationDown ?? r.indication_down;
        return (u !== null && u !== undefined) || (d !== null && d !== undefined);
      }).length;
      break;

    case 'repeatability':
    case 'equilibrium':
    case 'eccentricity':
      entered = rows.filter((r) => {
        const val = r.indication ?? r.indicationUp ?? r.indication_up;
        return val !== null && val !== undefined;
      }).length;
      break;

    case 'esd':
    case 'radiated':
      entered = rows.filter((r) => {
        const b = r.indicationBefore ?? r.indication_before;
        const a = r.indicationAfter ?? r.indication_after;
        return b !== null && b !== undefined && a !== null && a !== undefined;
      }).length;
      break;

    case 'span_stability':
      entered = rows.filter((r) => {
        const ind = r.indication ?? r.indicationUp ?? r.indication_up;
        const z = r.indicationZero ?? r.indication_zero;
        return ind !== null && ind !== undefined && z !== null && z !== undefined;
      }).length;
      break;

    case 'zero_creep': {
      const isZero = (row: Record<string, unknown>) => {
        const load = row.loadValue ?? row.load_value;
        const cond = String(row.condition ?? '');
        return load === 0 || /^zero\b/i.test(cond.trim());
      };
      const zeroEntered = rows.filter((r) => {
        const ind = r.indication ?? r.indicationUp ?? r.indication_up;
        return isZero(r) && ind !== null && ind !== undefined;
      }).length;
      const creepEntered = rows.filter((r) => {
        const ind = r.indication ?? r.indicationUp ?? r.indication_up;
        return !isZero(r) && ind !== null && ind !== undefined;
      }).length;
      if (zeroEntered < 1 || creepEntered < 2) {
        issues.push({
          field: 'rows',
          message: `${rule.description} (found ${zeroEntered} zero return, ${creepEntered} creep readings)`,
        });
        return issues;
      }
      entered = zeroEntered + creepEntered;
      break;
    }
  }

  if (formKind !== 'zero_creep' && entered < rule.minEntered) {
    issues.push({
      field: 'rows',
      message: `${rule.description} (found ${entered} entered readings, minimum ${rule.minEntered})`,
    });
  }

  return issues;
}
