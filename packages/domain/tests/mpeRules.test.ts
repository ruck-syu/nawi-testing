import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MPE_TABLE,
  MODULE_PI_DEFAULTS,
  MPE_TABLE_OIML_R76,
  MPE_TABLE_SPEC,
  bothDirectionsPass,
  checkPiBudget,
  computeChangeoverError,
  computeCorrectedError,
  computeError,
  errorBasisFor,
  evaluateCreep,
  evaluateRepeatability,
  evaluateSpanStability,
  evaluateStabilityOfEquilibrium,
  evaluateTemperatureNoLoad,
  evaluateToleranceExpression,
  evaluateZeroReturn,
  hasStandardResolution,
  intervalsForLoad,
  isWithinMPE,
  lookupMPE,
  lookupMPE_ClassII,
  lookupMpeMultiplier,
  moduleMpe,
  mpeForLoad,
} from '../src/mpeRules.ts';
import type { InstrumentSpec } from '../src/types.ts';

/** The NHB150 demo instrument, from section 6 of the build spec. */
const NHB150: InstrumentSpec = {
  max: 150,
  min: 0.4,
  e: 0.02,
  d: 0.002,
  accuracyClass: 'II',
  fractionalFactorPi: 1,
  mpdSpanStability: 0.25,
};

describe('intervalsForLoad', () => {
  it('expresses a load in verification scale intervals', () => {
    expect(intervalsForLoad(150, 0.02)).toBe(7500);
    expect(intervalsForLoad(10, 0.02)).toBe(500);
  });

  it('is sign-insensitive, so negative drift maps to a real band', () => {
    expect(intervalsForLoad(-10, 0.02)).toBe(500);
  });

  it('degrades to zero rather than Infinity when e is missing', () => {
    expect(intervalsForLoad(150, 0)).toBe(0);
  });
});

describe('lookupMpeMultiplier — band boundaries', () => {
  // Boundaries are the whole point of a staircase table, so each one is pinned
  // on both sides. "0 <= n_i <= 500" means 500 itself sits in the 0.5 e band.
  it.each([
    [0, 0.5],
    [1, 0.5],
    [499.9, 0.5],
    [500, 0.5],
    [500.1, 1.0],
    [1999.9, 1.0],
    [2000, 1.0],
    [2000.1, 1.5],
    [10_000, 1.5],
    [10_000.1, 1.5],
    [7500, 1.5],
  ])('n_i = %s falls in the %s e band (spec table, Class II)', (nI, expected) => {
    expect(lookupMpeMultiplier(nI, 'II', MPE_TABLE_SPEC)).toBe(expected);
  });

  it('keeps a boundary value in the tighter band despite float representation', () => {
    // 0.02 * 25000 does not land exactly on 500 in binary floating point.
    const nI = intervalsForLoad(10, 0.02);
    expect(lookupMpeMultiplier(nI, 'II', MPE_TABLE_SPEC)).toBe(0.5);
  });

  it('applies different boundaries per accuracy class', () => {
    expect(lookupMpeMultiplier(1000, 'I', MPE_TABLE_SPEC)).toBe(0.5);
    expect(lookupMpeMultiplier(1000, 'II', MPE_TABLE_SPEC)).toBe(1.0);
    expect(lookupMpeMultiplier(1000, 'IIII', MPE_TABLE_SPEC)).toBe(1.5);
  });

  it('falls back to Class II when handed an unknown class', () => {
    // Guards against a bad DB value silently producing the loosest tolerance.
    expect(lookupMpeMultiplier(600, 'UNKNOWN' as never, MPE_TABLE_SPEC)).toBe(1.0);
  });
});

describe('the published-vs-specified Class II discrepancy', () => {
  // Documented at the top of mpeRules.ts. These tests exist so the difference is
  // visible and deliberate rather than a surprise in the field.
  it('disagrees for the NHB150 upper range', () => {
    const nI = intervalsForLoad(150, NHB150.e); // 7500
    expect(lookupMpeMultiplier(nI, 'II', MPE_TABLE_SPEC)).toBe(1.5);
    expect(lookupMpeMultiplier(nI, 'II', MPE_TABLE_OIML_R76)).toBe(1.0);
  });

  it('agrees in the small-load region the report shows as 0.5 e', () => {
    for (const load of [0.4, 2.4, 5, 10]) {
      const nI = intervalsForLoad(load, NHB150.e);
      expect(lookupMpeMultiplier(nI, 'II', MPE_TABLE_SPEC)).toBe(0.5);
      expect(lookupMpeMultiplier(nI, 'II', MPE_TABLE_OIML_R76)).toBe(0.5);
    }
  });

  it('defaults to the published OIML table', () => {
    expect(DEFAULT_MPE_TABLE).toBe(MPE_TABLE_OIML_R76);
  });
});

describe('changeover error', () => {
  it('reduces to the standard error when no changeover weight was recorded', () => {
    expect(computeChangeoverError(100.01, 100, 0.02, null)).toBeCloseTo(
      computeError(100.01, 100, 0.02),
      10,
    );
    expect(computeChangeoverError(100.01, 100, 0.02, undefined)).toBeCloseTo(
      computeError(100.01, 100, 0.02),
      10,
    );
  });

  it('subtracts the changeover weight: E = I + ½e − ΔL − L', () => {
    // I = 100.01, e = 0.02, ΔL = 0.004, L = 100 → 0.01 + 0.01 − 0.004 = 0.016
    expect(computeChangeoverError(100.01, 100, 0.02, 0.004)).toBeCloseTo(0.016, 10);
  });
});

describe('hasStandardResolution', () => {
  it('holds below a fifth of e (NHB150: d = e/10)', () => {
    expect(hasStandardResolution(0.002, 0.02)).toBe(true);
  });

  it('fails at or above 0.2e, where changeover becomes mandatory', () => {
    expect(hasStandardResolution(0.004, 0.02)).toBe(false);
    expect(hasStandardResolution(0.02, 0.02)).toBe(false);
  });
});

describe('modular error allocation', () => {
  it('scales the module tolerance by pi', () => {
    expect(moduleMpe(0.02, MODULE_PI_DEFAULTS.loadCell)).toBeCloseTo(0.014, 10);
    expect(moduleMpe(0.02, MODULE_PI_DEFAULTS.digital)).toBe(0);
  });

  it('passes a budget with Σ pi² ≤ 1 and fails above it', () => {
    expect(
      checkPiBudget([
        { name: 'indicator', pi: 0.5 },
        { name: 'load cell', pi: 0.7 },
      ]).pass,
    ).toBe(true);
    expect(
      checkPiBudget([
        { name: 'indicator', pi: 0.8 },
        { name: 'load cell', pi: 0.7 },
      ]).pass,
    ).toBe(false);
  });
});

describe('lookupMPE / lookupMPE_ClassII', () => {
  it('returns an absolute tolerance in the instrument unit', () => {
    expect(lookupMPE(400, 0.02, 'II')).toBeCloseTo(0.01, 10);
    expect(lookupMPE(1000, 0.02, 'II')).toBeCloseTo(0.01, 10); // n_i = 1000 -> 0.5 e (OIML Class II)
    expect(lookupMPE(5000, 0.02, 'II')).toBeCloseTo(0.01, 10); // boundary n_i = 5000 -> 0.5 e
  });

  it('the Class II convenience wrapper matches the general function', () => {
    // Regression guard: the wrapper previously transposed its arguments.
    for (const nI of [0, 250, 500, 501, 2000, 2001, 7500]) {
      expect(lookupMPE_ClassII(nI, 0.02)).toBeCloseTo(lookupMPE(nI, 0.02, 'II'), 12);
    }
  });

  it('scales with e', () => {
    expect(lookupMPE_ClassII(100, 1)).toBeCloseTo(0.5, 10);
    expect(lookupMPE_ClassII(100, 0.02)).toBeCloseTo(0.01, 10);
  });
});

describe('mpeForLoad', () => {
  it('reports the tolerance both absolutely and as a multiple of e', () => {
    const result = mpeForLoad(5, NHB150);
    expect(result.nI).toBe(250);
    expect(result.mpeInE).toBe(0.5);
    expect(result.mpe).toBeCloseTo(0.01, 10);
  });

  it('produces the 0.01 g tolerance the report prints for small loads', () => {
    // Section 6: "MPE = 0.5*e = 0.01g".
    for (const load of [0.4, 2.4, 5, 10]) {
      expect(mpeForLoad(load, NHB150).mpe).toBeCloseTo(0.01, 10);
    }
  });
});

describe('computeError', () => {
  it('applies E = I + 0.5e - L', () => {
    expect(computeError(0.396, 0.4, 0.02)).toBeCloseTo(0.006, 10);
    expect(computeError(149.998, 150, 0.02)).toBeCloseTo(0.008, 10);
  });

  it('yields exactly +0.5e when the indication equals the load', () => {
    expect(computeError(50, 50, 0.02)).toBeCloseTo(0.01, 10);
  });

  it('is positive when the instrument over-reads', () => {
    // I sits above L, so E = 50.05 + 0.01 - 50 = +0.06.
    expect(computeError(50.05, 50, 0.02)).toBeCloseTo(0.06, 10);
  });

  it('is negative when the instrument under-reads', () => {
    expect(computeError(49.95, 50, 0.02)).toBeCloseTo(-0.04, 10);
  });
});

describe('computeCorrectedError', () => {
  it('subtracts the zero-load error', () => {
    expect(computeCorrectedError(0.008, 0.006)).toBeCloseTo(0.002, 10);
  });

  it('cancels a constant offset entirely', () => {
    const offset = 0.006;
    expect(computeCorrectedError(offset, offset)).toBeCloseTo(0, 10);
  });
});

describe('isWithinMPE — boundary behaviour', () => {
  it('passes a value sitting exactly on the tolerance', () => {
    expect(isWithinMPE(0.01, 0.01)).toBe(true);
    expect(isWithinMPE(-0.01, 0.01)).toBe(true);
  });

  it('passes a boundary value carrying float noise', () => {
    // This is the case a naive `<=` gets wrong: E computes to 0.010000000000000002.
    const error = computeError(0.4, 0.4, 0.02) - 0;
    expect(error).not.toBe(0.01);
    expect(isWithinMPE(error, 0.01)).toBe(true);
  });

  it('fails a value genuinely outside tolerance', () => {
    expect(isWithinMPE(0.011, 0.01)).toBe(false);
    expect(isWithinMPE(-0.011, 0.01)).toBe(false);
  });
});

describe('bothDirectionsPass', () => {
  it('requires both loading directions to be within MPE', () => {
    expect(bothDirectionsPass(0.005, 0.005, 0.01)).toBe(true);
    expect(bothDirectionsPass(0.005, 0.05, 0.01)).toBe(false);
    expect(bothDirectionsPass(0.05, 0.005, 0.01)).toBe(false);
  });

  it('treats a missing direction as not-applicable, not as a failure', () => {
    expect(bothDirectionsPass(0.005, null, 0.01)).toBe(true);
    expect(bothDirectionsPass(null, 0.005, 0.01)).toBe(true);
  });

  it('cannot pass with no data at all', () => {
    expect(bothDirectionsPass(null, null, 0.01)).toBe(false);
  });
});

describe('fixed-tolerance rules', () => {
  it('repeatability compares the reading spread to the MPE at that load', () => {
    const result = evaluateRepeatability([90.0, 90.002, 89.998], 90, NHB150);
    expect(result.tolerance).toBeCloseTo(0.01, 10); // n_i = 4500 -> 0.5 e (OIML Class II)
    expect(result.value).toBeCloseTo(0.004, 10);
    expect(result.pass).toBe(true);
  });

  it('repeatability fails when the spread exceeds the MPE', () => {
    const result = evaluateRepeatability([90.0, 90.5], 90, NHB150);
    expect(result.pass).toBe(false);
  });

  it('repeatability is incomplete-safe with fewer than two readings', () => {
    expect(evaluateRepeatability([90.0, null], 90, NHB150).value).toBeNull();
    expect(evaluateRepeatability([90.0, null], 90, NHB150).pass).toBe(false);
  });

  it('stability of equilibrium allows a spread of 1 e', () => {
    expect(evaluateStabilityOfEquilibrium([10.0, 10.02], NHB150).pass).toBe(true);
    expect(evaluateStabilityOfEquilibrium([10.0, 10.04], NHB150).pass).toBe(false);
  });

  it('zero return allows 0.25 e in either direction', () => {
    expect(evaluateZeroReturn(0.005, NHB150).pass).toBe(true);
    expect(evaluateZeroReturn(-0.005, NHB150).pass).toBe(true);
    expect(evaluateZeroReturn(0.006, NHB150).pass).toBe(false);
  });

  it('creep allows 0.5 e of drift under load', () => {
    expect(evaluateCreep([100.0, 100.008], NHB150).pass).toBe(true);
    expect(evaluateCreep([100.0, 100.02], NHB150).pass).toBe(false);
  });

  it('temperature no-load scales the allowance with the temperature span', () => {
    // pi = 1, e = 0.02 -> 0.02 g per 5 degrees. Over 35 degrees that is 7 intervals.
    const wide = evaluateTemperatureNoLoad(0.1, 35, NHB150);
    expect(wide.tolerance).toBeCloseTo(0.14, 10);
    expect(wide.pass).toBe(true);

    const narrow = evaluateTemperatureNoLoad(0.1, 5, NHB150);
    expect(narrow.tolerance).toBeCloseTo(0.02, 10);
    expect(narrow.pass).toBe(false);
  });

  it('temperature no-load never shrinks below one 5-degree interval', () => {
    const tiny = evaluateTemperatureNoLoad(0.001, 1, NHB150);
    expect(tiny.tolerance).toBeCloseTo(0.02, 10);
  });

  it('span stability uses the absolute mpd, not a multiple of e', () => {
    const pass = evaluateSpanStability([0.01, 0.05, 0.2], NHB150);
    expect(pass.tolerance).toBe(0.25);
    expect(pass.toleranceInE).toBeNull();
    expect(pass.pass).toBe(true);

    const fail = evaluateSpanStability([0.01, 0.4], NHB150);
    expect(fail.pass).toBe(false);
  });
});

describe('evaluateToleranceExpression', () => {
  it('parses multiples of e', () => {
    expect(evaluateToleranceExpression('1*e', NHB150)).toBeCloseTo(0.02, 10);
    expect(evaluateToleranceExpression('0.25*e', NHB150)).toBeCloseTo(0.005, 10);
    expect(evaluateToleranceExpression(' 0.5 * E ', NHB150)).toBeCloseTo(0.01, 10);
  });

  it('parses expressions involving the fractional factor pi', () => {
    expect(evaluateToleranceExpression('1*pi*e', { e: 0.02, fractionalFactorPi: 0.5 })).toBeCloseTo(
      0.01,
      10,
    );
  });

  it('accepts a bare absolute tolerance', () => {
    expect(evaluateToleranceExpression('0.25', NHB150)).toBe(0.25);
  });

  it('throws rather than guessing at an unparseable expression', () => {
    // Silently returning 0 here would turn a seed-data typo into a test that
    // always fails, or worse, always passes.
    expect(() => evaluateToleranceExpression('sqrt(e)', NHB150)).toThrow(/Unsupported/);
  });
});

describe('errorBasisFor', () => {
  it('judges eccentricity and span on corrected error', () => {
    expect(errorBasisFor('ECC')).toBe('corrected_error');
    expect(errorBasisFor('SPAN')).toBe('corrected_error');
  });

  it('judges intrinsic error and temperature tests on raw error', () => {
    expect(errorBasisFor('INTRINSIC')).toBe('error');
    expect(errorBasisFor('T2')).toBe('error');
  });

  it('is case-insensitive', () => {
    expect(errorBasisFor('ecc')).toBe('corrected_error');
  });
});
