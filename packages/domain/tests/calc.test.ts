import { describe, expect, it } from 'vitest';
import {
  computeEccentricity,
  computeEquilibrium,
  computeEsd,
  computeN,
  computeObservations,
  computeRadiated,
  computeRepeatability,
  computeSpanStability,
  computeZeroCreep,
  eccentricityPositions,
  generateReferenceWeights,
  summariseTable,
} from '../src/calc.ts';
import type { InstrumentSpec, ObservationInput } from '../src/types.ts';

const NHB150: InstrumentSpec = {
  max: 150,
  min: 0.4,
  e: 0.02,
  d: 0.002,
  accuracyClass: 'II',
  fractionalFactorPi: 1,
  mpdSpanStability: 0.25,
};

/** The literal intrinsic-error rows from section 6 of the build spec, at 20.3 °C. */
const SEED_ROWS: ObservationInput[] = [
  { sequenceNo: 1, loadValue: 0.4, indicationUp: 0.396, indicationDown: 0.4 },
  { sequenceNo: 2, loadValue: 2.4, indicationUp: 2.396, indicationDown: 2.4 },
  { sequenceNo: 3, loadValue: 5, indicationUp: 4.996, indicationDown: 5 },
  { sequenceNo: 4, loadValue: 10, indicationUp: 9.996, indicationDown: 10 },
  { sequenceNo: 5, loadValue: 30, indicationUp: 29.998, indicationDown: 29.996 },
  { sequenceNo: 6, loadValue: 50, indicationUp: 49.996, indicationDown: 49.996 },
  { sequenceNo: 7, loadValue: 70, indicationUp: 69.996, indicationDown: 69.996 },
  { sequenceNo: 8, loadValue: 90, indicationUp: 90, indicationDown: 89.998 },
  { sequenceNo: 9, loadValue: 110, indicationUp: 109.998, indicationDown: 109.998 },
  { sequenceNo: 10, loadValue: 130, indicationUp: 129.998, indicationDown: 130 },
  { sequenceNo: 11, loadValue: 150, indicationUp: 149.998, indicationDown: 149.998 },
];

describe('computeN', () => {
  it('computes n = Max / e for the demo instrument', () => {
    expect(computeN(150, 0.02)).toBe(7500);
  });

  it('rounds away float division noise instead of reporting 7499.999...', () => {
    expect(Number.isInteger(computeN(150, 0.02))).toBe(true);
  });

  it('does not divide by zero', () => {
    expect(computeN(150, 0)).toBe(0);
  });
});

describe('computeObservations — the seeded intrinsic error table', () => {
  const rows = computeObservations(SEED_ROWS, NHB150, { testTypeCode: 'INTRINSIC' });

  it('computes a row for every load', () => {
    expect(rows).toHaveLength(11);
  });

  it('reproduces the documented error at the first load', () => {
    // E = 0.396 + 0.01 - 0.4 = 0.006
    expect(rows[0]!.errorUp).toBeCloseTo(0.006, 6);
    // E = 0.4 + 0.01 - 0.4 = 0.01
    expect(rows[0]!.errorDown).toBeCloseTo(0.01, 6);
  });

  it('subtracts a recorded changeover weight from the error', () => {
    const base = { sequenceNo: 1, loadValue: 100, indicationUp: 100.01, indicationDown: null };
    const plain = computeObservations([base], NHB150, { testTypeCode: 'INTRINSIC' });
    const withDelta = computeObservations([{ ...base, deltaLUp: 0.004 }], NHB150, {
      testTypeCode: 'INTRINSIC',
    });
    // E changes by exactly −ΔL; the verdict machinery is untouched.
    expect(withDelta[0]!.errorUp).toBeCloseTo((plain[0]!.errorUp ?? 0) - 0.004, 6);
  });

  it('passes every seeded row, as the source report does', () => {
    // Section 6 states all rows pass. This is the headline regression test: if a
    // rule change breaks the reference dataset, this fails loudly.
    expect(rows.every((row) => row.rowPass)).toBe(true);
  });

  it('references corrected error to the lowest entered load', () => {
    // E0 is taken from the 0.4 g row, so its own corrected error is zero.
    expect(rows[0]!.correctedErrorUp).toBeCloseTo(0, 6);
  });

  it('computes n_i and the MPE band per row', () => {
    expect(rows[0]!.nI).toBeCloseTo(20, 1); // 0.4 / 0.02
    expect(rows[0]!.mpeInE).toBe(0.5);
    expect(rows[0]!.mpe).toBeCloseTo(0.01, 6);

    expect(rows[10]!.nI).toBeCloseTo(7500, 1); // 150 / 0.02
    expect(rows[10]!.mpeInE).toBe(1.0); // OIML Class II: 5000 < n_i <= 20000
  });

  it('rounds derived columns to the instrument precision, not raw float output', () => {
    for (const row of rows) {
      expect(String(row.errorUp ?? 0)).not.toMatch(/\d{8,}/);
    }
  });

  it('sorts by sequence number regardless of input order', () => {
    const shuffled = [...SEED_ROWS].reverse();
    const out = computeObservations(shuffled, NHB150, { testTypeCode: 'INTRINSIC' });
    expect(out.map((r) => r.sequenceNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('computeObservations — incomplete and failing data', () => {
  it('marks a row with no indications as incomplete rather than failed', () => {
    const rows = computeObservations(
      [{ sequenceNo: 1, loadValue: 50, indicationUp: null, indicationDown: null }],
      NHB150,
    );
    expect(rows[0]!.verdict).toBe('incomplete');
    expect(rows[0]!.rowPass).toBe(false);
    expect(rows[0]!.errorUp).toBeNull();
  });

  it('still computes the MPE for an empty row, so the tolerance is visible up front', () => {
    const rows = computeObservations(
      [{ sequenceNo: 1, loadValue: 50, indicationUp: null, indicationDown: null }],
      NHB150,
    );
    expect(rows[0]!.mpe).toBeCloseTo(0.01, 6); // n_i = 2500 -> 0.5 e (OIML Class II)
  });

  it('fails a row where one direction drifts out of tolerance', () => {
    const tampered = SEED_ROWS.map((row) =>
      row.sequenceNo === 6 ? { ...row, indicationUp: 49.5 } : row,
    );
    const rows = computeObservations(tampered, NHB150, { testTypeCode: 'INTRINSIC' });
    expect(rows[5]!.rowPass).toBe(false);
    expect(rows[5]!.verdict).toBe('fail');
    // Neighbours are unaffected.
    expect(rows[4]!.rowPass).toBe(true);
    expect(rows[6]!.rowPass).toBe(true);
  });

  it('handles an empty table without throwing', () => {
    expect(computeObservations([], NHB150)).toEqual([]);
  });
});

describe('summariseTable', () => {
  it('rolls the seeded table up to an overall pass', () => {
    const summary = summariseTable(SEED_ROWS, NHB150, { testTypeCode: 'INTRINSIC' });
    expect(summary.overallPass).toBe(true);
    expect(summary.verdict).toBe('pass');
    expect(summary.rowsEntered).toBe(11);
    expect(summary.rowsTotal).toBe(11);
    expect(summary.failingRows).toEqual([]);
  });

  it('flips to fail and names the offending row when one indication is edited', () => {
    // This is the live demo moment: tweak one value, watch the summary flip.
    const tampered = SEED_ROWS.map((row) =>
      row.sequenceNo === 6 ? { ...row, indicationUp: 49.5 } : row,
    );
    const summary = summariseTable(tampered, NHB150, { testTypeCode: 'INTRINSIC' });
    expect(summary.overallPass).toBe(false);
    expect(summary.verdict).toBe('fail');
    expect(summary.failingRows).toEqual([6]);
  });

  it('reports incomplete while any row is still blank', () => {
    const partial = SEED_ROWS.map((row) =>
      row.sequenceNo === 11 ? { ...row, indicationUp: null, indicationDown: null } : row,
    );
    const summary = summariseTable(partial, NHB150, { testTypeCode: 'INTRINSIC' });
    expect(summary.verdict).toBe('incomplete');
    expect(summary.overallPass).toBe(false);
    expect(summary.rowsEntered).toBe(10);
  });

  it('never reports a pass for an empty table', () => {
    expect(summariseTable([], NHB150).overallPass).toBe(false);
    expect(summariseTable([], NHB150).verdict).toBe('incomplete');
  });

  it('reports the worst error magnitude and the MPE band range', () => {
    const summary = summariseTable(SEED_ROWS, NHB150, { testTypeCode: 'INTRINSIC' });
    // Largest |E| across the seeded rows is 0.01 (e.g. the 0.4 g down reading),
    // which sits exactly on the 0.5 e tolerance for that load.
    expect(summary.worstError).toBeCloseTo(0.01, 6);
    expect(summary.mpeInERange).toEqual([0.5, 1.0]);
  });
});

/*
 * The judged error is the column the verdict was actually reached on. It exists because a chart
 * or a highlight that guesses ("corrected if it is there, else raw") is right for the tests
 * judged on corrected error and silently wrong for every other one — and the failure is a
 * marker drawn inside the tolerance band beside a row the report has just marked fail.
 *
 * These tests are written around the case where the two columns disagree, because that is the
 * only case that can catch a regression: on the seeded data the corrected and raw errors are
 * close enough that a wrong pick still lands in roughly the right place.
 */
describe('the judged error column', () => {
  // Row 7 nudged 0.03 g high. Raw error 0.036 exceeds the 0.01 tolerance at that load;
  // the corrected error is 0.03, also outside. Both columns fail here, so the row is
  // useful for checking publication (each basis publishes its own column) rather than
  // for a split verdict.
  const DIVERGENT: ObservationInput[] = SEED_ROWS.map((row) =>
    row.sequenceNo === 7 ? { ...row, indicationUp: 70.026 } : row,
  );

  it('publishes the raw error for a test judged on raw error', () => {
    const row = computeObservations(DIVERGENT, NHB150, { testTypeCode: 'INTRINSIC' })[6]!;
    expect(row.errorBasis).toBe('error');
    expect(row.judgedErrorUp).toBe(row.errorUp);
    expect(row.judgedErrorUp).not.toBe(row.correctedErrorUp);
  });

  it('publishes the corrected error for a test judged on corrected error', () => {
    const row = computeObservations(DIVERGENT, NHB150, { errorBasis: 'corrected_error' })[6]!;
    expect(row.judgedErrorUp).toBe(row.correctedErrorUp);
  });

  it('agrees with the verdict it was used to reach', () => {
    for (const basis of ['error', 'corrected_error'] as const) {
      for (const row of computeObservations(DIVERGENT, NHB150, { errorBasis: basis })) {
        if (row.verdict === 'incomplete') continue;
        const worst = Math.max(
          Math.abs(row.judgedErrorUp ?? 0),
          Math.abs(row.judgedErrorDown ?? 0),
        );
        expect(row.rowPass).toBe(worst <= row.mpe);
      }
    }
  });

  it('is null on a row with no reading, so "not measured" cannot be plotted as zero', () => {
    const rows = computeObservations(
      [{ sequenceNo: 1, loadValue: 50, indicationUp: null, indicationDown: null }],
      NHB150,
    );
    expect(rows[0]!.judgedErrorUp).toBeNull();
    expect(rows[0]!.judgedErrorDown).toBeNull();
  });

  it('is the column the table summary reports its worst error from', () => {
    // Same rows, different basis: if the summary re-derived the basis instead of reading the
    // rows, the headline figure could disagree with the table printed underneath it.
    const raw = summariseTable(DIVERGENT, NHB150, { errorBasis: 'error' });
    const corrected = summariseTable(DIVERGENT, NHB150, { errorBasis: 'corrected_error' });
    expect(raw.worstError).not.toBe(corrected.worstError);
    for (const summary of [raw, corrected]) {
      const fromRows = Math.max(
        ...summary.rows.flatMap((r) => [r.judgedErrorUp, r.judgedErrorDown])
          .filter((v): v is number => v !== null)
          .map(Math.abs),
      );
      expect(summary.worstError).toBeCloseTo(fromRows, 6);
    }
  });

  it('is published by the single-direction tables too, naming their own basis', () => {
    // A consumer should be able to read one field across every table shape rather than
    // remembering which column each test type judges.
    const ecc = computeEccentricity(
      [
        { sequenceNo: 1, positionCode: 'a', positionLabel: 'Centre', loadZero: 0,
          indicationZero: 0, loadValue: 50, indication: 49.996 },
        { sequenceNo: 2, positionCode: 'b', positionLabel: 'Front left', loadZero: 0,
          indicationZero: 0, loadValue: 50, indication: 50.02 },
      ],
      NHB150,
    );
    expect(ecc.rows[1]!.errorBasis).toBe('corrected_error');
    expect(ecc.rows[1]!.judgedError).toBe(ecc.rows[1]!.correctedError);
    expect(ecc.rows[1]!.judgedError).not.toBe(ecc.rows[1]!.error);

    const esd = computeEsd(
      [
        { sequenceNo: 1, testVoltageKv: 4, applicationMode: 'contact', polarity: 'positive',
          loadValue: 50, indicationBefore: 50, indicationAfter: 50.004 },
      ],
      NHB150,
    );
    expect(esd.rows[0]!.errorBasis).toBe('error');
    expect(esd.rows[0]!.judgedError).toBe(esd.rows[0]!.error);
  });
});

describe('computeRepeatability', () => {
  const trials = [90.002, 90.0, 90.004, 90.002, 90.0, 90.002, 90.004, 90.0, 90.002, 90.002].map(
    (indication, i) => ({ sequenceNo: i + 1, indication }),
  );

  it('computes P = I - I0 per trial and the resulting range', () => {
    const result = computeRepeatability(trials, 90, 0, NHB150);
    expect(result.trials[0]!.p).toBeCloseTo(90.002, 6);
    expect(result.range).toBeCloseTo(0.004, 6);
  });

  it('passes when the range is inside the MPE at that load', () => {
    const result = computeRepeatability(trials, 90, 0, NHB150);
    expect(result.mpe).toBeCloseTo(0.01, 6); // n_i = 4500 -> 0.5 e (OIML Class II)
    expect(result.overallPass).toBe(true);
    expect(result.verdict).toBe('pass');
  });

  it('subtracts a non-zero tare reading', () => {
    const result = computeRepeatability(trials, 90, 0.002, NHB150);
    expect(result.trials[0]!.p).toBeCloseTo(90.0, 6);
    // A constant offset shifts every P equally, so the range is unchanged.
    expect(result.range).toBeCloseTo(0.004, 6);
  });

  it('fails when one trial is an outlier', () => {
    const withOutlier = [...trials.slice(0, 9), { sequenceNo: 10, indication: 90.5 }];
    const result = computeRepeatability(withOutlier, 90, 0, NHB150);
    expect(result.overallPass).toBe(false);
    expect(result.verdict).toBe('fail');
  });

  it('is incomplete with fewer than two entered trials', () => {
    const result = computeRepeatability(
      [{ sequenceNo: 1, indication: 90 }, { sequenceNo: 2, indication: null }],
      90,
      0,
      NHB150,
    );
    expect(result.verdict).toBe('incomplete');
  });
});

describe('computeEccentricity', () => {
  const positions = eccentricityPositions('rectangular_4corner').map((p, i) => ({
    sequenceNo: i + 1,
    positionCode: p.code,
    positionLabel: p.label,
    loadZero: 0,
    indicationZero: 0,
    loadValue: 50,
    indication: 50.002,
  }));

  it('produces one row per loading position', () => {
    expect(computeEccentricity(positions, NHB150).rows).toHaveLength(5);
  });

  it('offers 4 corners plus centre for a rectangular pan, 3 points plus centre for triangular', () => {
    expect(eccentricityPositions('rectangular_4corner')).toHaveLength(5);
    expect(eccentricityPositions('triangular_3point')).toHaveLength(4);
  });

  /**
   * The coordinates are consumed by two renderers (the on-screen diagram and the report
   * figure) that draw a dot per position and colour it by verdict. If a label and its
   * coordinate ever disagree, both renderers agree with each other and both are wrong — the
   * figure would mark a different corner than the one that actually failed, which is a
   * defect no amount of correct arithmetic upstream would catch. So the geometry is asserted
   * against the words.
   */
  it('places every position where its label says it is', () => {
    const at = (shape: 'rectangular_4corner' | 'triangular_3point', code: string) => {
      const found = eccentricityPositions(shape).find((p) => p.code === code);
      expect(found).toBeDefined();
      return found!;
    };

    for (const shape of ['rectangular_4corner', 'triangular_3point'] as const) {
      for (const position of eccentricityPositions(shape)) {
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThanOrEqual(1);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThanOrEqual(1);
      }
      // Centre is centred, in both shapes.
      expect(at(shape, 'a').x).toBeCloseTo(0.5, 6);
      expect(at(shape, 'a').y).toBeCloseTo(0.5, 6);
    }

    // y grows towards the front, so "front" is the larger y and "rear" the smaller.
    const frontLeft = at('rectangular_4corner', 'b');
    const frontRight = at('rectangular_4corner', 'c');
    const rearRight = at('rectangular_4corner', 'd');
    const rearLeft = at('rectangular_4corner', 'e');

    expect(frontLeft.label).toBe('Front left');
    expect(frontLeft.x).toBeLessThan(0.5);
    expect(frontLeft.y).toBeGreaterThan(0.5);

    expect(frontRight.label).toBe('Front right');
    expect(frontRight.x).toBeGreaterThan(0.5);
    expect(frontRight.y).toBeGreaterThan(0.5);

    expect(rearRight.label).toBe('Rear right');
    expect(rearRight.x).toBeGreaterThan(0.5);
    expect(rearRight.y).toBeLessThan(0.5);

    expect(rearLeft.label).toBe('Rear left');
    expect(rearLeft.x).toBeLessThan(0.5);
    expect(rearLeft.y).toBeLessThan(0.5);

    // The four corners sit symmetrically about the centre.
    expect(frontLeft.x).toBeCloseTo(1 - frontRight.x, 6);
    expect(frontLeft.y).toBeCloseTo(1 - rearLeft.y, 6);

    const front = at('triangular_3point', 'b');
    const triRearLeft = at('triangular_3point', 'c');
    const triRearRight = at('triangular_3point', 'd');
    expect(front.y).toBeGreaterThan(0.5);
    expect(front.x).toBeCloseTo(0.5, 6);
    expect(triRearLeft.x).toBeLessThan(0.5);
    expect(triRearRight.x).toBeGreaterThan(0.5);
    expect(triRearLeft.y).toBeLessThan(0.5);
    expect(triRearLeft.y).toBeCloseTo(triRearRight.y, 6);
  });

  it('spaces the three supports of a triangular receptor evenly about the centre', () => {
    const positions = eccentricityPositions('triangular_3point');
    const centre = positions[0]!;
    const supports = positions.slice(1);

    // Equal radii: the supports lie on a circle about the centre.
    const radii = supports.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0]!, 3);

    // Equal spacing: 120° apart, so each pair is the same distance from the others.
    const gap = (a: typeof centre, b: typeof centre) => Math.hypot(a.x - b.x, a.y - b.y);
    const sides = [
      gap(supports[0]!, supports[1]!),
      gap(supports[1]!, supports[2]!),
      gap(supports[2]!, supports[0]!),
    ];
    for (const side of sides) expect(side).toBeCloseTo(sides[0]!, 3);
  });

  it('references corrected error to the centre position', () => {
    const result = computeEccentricity(positions, NHB150);
    expect(result.rows[0]!.positionCode).toBe('a');
    expect(result.rows[0]!.correctedError).toBeCloseTo(0, 6);
  });

  it('passes when every off-centre reading matches the centre', () => {
    const result = computeEccentricity(positions, NHB150);
    expect(result.overallPass).toBe(true);
  });

  it('fails a corner that deviates beyond the MPE', () => {
    const skewed = positions.map((p) =>
      p.positionCode === 'd' ? { ...p, indication: 50.2 } : p,
    );
    const result = computeEccentricity(skewed, NHB150);
    expect(result.overallPass).toBe(false);
    expect(result.rows.find((r) => r.positionCode === 'd')!.verdict).toBe('fail');
  });
});

describe('computeEsd', () => {
  const rows = [2, 4, 6].flatMap((kv, i) =>
    ['positive', 'negative'].map((polarity, j) => ({
      sequenceNo: i * 2 + j + 1,
      testVoltageKv: kv,
      applicationMode: 'contact',
      polarity,
      loadValue: 100,
      indicationBefore: 100.002,
      indicationAfter: 100.002,
    })),
  );

  it('judges the before/after change in indication', () => {
    const result = computeEsd(rows, NHB150);
    expect(result.rows[0]!.error).toBeCloseTo(0, 6);
    expect(result.overallPass).toBe(true);
  });

  it('cancels an offset present in both readings', () => {
    const offset = rows.map((r) => ({ ...r, indicationBefore: 100.5, indicationAfter: 100.5 }));
    expect(computeEsd(offset, NHB150).overallPass).toBe(true);
  });

  it('fails a discharge that shifts the indication beyond the MPE', () => {
    const disturbed = rows.map((r) =>
      r.sequenceNo === 5 ? { ...r, indicationAfter: 100.2 } : r,
    );
    const result = computeEsd(disturbed, NHB150);
    expect(result.overallPass).toBe(false);
    expect(result.rows[4]!.verdict).toBe('fail');
  });
});

describe('computeRadiated', () => {
  const sweep = [80, 200, 1000].map((mhz, i) => ({
    sequenceNo: i + 1,
    frequencyMhz: mhz,
    fieldStrengthVM: 10,
    loadValue: 100,
    indicationBefore: 100.002,
    indicationAfter: 100.002,
  }));

  it('passes a quiet sweep at every frequency step', () => {
    const result = computeRadiated(sweep, NHB150);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]!.error).toBeCloseTo(0, 6);
    expect(result.overallPass).toBe(true);
  });

  it('fails the step where the field moves the indication beyond the MPE', () => {
    const disturbed = sweep.map((r) =>
      r.sequenceNo === 2 ? { ...r, indicationAfter: 100.2 } : r,
    );
    const result = computeRadiated(disturbed, NHB150);
    expect(result.overallPass).toBe(false);
    expect(result.rows[1]!.verdict).toBe('fail');
    expect(result.rows[0]!.verdict).toBe('pass');
  });
});

describe('computeSpanStability', () => {
  const measurements = [
    { sequenceNo: 1, condition: 'Reference', measuredAt: '2011-01-05', loadValue: 150, indication: 149.998, indicationZero: 0 },
    { sequenceNo: 2, condition: 'After temperature test', measuredAt: '2011-01-20', loadValue: 150, indication: 150.002, indicationZero: 0 },
    { sequenceNo: 3, condition: 'After damp heat', measuredAt: '2011-02-10', loadValue: 150, indication: 150.004, indicationZero: 0 },
  ];

  it('computes the corrected error per measurement', () => {
    const result = computeSpanStability(measurements, NHB150);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]!.correctedError).not.toBeNull();
  });

  it('compares the spread to the absolute mpd from the instrument model', () => {
    const result = computeSpanStability(measurements, NHB150);
    expect(result.mpd).toBe(0.25);
    expect(result.range).toBeCloseTo(0.006, 6);
    expect(result.overallPass).toBe(true);
  });

  it('fails when the span drifts beyond mpd', () => {
    const drifted = measurements.map((m) =>
      m.sequenceNo === 3 ? { ...m, indication: 150.5 } : m,
    );
    const result = computeSpanStability(drifted, NHB150);
    expect(result.overallPass).toBe(false);
    expect(result.verdict).toBe('fail');
  });

  it('uses mpd rather than a multiple of e', () => {
    // A drift of 0.1 g is 5 e — far outside any staircase band — yet inside mpd.
    const drifted = measurements.map((m) =>
      m.sequenceNo === 3 ? { ...m, indication: 150.098 } : m,
    );
    expect(computeSpanStability(drifted, NHB150).overallPass).toBe(true);
  });
});

describe('generateReferenceWeights', () => {
  const points = generateReferenceWeights(NHB150);

  it('produces roughly 10-11 points spanning Min to Max', () => {
    expect(points.length).toBeGreaterThanOrEqual(10);
    expect(points.length).toBeLessThanOrEqual(12);
    expect(points[0]).toBe(NHB150.min);
    expect(points[points.length - 1]).toBe(NHB150.max);
  });

  it('returns points in ascending order', () => {
    const sorted = [...points].sort((a, b) => a - b);
    expect(points).toEqual(sorted);
  });

  it('snaps every point to the scale interval', () => {
    // A technician cannot apply a load the instrument cannot resolve.
    for (const point of points.slice(1)) {
      const intervals = point / NHB150.e;
      expect(Math.abs(intervals - Math.round(intervals))).toBeLessThan(1e-6);
    }
  });

  it('never exceeds Max or falls below Min', () => {
    for (const point of points) {
      expect(point).toBeGreaterThanOrEqual(NHB150.min);
      expect(point).toBeLessThanOrEqual(NHB150.max);
    }
  });

  it('generalises to a different instrument', () => {
    const bigger = generateReferenceWeights({ max: 6000, min: 20, e: 1, d: 1 });
    expect(bigger[0]).toBe(20);
    expect(bigger[bigger.length - 1]).toBe(6000);
    expect(new Set(bigger).size).toBe(bigger.length);
  });

  it('produces no duplicates after snapping a coarse instrument', () => {
    const coarse = generateReferenceWeights({ max: 10, min: 1, e: 1, d: 1 });
    expect(new Set(coarse).size).toBe(coarse.length);
  });
});

describe('computeEquilibrium — spread against a fixed 1 e', () => {
  const trials = (indications: Array<number | null>) =>
    indications.map((indication, i) => ({ sequenceNo: i + 1, indication }));

  it('passes a settled set (spread 0.014 g within 0.02 g)', () => {
    const r = computeEquilibrium(
      trials([150.0, 150.008, 149.994, 150.003, 149.999]),
      150,
      NHB150,
    );
    expect(r.verdict).toBe('pass');
    expect(r.overallPass).toBe(true);
    expect(r.tolerance).toBeCloseTo(0.02, 6);
    expect(r.spread).toBeCloseTo(0.014, 6);
  });

  it('fails when one reading wanders past 1 e', () => {
    const r = computeEquilibrium(
      trials([150.0, 150.008, 149.994, 150.03, 149.999]),
      150,
      NHB150,
    );
    expect(r.verdict).toBe('fail');
    expect(r.overallPass).toBe(false);
  });

  it('is incomplete with fewer than two readings', () => {
    expect(computeEquilibrium(trials([150.0]), 150, NHB150).verdict).toBe('incomplete');
    expect(computeEquilibrium(trials([null, null]), 150, NHB150).verdict).toBe('incomplete');
  });

  it('shows deviation from the mean per trial', () => {
    const r = computeEquilibrium(trials([150.0, 150.01]), 150, NHB150);
    expect(r.trials[0].deviation).toBeCloseTo(-0.005, 6);
    expect(r.trials[1].deviation).toBeCloseTo(0.005, 6);
  });
});

describe('computeZeroCreep — residual plus drift, one verdict', () => {
  const zero = (indication: number | null) => ({
    sequenceNo: 1,
    condition: 'Zero return (unloaded)',
    measuredAt: null,
    loadValue: 0,
    indication,
  });
  const creep = (indication: number | null, i: number) => ({
    sequenceNo: i + 2,
    condition: `Creep hold, ${i * 10} min`,
    measuredAt: null,
    loadValue: 150,
    indication,
  });
  const rows = (zeroInd: number | null, creepInds: Array<number | null>) => [
    zero(zeroInd),
    ...creepInds.map(creep),
  ];

  it('passes a stable instrument', () => {
    const r = computeZeroCreep(rows(0.002, [150.0, 150.002, 150.004, 150.003]), NHB150);
    expect(r.verdict).toBe('pass');
    expect(r.zeroPass).toBe(true);
    expect(r.creepPass).toBe(true);
  });

  it('fails the zero check when the residual exceeds 0.25 e (0.005 g)', () => {
    const r = computeZeroCreep(rows(0.008, [150.0, 150.002, 150.004, 150.003]), NHB150);
    expect(r.verdict).toBe('fail');
    expect(r.zeroPass).toBe(false);
    expect(r.creepPass).toBe(true);
  });

  it('fails the creep check when drift exceeds 0.5 e (0.01 g)', () => {
    const r = computeZeroCreep(rows(0.0, [150.0, 150.004, 150.008, 150.014]), NHB150);
    expect(r.verdict).toBe('fail');
    expect(r.zeroPass).toBe(true);
    expect(r.creepPass).toBe(false);
  });

  it('is incomplete without a zero reading or with one creep reading', () => {
    expect(computeZeroCreep(rows(null, [150.0, 150.002]), NHB150).verdict).toBe('incomplete');
    expect(computeZeroCreep(rows(0.0, [150.0]), NHB150).verdict).toBe('incomplete');
  });

  it('judges the last entered zero reading', () => {
    const r = computeZeroCreep(
      [zero(0.008), zero(0.002), ...[150.0, 150.002].map(creep)],
      NHB150,
    );
    expect(r.zeroResidual).toBeCloseTo(0.002, 6);
    expect(r.zeroPass).toBe(true);
  });
});
