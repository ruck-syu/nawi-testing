import { describe, expect, it } from 'vitest';
import {
  checkRange,
  validateInstrumentSpecInput,
  validateObservationCount,
  validateObservationInput,
  validateTestConditions,
} from '../src/validation.ts';

/** NHB150: e = 0.02 g — the instrument the seed data is taken from. */
const E = 0.02;

describe('checkRange', () => {
  it('passes values inside the interval and nulls', () => {
    expect(checkRange(20, -10, 40, 'temperature', '°C')).toBeNull();
    expect(checkRange(null, -10, 40, 'temperature', '°C')).toBeNull();
  });

  it('rejects out-of-envelope and non-numeric values', () => {
    expect(checkRange(41, -10, 40, 'temperature', '°C')).not.toBeNull();
    expect(checkRange(Number.NaN, -10, 40, 'temperature', '°C')).not.toBeNull();
  });
});

describe('validateTestConditions', () => {
  it('accepts the OIML envelope edges', () => {
    expect(
      validateTestConditions({ temperatureC: 40, humidityPct: 85, pressureHPa: 860 }),
    ).toEqual([]);
  });

  it('flags each out-of-envelope condition', () => {
    const issues = validateTestConditions({ temperatureC: 50, pressureHPa: 700 });
    expect(issues.map((i) => i.field).sort()).toEqual(['barometric pressure', 'temperature']);
  });
});

describe('validateObservationInput', () => {
  it('accepts a normal row and an empty row', () => {
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: 100, indicationUp: 100.01, indicationDown: null }, { e: E }),
    ).toEqual([]);
    expect(
      validateObservationInput({ sequenceNo: 2, loadValue: 100, indicationUp: null, indicationDown: null }, { e: E }),
    ).toEqual([]);
  });

  it('rejects negative loads and oversized changeover weights', () => {
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: -5, indicationUp: null, indicationDown: null }, { e: E }),
    ).toHaveLength(1);
    expect(
      validateObservationInput(
        { sequenceNo: 1, loadValue: 100, indicationUp: null, indicationDown: null, deltaLUp: E * 2 },
        { e: E },
      ),
    ).toHaveLength(1);
  });

  it('rejects non-numeric indications and invalid disturbance parameters', () => {
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: 100, indicationUp: Number.NaN }, { e: E }),
    ).toHaveLength(1);
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: 100, testVoltageKv: 0 }, { e: E }),
    ).toHaveLength(1);
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: 100, frequencyMhz: -80 }, { e: E }),
    ).toHaveLength(1);
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: 100, fieldStrengthVM: 0 }, { e: E }),
    ).toHaveLength(1);
    expect(
      validateObservationInput({ sequenceNo: 1, loadValue: 100, loadZero: -1 }, { e: E }),
    ).toHaveLength(1);
  });
});

describe('validateInstrumentSpecInput', () => {
  it('accepts a valid instrument spec', () => {
    expect(
      validateInstrumentSpecInput({
        max: 150,
        min: 0.4,
        e: 0.02,
        d: 0.002,
        accuracyClass: 'II',
        fractionalFactorPi: 1,
        mpdSpanStability: 0.25,
      }),
    ).toEqual([]);
  });

  it('rejects missing or non-positive capacity, verification interval, and invalid intervals', () => {
    expect(validateInstrumentSpecInput({ max: 0, min: 0, e: 0.02 })).toHaveLength(1);
    expect(validateInstrumentSpecInput({ max: 150, min: -1, e: 0.02 })).toHaveLength(1);
    expect(validateInstrumentSpecInput({ max: 150, min: 200, e: 0.02 })).toHaveLength(1);
    expect(validateInstrumentSpecInput({ max: 150, min: 0, e: 0 })).toHaveLength(1);
    expect(validateInstrumentSpecInput({ max: 150, min: 0, e: 0.02, d: -0.01 })).toHaveLength(1);
  });

  it('flags impossible scale interval count n', () => {
    // n = 10 / 1 = 10 (< 100)
    const issuesLow = validateInstrumentSpecInput({ max: 10, min: 0.1, e: 1 });
    expect(issuesLow.some((i) => i.field === 'n_intervals')).toBe(true);
  });

  it('validates auxiliary spec bounds', () => {
    expect(
      validateInstrumentSpecInput({
        max: 150,
        min: 0.4,
        e: 0.02,
        accuracyClass: 'INVALID' as any,
      }).some((i) => i.field === 'accuracy_class'),
    ).toBe(true);

    expect(
      validateInstrumentSpecInput({
        max: 150,
        min: 0.4,
        e: 0.02,
        fractionalFactorPi: 1.5,
      }).some((i) => i.field === 'fractional_factor_pi'),
    ).toBe(true);

    expect(
      validateInstrumentSpecInput({
        max: 150,
        min: 0.4,
        e: 0.02,
        operating_temp_min: 40,
        operating_temp_max: 10,
      }).some((i) => i.field === 'operating_temp_min'),
    ).toBe(true);
  });
});

describe('validateObservationCount', () => {
  it('validates minimum row counts per test kind', () => {
    expect(validateObservationCount('weighing_performance', [])).toHaveLength(1);
    expect(validateObservationCount('repeatability', [{ sequenceNo: 1, indication: 100 }])).toHaveLength(1);
    expect(validateObservationCount('equilibrium', [{ sequenceNo: 1, indication: 100 }])).toHaveLength(1);
    expect(validateObservationCount('span_stability', [{ sequenceNo: 1, indication: 100, indicationZero: 0 }])).toHaveLength(1);
  });

  it('passes when observation counts and entered readings satisfy standard requirements', () => {
    expect(
      validateObservationCount('repeatability', [
        { sequenceNo: 1, indication: 100.01 },
        { sequenceNo: 2, indication: 100.02 },
      ]),
    ).toEqual([]);

    expect(
      validateObservationCount('esd', [
        { sequenceNo: 1, indicationBefore: 100, indicationAfter: 100.01 },
      ]),
    ).toEqual([]);

    expect(
      validateObservationCount('zero_creep', [
        { sequenceNo: 1, loadValue: 0, condition: 'zero', indication: 0.01 },
        { sequenceNo: 2, loadValue: 150, condition: 'hold 0m', indication: 150.01 },
        { sequenceNo: 3, loadValue: 150, condition: 'hold 10m', indication: 150.02 },
      ]),
    ).toEqual([]);
  });

  it('rejects zero_creep when zero return or creep readings are missing', () => {
    // 3 rows but all creep, no zero return
    expect(
      validateObservationCount('zero_creep', [
        { sequenceNo: 1, loadValue: 150, condition: 'hold', indication: 150.01 },
        { sequenceNo: 2, loadValue: 150, condition: 'hold', indication: 150.01 },
        { sequenceNo: 3, loadValue: 150, condition: 'hold', indication: 150.02 },
      ]),
    ).toHaveLength(1);
  });
});

