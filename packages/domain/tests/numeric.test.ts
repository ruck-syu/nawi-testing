import { describe, expect, it } from 'vitest';
import {
  decimalPlaces,
  decimalsFor,
  formatAtPrecision,
  formatFixed,
  maxOf,
  minOf,
  roundTo,
  spread,
} from '../src/numeric.ts';

/** NHB150: e = 0.02 g, d = 0.002 g — the instrument the seed data is taken from. */
const E = 0.02;
const D = 0.002;

describe('decimalsFor', () => {
  it('takes the finer of e and d and adds a digit of headroom for the ½e term', () => {
    expect(decimalsFor(E, D)).toBe(4);
  });

  it('follows d when d is finer than e', () => {
    expect(decimalsFor(0.02, 0.002)).toBe(4);
    expect(decimalsFor(0.1, 0.01)).toBe(3);
  });

  it('handles whole-unit instruments without producing negative precision', () => {
    expect(decimalsFor(1, 1)).toBe(1);
    expect(decimalsFor(10, 10)).toBe(1);
    expect(decimalsFor(2000, 2000)).toBe(1);
  });

  it('falls back to 3 places rather than throwing on a missing interval', () => {
    expect(decimalsFor(0)).toBe(3);
    expect(decimalsFor(Number.NaN)).toBe(3);
  });
});

describe('formatFixed', () => {
  it('formats at the decimal count it is given', () => {
    expect(formatFixed(0.396, 4)).toBe('0.3960');
    expect(formatFixed(149.998, 4)).toBe('149.9980');
    expect(formatFixed(-0.004, 4)).toBe('-0.0040');
  });

  it('renders an interval count as a whole number when asked for 0 places', () => {
    // Regression: n_i is a count of scale intervals. It once rendered as "20.000"
    // because a 0 was being read as a scale interval rather than a decimal count.
    expect(formatFixed(20, 0)).toBe('20');
    expect(formatFixed(7500, 0)).toBe('7500');
  });

  it('returns an empty string for values that were never measured', () => {
    expect(formatFixed(null, 4)).toBe('');
    expect(formatFixed(undefined, 4)).toBe('');
    expect(formatFixed(Number.NaN, 4)).toBe('');
  });

  it('clamps nonsense precision instead of throwing a RangeError', () => {
    // toFixed throws outside 0..100; a report render must not die on bad input.
    expect(formatFixed(1.5, -3)).toBe('2');
    expect(() => formatFixed(1.5, 1e9)).not.toThrow();
  });
});

describe('formatAtPrecision', () => {
  it('takes a scale interval, not a decimal count', () => {
    expect(formatAtPrecision(0.396, E, D)).toBe('0.3960');
    expect(formatAtPrecision(149.998, E, D)).toBe('149.9980');
  });

  /**
   * The bug this guards against: `formatAtPrecision(0.396, 4)` reads 4 as "e = 4 g",
   * derives 1 decimal place from it, and returns "0.4" — silently discarding the
   * measurement instead of failing. It reached a rendered report once. The two functions
   * are kept separate so the call site says which quantity it is passing.
   */
  it('is not interchangeable with formatFixed', () => {
    expect(formatAtPrecision(0.396, 4)).toBe('0.4');
    expect(formatFixed(0.396, 4)).toBe('0.3960');
    expect(formatAtPrecision(0.396, 4)).not.toBe(formatFixed(0.396, 4));
  });

  it('preserves every digit of the spec section 6 indications', () => {
    const indications = [0.396, 2.396, 4.996, 9.996, 29.998, 49.996, 69.996, 90, 109.998, 129.998, 149.998];
    for (const value of indications) {
      expect(Number(formatAtPrecision(value, E, D))).toBe(value);
    }
  });
});

describe('roundTo', () => {
  it('corrects float drift instead of exposing it', () => {
    expect(roundTo(0.1 + 0.2, 4)).toBe(0.3);
    expect(roundTo(149.998 - 150, 4)).toBe(-0.002);
  });

  it('rounds a value sitting exactly on a half up', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
  });
});

describe('decimalPlaces', () => {
  it('counts the places in a literal', () => {
    expect(decimalPlaces(0.002)).toBe(3);
    expect(decimalPlaces(150)).toBe(0);
    expect(decimalPlaces(1e-4)).toBe(4);
  });
});

describe('minOf / maxOf / spread', () => {
  const readings = [90.002, null, 90.0, 90.004];

  it('ignores unentered readings', () => {
    expect(minOf(readings)).toBe(90.0);
    expect(maxOf(readings)).toBe(90.004);
  });

  it('reports the peak-to-peak spread', () => {
    expect(roundTo(spread(readings)!, 4)).toBe(0.004);
  });

  it('returns null when there is nothing to compare', () => {
    expect(minOf([null, null])).toBeNull();
    expect(spread([90.002])).toBeNull();
    expect(spread([])).toBeNull();
  });
});
