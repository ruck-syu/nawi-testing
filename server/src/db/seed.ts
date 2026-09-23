/**
 * Seed script — `npm run seed`.
 *
 * Creates the master data (test types, checklist clauses) plus one complete, realistic
 * demo project using the NHB150 figures from section 6 of the build spec. The point is
 * that the app is fully populated before recording, so nothing has to be typed on camera.
 *
 * Idempotent: re-running drops and rebuilds the demo project but leaves the database file
 * and users in place.
 */

import { applySchema, all, closeDb, dropAllObjects, get, run, transaction } from './index.ts';
import { hashPassword } from '../auth.ts';
import {
  CHECKLIST_ITEMS,
  TEST_TYPES,
  computeN,
  eccentricityPositions,
} from '../domain.ts';
import { refreshTestRunVerdict } from '../services/evaluation.ts';

const STANDARD = 'OIML R76-1:2006';

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

async function seedUsers() {
  const users = [
    {
      name: 'A. Nielsen',
      email: 'admin@delta.test',
      password: 'admin123',
      role: 'admin' as const,
    },
    {
      name: 'M. Sørensen',
      email: 'tech@delta.test',
      password: 'tech123',
      role: 'technician' as const,
    },
  ];

  for (const user of users) {
    const existing = await get<{ id: number }>('SELECT id FROM "user" WHERE email = ?', [user.email]);
    if (existing) continue;
    await run('INSERT INTO "user" (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      user.name,
      user.email,
      hashPassword(user.password),
      user.role,
    ]);
  }
  console.log(`  users:           admin@delta.test / admin123, tech@delta.test / tech123`);
}

async function seedTestTypes() {
  for (const testType of TEST_TYPES) {
    await run(
      `INSERT INTO test_type
         (code, display_name, description, applicable_standards, rule_type,
          fixed_tolerance_expression, form_kind, report_sheet_ref, category,
          implemented, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          applicable_standards = excluded.applicable_standards,
          rule_type = excluded.rule_type,
          fixed_tolerance_expression = excluded.fixed_tolerance_expression,
          form_kind = excluded.form_kind,
          report_sheet_ref = excluded.report_sheet_ref,
          category = excluded.category,
          implemented = excluded.implemented,
          sort_order = excluded.sort_order`,
      [
        testType.code,
        testType.displayName,
        testType.description,
        JSON.stringify(testType.applicableStandards),
        testType.ruleType,
        testType.fixedToleranceExpression,
        testType.formKind,
        testType.reportSheetRef,
        testType.category,
        // Boolean, not 1/0: the column is BOOLEAN on PostgreSQL, which rejects
        // integer literals for boolean fields (a leftover from the SQLite era).
        testType.implemented,
        testType.sortOrder,
      ],
    );
  }
  // Two different counts, and the label matters. `formKind` is what makes a sheet openable for
  // data entry; `implemented` marks only the subset that arrives with the NHB150 demo readings
  // already in it. Reporting the second as "with data entry" understates the build by half and
  // invites the reader to think seven of the nineteen sheets work.
  const enterable = TEST_TYPES.filter((t) => t.formKind).length;
  const seeded = TEST_TYPES.filter((t) => t.implemented).length;
  console.log(
    `  test types:      ${TEST_TYPES.length} seeded, ${enterable} accept data entry ` +
      `(${seeded} pre-filled with demo readings)`,
  );
}

async function seedChecklistItems() {
  for (const item of CHECKLIST_ITEMS) {
    await run(
      `INSERT INTO checklist_item (clause_no, description, category, applicable_standards, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(clause_no, description) DO UPDATE SET
          category = excluded.category,
          applicable_standards = excluded.applicable_standards,
          sort_order = excluded.sort_order`,
      [
        item.clauseNo,
        item.description,
        item.category,
        JSON.stringify(item.applicableStandards),
        item.sortOrder,
      ],
    );
  }
  console.log(`  checklist:       ${CHECKLIST_ITEMS.length} clauses seeded`);
}

// ---------------------------------------------------------------------------
// Demo project
// ---------------------------------------------------------------------------

/** Reference weight set exactly as printed on the DELTA NHB150 sheet. */
const REFERENCE_WEIGHTS = [0.4, 2.4, 5, 10, 30, 50, 70, 90, 110, 130, 150];

/**
 * Loading-up / loading-down indications per test, keyed by load.
 *
 * INTRINSIC uses the literal figures given in the build spec. The temperature and
 * disturbance runs use figures consistent with a well-behaved Class II instrument, so the
 * seeded project opens fully green and the demo can flip a value to show a failure.
 */
const INTRINSIC_ROWS: Array<[number, number, number]> = [
  [0.4, 0.396, 0.4],
  [2.4, 2.396, 2.4],
  [5, 4.996, 5],
  [10, 9.996, 10],
  [30, 29.998, 29.996],
  [50, 49.996, 49.996],
  [70, 69.996, 69.996],
  [90, 90, 89.998],
  [110, 109.998, 109.998],
  [130, 129.998, 130],
  [150, 149.998, 149.998],
];

const T1_ROWS: Array<[number, number, number]> = [
  [0.4, 0.396, 0.398],
  [2.4, 2.398, 2.4],
  [5, 4.998, 5],
  [10, 9.996, 9.998],
  [30, 29.996, 29.998],
  [50, 49.998, 50],
  [70, 69.996, 70],
  [90, 89.998, 90],
  [110, 109.996, 110],
  [130, 129.998, 130],
  [150, 149.996, 150],
];

const T2_ROWS: Array<[number, number, number]> = [
  [0.4, 0.394, 0.396],
  [2.4, 2.394, 2.396],
  [5, 4.994, 4.996],
  [10, 9.994, 9.994],
  [30, 29.992, 29.994],
  [50, 49.99, 49.992],
  [70, 69.988, 69.99],
  [90, 89.986, 89.988],
  [110, 109.984, 109.986],
  [130, 129.982, 129.984],
  [150, 149.98, 149.982],
];

async function insertWeighingRun(
  modelId: number,
  code: string,
  rows: Array<[number, number, number]>,
  conditions: {
    temperature_c: number;
    room_temp_c?: number | null;
    chamber_temp_c?: number | null;
    humidity_pct?: number | null;
    date_performed: string;
    time_performed: string;
    operator_name: string;
    remarks?: string | null;
  },
): Promise<number> {
  const { lastInsertRowid: runId } = await run(
    `INSERT INTO test_run
       (model_id, test_type_code, status, temperature_c, room_temp_c, chamber_temp_c,
        humidity_pct, date_performed, time_performed, operator_name, remarks)
     VALUES (?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      modelId,
      code,
      conditions.temperature_c,
      conditions.room_temp_c ?? null,
      conditions.chamber_temp_c ?? null,
      conditions.humidity_pct ?? null,
      conditions.date_performed,
      conditions.time_performed,
      conditions.operator_name,
      conditions.remarks ?? null,
    ],
  );

  for (const [index, [load, up, down]] of rows.entries()) {
    await run(
      `INSERT INTO observation (test_run_id, sequence_no, load_value, indication_up, indication_down)
       VALUES (?, ?, ?, ?, ?)`,
      [runId, index + 1, load, up, down],
    );
  }

  return runId;
}

async function seedDemoProject() {
  // Rebuild from scratch so re-seeding is predictable. Cascades clear the whole tree.
  const existing = await get<{ id: number }>('SELECT id FROM project WHERE task_no = ?', ['A530947']);
  if (existing) {
    await run('DELETE FROM project WHERE id = ?', [existing.id]);
  }
  // Reuse the manufacturer row when it exists: deleting and recreating it on
  // every reseed shifts its surrogate id and breaks any caller holding the old
  // one. The demo project itself is still rebuilt from scratch below.
  const existingMfr = await get<{ id: number }>('SELECT id FROM manufacturer WHERE name = ?', [
    'Taiwan Scale Mfg. Co., Ltd.',
  ]);
  const admin = await get<{ id: number }>('SELECT id FROM "user" WHERE email = ?', ['admin@delta.test']);

  const manufacturerId = existingMfr
    ? existingMfr.id
    : (
        await run(
          `INSERT INTO manufacturer (name, address, contact_person, email, phone)
           VALUES (?, ?, ?, ?, ?)`,
          [
            'Taiwan Scale Mfg. Co., Ltd.',
            '99 Shuchang Road, Zhoushi Town, Kunshan City, 215300 Jiangsu Province, China',
            'Tom Hong',
            'service@taiwanscale.com',
            '+86 512 5768 0000',
          ],
        )
      ).lastInsertRowid;

  const { lastInsertRowid: projectId } = await run(
    `INSERT INTO project
       (manufacturer_id, task_no, report_no, danak_no, standard_version,
        examination_start_date, examination_end_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      manufacturerId,
      'A530947',
      'DANAK-1911302',
      '1911302',
      STANDARD,
      '2011-01-03',
      '2011-02-24',
      'draft',
      admin?.id ?? null,
    ],
  );

  const { lastInsertRowid: familyId } = await run(
    'INSERT INTO instrument_family (project_id, family_name) VALUES (?, ?)',
    [projectId, 'NHB'],
  );

  const max = 150;
  const e = 0.02;
  const { lastInsertRowid: modelId } = await run(
    `INSERT INTO instrument_model
       (family_id, model_name, max_capacity, min_capacity, e_value, d_value, n_intervals,
        accuracy_class, fractional_factor_pi,
        load_cell_type, load_cell_manufacturer, load_cell_capacity,
        load_cell_rated_output_mvv, load_cell_min_impedance_ohm,
        zero_setting_types, tare_types, max_tare_pct,
        operating_temp_min, operating_temp_max,
        power_ac_nominal_v, power_ac_min_v, power_ac_max_v,
        power_dc_nominal_v, power_dc_min_v, power_dc_max_v,
        mpd_span_stability, pan_shape, serial_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      familyId,
      'NHB150',
      max,
      0.4,
      e,
      0.002,
      computeN(max, e),
      'II',
      1,
      'SPL',
      'HBM',
      '0.2 kg',
      0.9,
      420,
      JSON.stringify({
        nonauto: false,
        semiauto: true,
        autozero: false,
        initial: true,
        tracking: true,
        range_pct: 2,
        initial_range_pct: 20,
      }),
      JSON.stringify({
        balancing: true,
        weighing: false,
        preset: false,
        subtractive: true,
        additive: false,
      }),
      100,
      5,
      40,
      230,
      207,
      253,
      12,
      9,
      12,
      0.25,
      'rectangular_4corner',
      'NHB150-2011-0042',
    ],
  );

  for (const [index, value] of REFERENCE_WEIGHTS.entries()) {
    await run(
      'INSERT INTO reference_weight (model_id, nominal_load_value, sequence_order) VALUES (?, ?, ?)',
      [modelId, value, index + 1],
    );
  }

  const runIds: number[] = [];

  runIds.push(
    await insertWeighingRun(modelId, 'INTRINSIC', INTRINSIC_ROWS, {
      temperature_c: 20.3,
      room_temp_c: 20.3,
      humidity_pct: 45,
      date_performed: '2011-01-05',
      time_performed: '09:40',
      operator_name: 'M. Sørensen',
      remarks: 'Reference conditions. Instrument warmed up 30 min before start.',
    }),
  );

  runIds.push(
    await insertWeighingRun(modelId, 'T1', T1_ROWS, {
      temperature_c: 20.1,
      room_temp_c: 20.1,
      chamber_temp_c: 20.0,
      humidity_pct: 47,
      date_performed: '2011-01-17',
      time_performed: '08:15',
      operator_name: 'M. Sørensen',
      remarks: 'Reference temperature leg of the temperature sequence.',
    }),
  );

  runIds.push(
    await insertWeighingRun(modelId, 'T2', T2_ROWS, {
      temperature_c: 40.2,
      room_temp_c: 21.0,
      chamber_temp_c: 40.2,
      humidity_pct: 50,
      date_performed: '2011-01-19',
      time_performed: '11:05',
      operator_name: 'M. Sørensen',
      remarks: 'Upper temperature limit. Stabilised 4 h in chamber before measurement.',
    }),
  );

  // Repeatability: ten applications of 90 g, with the zero reading captured on the run.
  {
    const { lastInsertRowid: runId } = await run(
      `INSERT INTO test_run
         (model_id, test_type_code, status, temperature_c, humidity_pct, date_performed,
          time_performed, operator_name, test_load, indication_zero, remarks)
       VALUES (?, 'REP', 'complete', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        modelId,
        20.4,
        45,
        '2011-01-06',
        '10:20',
        'M. Sørensen',
        90,
        0,
        'Ten successive applications of the same 90 g load, zero checked between each.',
      ],
    );
    const trials = [90.002, 90.0, 90.004, 90.002, 90.0, 90.002, 90.004, 90.0, 90.002, 90.002];
    for (const [index, indication] of trials.entries()) {
      await run(
        `INSERT INTO observation (test_run_id, sequence_no, load_value, indication_up)
         VALUES (?, ?, ?, ?)`,
        [runId, index + 1, 90, indication],
      );
    }
    runIds.push(runId);
  }

  // Eccentricity: 50 g at centre plus each corner of the rectangular pan.
  {
    const { lastInsertRowid: runId } = await run(
      `INSERT INTO test_run
         (model_id, test_type_code, status, temperature_c, humidity_pct, date_performed,
          time_performed, operator_name, test_load, remarks)
       VALUES (?, 'ECC', 'complete', ?, ?, ?, ?, ?, ?, ?)`,
      [
        modelId,
        20.2,
        46,
        '2011-01-06',
        '13:50',
        'M. Sørensen',
        50,
        'Load applied over each quadrant of the load receptor, centred on the corner marks.',
      ],
    );
    const indications = [50.002, 50.0, 50.004, 50.002, 50.0];
    for (const [index, position] of eccentricityPositions('rectangular_4corner').entries()) {
      await run(
        `INSERT INTO observation
           (test_run_id, sequence_no, load_value, indication_up, position_code, position_label,
            load_zero, indication_zero)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        [runId, index + 1, 50, indications[index], position.code, position.label],
      );
    }
    runIds.push(runId);
  }

  // ESD: contact discharges at 2/4/6 kV and air discharge at 8 kV, both polarities.
  {
    const { lastInsertRowid: runId } = await run(
      `INSERT INTO test_run
         (model_id, test_type_code, status, temperature_c, humidity_pct, date_performed,
          time_performed, operator_name, test_load, remarks)
       VALUES (?, 'EMC_ESD', 'complete', ?, ?, ?, ?, ?, ?, ?)`,
      [
        modelId,
        21.0,
        44,
        '2011-02-08',
        '14:30',
        'M. Sørensen',
        100,
        'Ten discharges per point. No significant fault observed; indication recovered without operator intervention.',
      ],
    );
    const points: Array<[number, string, string, number, number]> = [
      [2, 'contact', 'positive', 100.002, 100.002],
      [2, 'contact', 'negative', 100.002, 100.002],
      [4, 'contact', 'positive', 100.002, 100.004],
      [4, 'contact', 'negative', 100.002, 100.0],
      [6, 'contact', 'positive', 100.002, 100.004],
      [6, 'contact', 'negative', 100.002, 100.0],
      [8, 'air', 'positive', 100.002, 100.004],
      [8, 'air', 'negative', 100.002, 100.002],
    ];
    for (const [index, [kv, mode, polarity, before, after]] of points.entries()) {
      await run(
        `INSERT INTO observation
           (test_run_id, sequence_no, load_value, test_voltage_kv, application_mode, polarity,
            indication_before, indication_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [runId, index + 1, 100, kv, mode, polarity, before, after],
      );
    }
    runIds.push(runId);
  }

  // Span stability: 3 of the 8 real measurements, spread across the campaign.
  {
    const { lastInsertRowid: runId } = await run(
      `INSERT INTO test_run
         (model_id, test_type_code, status, temperature_c, date_performed, operator_name,
          test_load, remarks)
       VALUES (?, 'SPAN', 'complete', ?, ?, ?, ?, ?)`,
      [
        modelId,
        20.5,
        '2011-02-10',
        'M. Sørensen',
        150,
        'Measurements 1, 4 and 7 of the 8-point span stability sequence.',
      ],
    );
    const measurements: Array<[string, string, number, number]> = [
      ['Reference (start of campaign)', '2011-01-05', 149.998, 0],
      ['After temperature test sequence', '2011-01-20', 150.002, 0],
      ['After damp heat conditioning', '2011-02-10', 150.004, 0],
    ];
    for (const [index, [condition, measuredAt, indication, zero]] of measurements.entries()) {
      await run(
        `INSERT INTO observation
           (test_run_id, sequence_no, load_value, indication_up, indication_zero, condition, measured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [runId, index + 1, 150, indication, zero, condition, measuredAt],
      );
    }
    runIds.push(runId);
  }

  // Checklist answers. Mostly conforming, with a couple of not-applicable rows so the
  // screen shows realistic variety rather than a wall of identical passes.
  const items = await all<{ id: number; clause_no: string }>(
    'SELECT id, clause_no FROM checklist_item ORDER BY sort_order',
  );

  const intrinsicRunId = runIds[0]!;
  const notApplicable = new Set(['4.6.1', '4.6.2']);
  const evidenceLinked = new Set(['4.2.2']);

  for (const item of items) {
    const isNa = notApplicable.has(item.clause_no);
    await run(
      `INSERT INTO project_checklist_result
         (project_id, checklist_item_id, applicable, status, remarks, linked_test_run_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        item.id,
        isNa ? 'na' : 'existent',
        isNa ? 'na' : 'pass',
        isNa
          ? 'Tare device not fitted on this variant.'
          : evidenceLinked.has(item.clause_no)
            ? 'Verified against the intrinsic error measurement.'
            : null,
        evidenceLinked.has(item.clause_no) ? intrinsicRunId : null,
      ],
    );
  }

  await run(
    `INSERT INTO signature (project_id, signed_by_name, signed_by_title, signed_at)
     VALUES (?, ?, ?, ?)`,
    [projectId, 'A. Nielsen', 'Laboratory Manager, Mass & Balance', '2011-02-24 15:00:00'],
  );

  // Compute and cache every verdict, so the dashboard is populated on first load.
  for (const runId of runIds) {
    await refreshTestRunVerdict(runId);
  }

  console.log(`  demo project:    Task A530947 / DANAK-1911302 (project #${projectId})`);
  console.log(`  instrument:      NHB150 — Max ${max} g, e ${e} g, n ${computeN(max, e)}, Class II`);
  console.log(`  test runs:       ${runIds.length} seeded and evaluated`);
}

// ---------------------------------------------------------------------------

async function main() {
  // Teardown-only mode for scripts/verify.sh: drop every application table and stop.
  // Guarded so a bare `npm run seed -- --clean` in a terminal cannot wipe the live
  // database: it only runs when explicitly aimed at a scratch DB, i.e. DATABASE_URL was
  // overridden from VERIFY_DATABASE_URL (which is exactly what verify.sh exports).
  if (process.argv.includes('--clean')) {
    if (
      !process.env.VERIFY_DATABASE_URL ||
      process.env.DATABASE_URL !== process.env.VERIFY_DATABASE_URL
    ) {
      console.error(
        'Refusing: --clean drops all tables and is only allowed against a scratch database ' +
          '(set VERIFY_DATABASE_URL; see scripts/verify.sh).',
      );
      await closeDb();
      process.exit(1);
    }
    await dropAllObjects();
    console.log('Dropped all application tables.');
    await closeDb();
    return;
  }
  const reset = process.argv.includes('--reset');
  if (reset) {
    await dropAllObjects();
    console.log('Dropped existing PostgreSQL application tables.');
  } else {
    await applySchema();
  }
  console.log('Seeding OIML R76 report database into Supabase PostgreSQL...');

  await transaction(async () => {
    await seedUsers();
    await seedTestTypes();
    await seedChecklistItems();
    await seedDemoProject();
  });

  console.log('\nDone. Supabase PostgreSQL seed completed.');
  await closeDb();
}

main().catch(async (error) => {
  console.error('\nSeed failed:', error);
  await closeDb();
  process.exitCode = 1;
});
