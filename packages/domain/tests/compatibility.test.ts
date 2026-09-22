import { describe, expect, it } from 'vitest';
import {
  checkImpedance,
  checkLoadCellCapacity,
  checkMinVerificationInterval,
  checkSignalVoltage,
  checkTemperatureSpan,
  checkVerificationIntervals,
  loadCellFactorQ,
  signalPerInterval,
} from '../src/compatibility.ts';

describe('loadCellFactorQ', () => {
  it('reduces to 1 with no dead load, zero range, or tare', () => {
    expect(
      loadCellFactorQ({ max: 150, deadLoad: 0, initialZeroSettingRange: 0, nonUniformDistribution: 0, additiveTare: 0 }),
    ).toBe(1);
  });

  it('adds every parasitic load proportionally', () => {
    // (150 + 10 + 6 + 0 + 50) / 150 = 216 / 150 = 1.44
    expect(
      loadCellFactorQ({ max: 150, deadLoad: 10, initialZeroSettingRange: 6, nonUniformDistribution: 0, additiveTare: 50 }),
    ).toBeCloseTo(1.44, 10);
  });
});

describe('checkLoadCellCapacity', () => {
  it('passes when the cell covers the factored load', () => {
    // Q = 1.44, Max = 150, R = 1, N = 1 → 216 ≤ 250
    expect(
      checkLoadCellCapacity({ q: 1.44, max: 150, numCells: 1, cellEmax: 250 }).pass,
    ).toBe(true);
  });

  it('fails when it does not', () => {
    expect(
      checkLoadCellCapacity({ q: 1.44, max: 150, numCells: 1, cellEmax: 200 }).pass,
    ).toBe(false);
  });
});

describe('checkMinVerificationInterval', () => {
  it('compares against e·R/√N', () => {
    expect(checkMinVerificationInterval({ cellVmin: 0.005, e: 0.02, numCells: 1 }).pass).toBe(true);
    expect(checkMinVerificationInterval({ cellVmin: 0.05, e: 0.02, numCells: 1 }).pass).toBe(false);
  });
});

describe('signalPerInterval', () => {
  it('computes millivolts per verification interval', () => {
    // 2 mV/V · 5 V · 1 · 0.02 g / (250 g · 1) = 0.2 / 250 = 0.0008 mV
    expect(
      signalPerInterval({ cellSensitivityMVV: 2, excitationVoltageV: 5, e: 0.02, cellEmax: 250, numCells: 1 }),
    ).toBeCloseTo(0.0008, 10);
  });

  it('checkSignalVoltage enforces the indicator minimum', () => {
    const base = { cellSensitivityMVV: 2, excitationVoltageV: 5, e: 0.02, cellEmax: 250, numCells: 1 };
    expect(checkSignalVoltage({ ...base, indicatorDeltaUMinMV: 0.0005 }).pass).toBe(true);
    expect(checkSignalVoltage({ ...base, indicatorDeltaUMinMV: 0.001 }).pass).toBe(false);
  });
});

describe('checkImpedance', () => {
  it('accepts a combined impedance inside the indicator range', () => {
    expect(
      checkImpedance({ cellImpedanceOhm: 1100, numCells: 4, indicatorMinOhm: 200, indicatorMaxOhm: 1000 }).pass,
    ).toBe(true);
  });

  it('rejects one outside it', () => {
    expect(
      checkImpedance({ cellImpedanceOhm: 5000, numCells: 4, indicatorMinOhm: 200, indicatorMaxOhm: 1000 }).pass,
    ).toBe(false);
  });
});

describe('checkVerificationIntervals', () => {
  it('requires both module counts to cover the instrument', () => {
    expect(checkVerificationIntervals({ indicatorN: 7500, loadCellN: 10000, instrumentN: 7500 }).pass).toBe(true);
    expect(checkVerificationIntervals({ indicatorN: 5000, loadCellN: 10000, instrumentN: 7500 }).pass).toBe(false);
  });
});

describe('checkTemperatureSpan', () => {
  it('requires module spans to cover the instrument span', () => {
    const cover = { cellMin: -10, cellMax: 40, indicatorMin: -10, indicatorMax: 40, instrumentMin: 5, instrumentMax: 40 };
    expect(checkTemperatureSpan(cover).pass).toBe(true);
    expect(checkTemperatureSpan({ ...cover, cellMin: 10 }).pass).toBe(false);
  });
});
