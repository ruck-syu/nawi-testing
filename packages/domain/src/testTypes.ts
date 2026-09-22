/**
 * testTypes — the TestType catalogue.
 *
 * This is seed data, not code: the server writes these rows into the `test_type` table
 * and the UI drives itself from the table, so adding the remaining R76 tests later is a
 * data change. That is why every entry carries `applicableStandards` (so a future OIML
 * revision is a new row, not an `if`) and `formKind` (so a new test that shares a table
 * layout needs no new component).
 *
 * Note how few distinct `formKind` values there are. T1-T4 and the damp-heat phases are
 * the same table as the initial intrinsic error test with a different environment header,
 * which is the whole argument that this architecture generalises: 25+ R76 tests collapse
 * onto a handful of table shapes.
 */

import type { RuleType } from './types.ts';

/** Which data-entry component renders a test. `null` means seeded but no UI yet. */
export type FormKind =
  | 'weighing_performance'
  | 'repeatability'
  | 'eccentricity'
  | 'esd'
  | 'radiated'
  | 'span_stability'
  | 'equilibrium'
  | 'zero_creep'
  | null;

export interface TestTypeDefinition {
  code: string;
  displayName: string;
  description: string;
  /** Standards this test applies under. Drives which tests appear for a project. */
  applicableStandards: string[];
  ruleType: RuleType;
  /** For FIXED_VALUE rules, e.g. "1*e" or "0.25*e". Null for table-driven rules. */
  fixedToleranceExpression: string | null;
  formKind: FormKind;
  /** Sheet reference printed in the Summary of Results table. */
  reportSheetRef: string;
  /** Grouping for the workspace sidebar. */
  category: string;
  /** Built in this prototype? False rows demonstrate the extension path. */
  implemented: boolean;
  sortOrder: number;
  /**
   * Disturbance-table parameters, for `esd`-kind tests only.
   *
   * Burst and ESD share the before/after shape but not the vocabulary: kilovolts on
   * contact/air gaps vs transients on power/signal lines. The levels seed the starter
   * rows and the modes populate the client dropdown, so a further disturbance test is
   * still a data row rather than a new component. A test whose shape genuinely differs
   * (radiated immunity is a frequency sweep, not voltage steps) gets `formKind: null`
   * instead of being squeezed into this table.
   */
  disturbance?: DisturbanceSpec;
}

/** One disturbance step: peak voltage in kV on a coupling mode. */
export interface DisturbanceSpec {
  /** Singular noun for a table step, e.g. 'discharge' or 'burst'. */
  stepNoun: string;
  /** Panel note explaining what varies in this test. */
  note: string;
  /** [value, label] pairs for the mode dropdown. */
  modes: ReadonlyArray<readonly [string, string]>;
  /** [kV, mode] starter steps, each applied in both polarities. */
  levels: ReadonlyArray<readonly [number, string]>;
}

const OIML_R76 = ['OIML R76-1:2006'];

export const TEST_TYPES: TestTypeDefinition[] = [
  {
    code: 'INTRINSIC',
    displayName: 'Initial Intrinsic Error',
    description:
      'Weighing performance at reference conditions, loading up and down across the full range. The reference test all other weighing results are compared against.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 4.1',
    category: 'Weighing performance',
    implemented: true,
    sortOrder: 10,
  },
  {
    code: 'REP',
    displayName: 'Repeatability',
    description:
      'Ten repeated applications of a single load near Max. Judges the spread of readings rather than absolute error.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'repeatability',
    reportSheetRef: 'Sheet 4.2',
    category: 'Weighing performance',
    implemented: true,
    sortOrder: 20,
  },
  {
    code: 'ECC',
    displayName: 'Eccentricity',
    description:
      'The same load applied at the centre and at each off-centre position of the load receptor. Judged on corrected error referenced to the centre.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'eccentricity',
    reportSheetRef: 'Sheet 4.3',
    category: 'Weighing performance',
    implemented: true,
    sortOrder: 30,
  },
  {
    code: 'T1',
    displayName: 'Temperature T1 — reference (20 °C)',
    description:
      'Weighing performance at the reference temperature. Same table as the intrinsic error test with an added environment header.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 5.1',
    category: 'Influence factors',
    implemented: true,
    sortOrder: 40,
  },
  {
    code: 'T2',
    displayName: 'Temperature T2 — upper limit (40 °C)',
    description:
      'Weighing performance at the upper operating temperature limit, after stabilisation in the chamber.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 5.2',
    category: 'Influence factors',
    implemented: true,
    sortOrder: 50,
  },
  {
    code: 'T3',
    displayName: 'Temperature T3 — lower limit (5 °C)',
    description:
      'Weighing performance at the lower operating temperature limit, after stabilisation in the chamber. Same table as T2 with an added environment header.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 5.3',
    category: 'Influence factors',
    implemented: true,
    sortOrder: 60,
  },
  {
    code: 'T4',
    displayName: 'Temperature T4 — return to reference',
    description:
      'Repeat of T1 after the temperature cycle, to confirm the instrument returns to its reference behaviour. Same table as T1.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 5.4',
    category: 'Influence factors',
    implemented: true,
    sortOrder: 70,
  },
  {
    code: 'EMC_ESD',
    displayName: 'EMC — Electrostatic Discharge',
    description:
      'Contact and air discharges at increasing voltage under load. A disturbance must not shift the indication by more than the MPE (a significant fault).',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'esd',
    reportSheetRef: 'Sheet 6.1',
    category: 'Disturbances (EMC)',
    implemented: true,
    sortOrder: 80,
    disturbance: {
      stepNoun: 'discharge',
      note:
        'Humidity matters here: electrostatic discharge testing is specified within a ' +
        'humidity range because dry air changes the discharge behaviour.',
      modes: [
        ['contact', 'Contact'],
        ['air', 'Air'],
      ],
      levels: [
        [2, 'contact'],
        [4, 'contact'],
        [6, 'contact'],
        [8, 'air'],
      ],
    },
  },
  {
    code: 'EMC_BURST',
    displayName: 'EMC — Electrical fast transients / bursts',
    description:
      'Fast transient bursts coupled into power and signal lines at increasing voltage. ' +
      'Judged like ESD: a shift beyond MPE is a significant fault.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'esd',
    reportSheetRef: 'Sheet 6.2',
    category: 'Disturbances (EMC)',
    implemented: true,
    sortOrder: 90,
    disturbance: {
      stepNoun: 'burst',
      note:
        'Fast transients per IEC 61000-4-4, coupled into the mains and signal lines. ' +
        'Higher repetition rate than ESD, same significant-fault criterion.',
      modes: [
        ['power', 'Power line'],
        ['signal', 'Signal line'],
      ],
      levels: [
        [0.5, 'power'],
        [1, 'power'],
        [0.5, 'signal'],
        [1, 'signal'],
      ],
    },
  },
  {
    code: 'EMC_RADIATED',
    displayName: 'EMC — Radiated electromagnetic fields',
    description:
      'Radiated field immunity sweep, 80–2000 MHz at 10 V/m with 80% AM. A frequency step must not shift the indication by more than the MPE (a significant fault).',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'radiated',
    reportSheetRef: 'Sheet 6.3',
    category: 'Disturbances (EMC)',
    implemented: true,
    sortOrder: 100,
  },
  {
    code: 'SPAN',
    displayName: 'Span Stability',
    description:
      'Span measured at intervals across the whole examination campaign. Tolerance is the absolute mpd carried on the instrument model, not a multiple of e.',
    applicableStandards: OIML_R76,
    ruleType: 'FIXED_VALUE',
    fixedToleranceExpression: null,
    formKind: 'span_stability',
    reportSheetRef: 'Sheet 7.1',
    category: 'Span stability',
    implemented: true,
    sortOrder: 110,
  },
  {
    code: 'EQUIL',
    displayName: 'Stability of Equilibrium',
    description:
      'Repeated readings at one load must agree within 1 e. Judged on the spread of the set, like repeatability with a fixed tolerance.',
    applicableStandards: OIML_R76,
    ruleType: 'FIXED_VALUE',
    fixedToleranceExpression: '1*e',
    formKind: 'equilibrium',
    reportSheetRef: 'Sheet 4.4',
    category: 'Stability',
    implemented: true,
    sortOrder: 200,
  },
  {
    code: 'ZERO_CREEP',
    displayName: 'Zero return and Creep',
    description:
      'Zero return within 0.25 e after the load is removed, and drift within 0.5 e across the hold under load. Two sub-checks, one verdict.',
    applicableStandards: OIML_R76,
    ruleType: 'FIXED_VALUE',
    fixedToleranceExpression: '0.25*e',
    formKind: 'zero_creep',
    reportSheetRef: 'Sheet 4.5',
    category: 'Stability',
    implemented: true,
    sortOrder: 210,
  },
  {
    code: 'TARE',
    displayName: 'Tare device accuracy',
    description:
      'Weighing performance with tare applied. Same table as the intrinsic error test; ' +
      'the tare load is part of the recorded conditions, not a separate column.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 4.6',
    category: 'Weighing performance',
    implemented: true,
    sortOrder: 220,
  },
  {
    code: 'TILT',
    displayName: 'Tilting',
    description: 'Weighing performance with the instrument tilted within its permitted range.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: null,
    reportSheetRef: 'Sheet 4.7',
    category: 'Future work',
    implemented: false,
    sortOrder: 230,
  },
  {
    code: 'WARMUP',
    displayName: 'Warm-up time',
    description: 'Indication drift during the warm-up period after power-on.',
    applicableStandards: OIML_R76,
    ruleType: 'FIXED_VALUE',
    fixedToleranceExpression: '0.5*e',
    formKind: null,
    reportSheetRef: 'Sheet 5.5',
    category: 'Future work',
    implemented: false,
    sortOrder: 240,
  },
  {
    code: 'VOLT',
    displayName: 'Voltage variation',
    description:
      'Weighing performance across the permitted AC and DC supply range. Same table as ' +
      'the intrinsic error test; the supply in use is recorded in the conditions and remarks. ' +
      'Dedicated supply-voltage columns are future work.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 5.6',
    category: 'Influence factors',
    implemented: true,
    sortOrder: 250,
  },
  {
    code: 'DAMP1',
    displayName: 'Damp heat, steady state',
    description:
      'Weighing performance after conditioning at high humidity. Same table as the ' +
      'intrinsic error test with chamber conditions in the header.',
    applicableStandards: OIML_R76,
    ruleType: 'MPE_TABLE',
    fixedToleranceExpression: null,
    formKind: 'weighing_performance',
    reportSheetRef: 'Sheet 5.7',
    category: 'Influence factors',
    implemented: true,
    sortOrder: 260,
  },
  {
    code: 'DISCRIM',
    displayName: 'Discrimination',
    description: 'Response to a small added load equal to 1.4 d.',
    applicableStandards: OIML_R76,
    ruleType: 'FIXED_VALUE',
    fixedToleranceExpression: '1.4*e',
    formKind: null,
    reportSheetRef: 'Sheet 4.8',
    category: 'Future work',
    implemented: false,
    sortOrder: 270,
  },
];

export const IMPLEMENTED_TEST_TYPES = TEST_TYPES.filter((t) => t.implemented);

export function findTestType(code: string): TestTypeDefinition | undefined {
  return TEST_TYPES.find((t) => t.code.toUpperCase() === code.toUpperCase());
}

/** Test types that apply under a given standard version string. */
export function testTypesForStandard(standard: string): TestTypeDefinition[] {
  return TEST_TYPES.filter((t) => t.applicableStandards.includes(standard)).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

/**
 * Checklist master data — a representative sample of the OIML R76 conformity clauses,
 * covering the categories the real report groups them under. The full standard runs to
 * roughly 150 rows; these 15 prove the module without transcribing the whole annex.
 */
export interface ChecklistItemDefinition {
  clauseNo: string;
  description: string;
  category: string;
  applicableStandards: string[];
  sortOrder: number;
}

export const CHECKLIST_ITEMS: ChecklistItemDefinition[] = [
  {
    clauseNo: '7.1.1',
    description: 'Manufacturer name, trademark or identification mark is present and legible.',
    category: 'Descriptive markings',
    applicableStandards: OIML_R76,
    sortOrder: 10,
  },
  {
    clauseNo: '7.1.2',
    description: 'Model or type designation is marked on the instrument.',
    category: 'Descriptive markings',
    applicableStandards: OIML_R76,
    sortOrder: 20,
  },
  {
    clauseNo: '7.1.3',
    description: 'Accuracy class mark is displayed in the prescribed form.',
    category: 'Descriptive markings',
    applicableStandards: OIML_R76,
    sortOrder: 30,
  },
  {
    clauseNo: '7.1.4',
    description: 'Max, Min, e and d values are marked and consistent with the tested values.',
    category: 'Descriptive markings',
    applicableStandards: OIML_R76,
    sortOrder: 40,
  },
  {
    clauseNo: '7.1.5',
    description: 'Serial number of the instrument is marked and matches the test record.',
    category: 'Descriptive markings',
    applicableStandards: OIML_R76,
    sortOrder: 50,
  },
  {
    clauseNo: '7.2.1',
    description: 'Space is provided for the verification mark and it is accessible without disassembly.',
    category: 'Verification marks',
    applicableStandards: OIML_R76,
    sortOrder: 60,
  },
  {
    clauseNo: '7.2.2',
    description: 'Sealing provisions prevent access to adjustment without breaking a seal.',
    category: 'Verification marks',
    applicableStandards: OIML_R76,
    sortOrder: 70,
  },
  {
    clauseNo: '4.2.1',
    description: 'Indication is unambiguous, legible and free of parallax under normal use.',
    category: 'Indicating device',
    applicableStandards: OIML_R76,
    sortOrder: 80,
  },
  {
    clauseNo: '4.2.2',
    description: 'Scale interval d and verification interval e satisfy the permitted relationship.',
    category: 'Indicating device',
    applicableStandards: OIML_R76,
    sortOrder: 90,
  },
  {
    clauseNo: '4.2.3',
    description: 'Units of measurement are displayed alongside the indication.',
    category: 'Indicating device',
    applicableStandards: OIML_R76,
    sortOrder: 100,
  },
  {
    clauseNo: '4.5.1',
    description: 'Zero-setting range does not exceed 4 % of Max.',
    category: 'Zero-setting',
    applicableStandards: OIML_R76,
    sortOrder: 110,
  },
  {
    clauseNo: '4.5.2',
    description: 'Initial zero-setting range does not exceed 20 % of Max.',
    category: 'Zero-setting',
    applicableStandards: OIML_R76,
    sortOrder: 120,
  },
  {
    clauseNo: '4.5.3',
    description: 'Zero-tracking operates only within 4 % of Max and at a rate not exceeding 0.5 e/s.',
    category: 'Zero-setting',
    applicableStandards: OIML_R76,
    sortOrder: 130,
  },
  {
    clauseNo: '4.6.1',
    description: 'Tare device operates over its marked range without exceeding Max.',
    category: 'Tare devices',
    applicableStandards: OIML_R76,
    sortOrder: 140,
  },
  {
    clauseNo: '4.6.2',
    description: 'Tare in operation is clearly indicated to the operator.',
    category: 'Tare devices',
    applicableStandards: OIML_R76,
    sortOrder: 150,
  },
];
