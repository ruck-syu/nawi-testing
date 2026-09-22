/**
 * Test run and observation routes.
 *
 * Two things worth noting:
 *
 *  - Saving observations replaces the run's whole row set inside a transaction. A test
 *    table is edited as a unit in the UI, and diffing individual rows would let a failed
 *    save leave a half-written table behind.
 *
 *  - Nothing derived is accepted from the client. Requests carry loads and indications;
 *    error, corrected error, n_i, MPE and pass/fail are computed on read. A client that
 *    posted its own `error` field would be silently ignored, which is the intent.
 */

import { all, get, getCachedTestTypes, parseJson, run, transaction } from '../db/index.ts';
import {
  badRequest,
  dateOrNull,
  notFound,
  num,
  numOrNull,
  oneOf,
  strOrNull,
  timeOrNull,
  type Router,
} from '../http.ts';
import { eccentricityPositions, findTestType, validateTestConditions, validateObservationInput, type PanShape } from '../domain.ts';
import {
  evaluateTestRun,
  getModel,
  getTestRun,
  refreshTestRunVerdict,
  toInstrumentSpec,
} from '../services/evaluation.ts';
import { pohAnchorChain, pohStatus, pohVerify } from '../services/poh.ts';

const RUN_STATUSES = ['not_started', 'in_progress', 'complete'] as const;

/** Internal signal: our create lost a race; the caller retries and returns the winner. */
class RaceLostError extends Error {}

async function projectIdForModel(modelId: number) {
  const row = await get<{ project_id: number }>(
    `SELECT f.project_id FROM instrument_model m
       JOIN instrument_family f ON f.id = m.family_id
      WHERE m.id = ?`,
    [modelId],
  );
  if (!row) throw notFound(`Instrument model ${modelId} not found`);
  return row.project_id;
}

/**
 * Read the environment/parameter fields that live on the run rather than per row.
 *
 * Only keys actually present in the body are returned, so a request may update a subset.
 * This is deliberate and it matters: the UI autosaves the measurement table on every edit,
 * and if an omitted key were read as null then saving a reading would silently erase the
 * temperature, the date and the operator's name recorded alongside it. The alternative —
 * requiring every request to echo all ten fields — puts the burden of not losing data on
 * every caller, which is exactly the kind of rule that gets forgotten once.
 */
function readRunFields(body: Record<string, unknown>) {
  const numeric = [
    'temperature_c',
    'chamber_temp_c',
    'room_temp_c',
    'humidity_pct',
    'barometric_hpa',
    'test_load',
    'indication_zero',
  ] as const;
  const textual = ['operator_name', 'remarks'] as const;

  const fields: Record<string, number | string | null> = {};
  for (const key of numeric) {
    if (key in body) fields[key] = numOrNull(body[key], key);
  }
  for (const key of textual) {
    if (key in body) fields[key] = strOrNull(body[key]);
  }
  if ('date_performed' in body) {
    fields['date_performed'] = dateOrNull(body['date_performed'], 'date_performed');
  }
  if ('time_performed' in body) {
    fields['time_performed'] = timeOrNull(body['time_performed'], 'time_performed');
  }
  return fields;
}

/**
 * Map one posted row onto observation columns.
 *
 * Only the columns the form kind actually uses are read, so a stray field from a
 * different test's shape cannot end up stored against this run.
 */
function readObservation(
  formKind: string | null,
  raw: unknown,
  index: number,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    throw badRequest(`rows[${index}] must be an object`);
  }
  const row = raw as Record<string, unknown>;
  const base = {
    sequence_no: numOrNull(row.sequenceNo ?? row.sequence_no, `rows[${index}].sequenceNo`) ?? index + 1,
    load_value: num(row.loadValue ?? row.load_value, `rows[${index}].loadValue`),
    indication_up: null as number | null,
    indication_down: null as number | null,
    delta_l_up: null as number | null,
    delta_l_down: null as number | null,
    position_code: null as string | null,
    position_label: null as string | null,
    load_zero: null as number | null,
    indication_zero: null as number | null,
    test_voltage_kv: null as number | null,
    application_mode: null as string | null,
    polarity: null as string | null,
    indication_before: null as number | null,
    indication_after: null as number | null,
    frequency_mhz: null as number | null,
    field_strength_v_m: null as number | null,
    condition: null as string | null,
    measured_at: null as string | null,
  };

  switch (formKind) {
    case 'weighing_performance':
      base.indication_up = numOrNull(row.indicationUp ?? row.indication_up, `rows[${index}].indicationUp`);
      base.indication_down = numOrNull(row.indicationDown ?? row.indication_down, `rows[${index}].indicationDown`);
      base.delta_l_up = numOrNull(row.deltaLUp ?? row.delta_l_up, `rows[${index}].deltaLUp`);
      base.delta_l_down = numOrNull(row.deltaLDown ?? row.delta_l_down, `rows[${index}].deltaLDown`);
      break;

    case 'repeatability':
      base.indication_up = numOrNull(row.indication ?? row.indicationUp ?? row.indication_up, `rows[${index}].indication`);
      break;

    case 'eccentricity':
      base.indication_up = numOrNull(row.indication ?? row.indicationUp ?? row.indication_up, `rows[${index}].indication`);
      base.position_code = strOrNull(row.positionCode ?? row.position_code);
      base.position_label = strOrNull(row.positionLabel ?? row.position_label);
      base.load_zero = numOrNull(row.loadZero ?? row.load_zero, `rows[${index}].loadZero`) ?? 0;
      base.indication_zero = numOrNull(row.indicationZero ?? row.indication_zero, `rows[${index}].indicationZero`);
      break;

    case 'esd':
      base.test_voltage_kv = numOrNull(row.testVoltageKv ?? row.test_voltage_kv, `rows[${index}].testVoltageKv`);
      base.application_mode = strOrNull(row.applicationMode ?? row.application_mode);
      if (base.application_mode) {
        oneOf(base.application_mode, ['contact', 'air'] as const, `rows[${index}].applicationMode`);
      }
      base.polarity = strOrNull(row.polarity);
      if (base.polarity) {
        oneOf(base.polarity, ['positive', 'negative'] as const, `rows[${index}].polarity`);
      }
      base.indication_before = numOrNull(row.indicationBefore ?? row.indication_before, `rows[${index}].indicationBefore`);
      base.indication_after = numOrNull(row.indicationAfter ?? row.indication_after, `rows[${index}].indicationAfter`);
      break;

    case 'radiated': {
      base.frequency_mhz = numOrNull(row.frequencyMhz ?? row.frequency_mhz, `rows[${index}].frequencyMhz`);
      base.field_strength_v_m = numOrNull(row.fieldStrengthVM ?? row.field_strength_v_m, `rows[${index}].fieldStrengthVM`);
      base.indication_before = numOrNull(row.indicationBefore ?? row.indication_before, `rows[${index}].indicationBefore`);
      base.indication_after = numOrNull(row.indicationAfter ?? row.indication_after, `rows[${index}].indicationAfter`);
      break;
    }

    case 'span_stability':
      base.indication_up = numOrNull(row.indication ?? row.indicationUp ?? row.indication_up, `rows[${index}].indication`);
      base.indication_zero = numOrNull(row.indicationZero ?? row.indication_zero, `rows[${index}].indicationZero`);
      base.condition = strOrNull(row.condition);
      base.measured_at = dateOrNull(row.measuredAt ?? row.measured_at, `rows[${index}].measuredAt`);
      break;

    case 'equilibrium':
      base.indication_up = numOrNull(row.indication ?? row.indicationUp ?? row.indication_up, `rows[${index}].indication`);
      break;

    case 'zero_creep':
      base.indication_up = numOrNull(row.indication ?? row.indicationUp ?? row.indication_up, `rows[${index}].indication`);
      base.condition = strOrNull(row.condition);
      base.measured_at = dateOrNull(row.measuredAt ?? row.measured_at, `rows[${index}].measuredAt`);
      break;

    default:
      throw badRequest(
        `Test type has no data-entry form (form_kind is null), so observations cannot be saved`,
      );
  }

  return base;
}

/**
 * Build the empty row set a freshly created run starts with.
 *
 * Pre-filling the loads is the point of the reference weight table: the technician types
 * indications only, and the load column matches the weights they physically have.
 */
async function starterRows(
  modelId: number,
  formKind: string | null,
  testLoad: number | null,
  testTypeCode: string | null,
) {
  const model = await getModel(modelId);
  const weightRows = await all<{ nominal_load_value: number }>(
    'SELECT nominal_load_value FROM reference_weight WHERE model_id = ? ORDER BY sequence_order',
    [modelId],
  );
  const weights = weightRows.map((w) => w.nominal_load_value);

  switch (formKind) {
    case 'weighing_performance':
      return weights.map((load, i) => ({ sequence_no: i + 1, load_value: load }));

    case 'repeatability': {
      const load = testLoad ?? weights[Math.floor(weights.length / 2)] ?? model.max_capacity;
      // R76 asks for at least 6 applications; 10 is the usual laboratory practice and
      // what the DELTA sheet records.
      return Array.from({ length: 10 }, (_, i) => ({ sequence_no: i + 1, load_value: load }));
    }

    case 'eccentricity': {
      const load = testLoad ?? Math.round((model.max_capacity / 3) / model.e_value) * model.e_value;
      return eccentricityPositions(model.pan_shape as PanShape).map((position, i) => ({
        sequence_no: i + 1,
        load_value: load,
        position_code: position.code,
        position_label: position.label,
        load_zero: 0,
      }));
    }

    case 'esd': {
      const load = testLoad ?? weights[weights.length - 1] ?? model.max_capacity;
      // Disturbance levels come from the test-type catalogue, so burst steps differ from
      // ESD steps without a code branch per test. Unknown codes fall back to the ESD
      // levels rather than an empty table.
      const levels = findTestType(testTypeCode ?? '')?.disturbance?.levels ?? [
        [2, 'contact'],
        [4, 'contact'],
        [6, 'contact'],
        [8, 'air'],
      ];
      return levels.flatMap(([kv, mode], groupIndex) =>
        (['positive', 'negative'] as const).map((polarity, i) => ({
          sequence_no: groupIndex * 2 + i + 1,
          load_value: load,
          test_voltage_kv: kv,
          application_mode: mode,
          polarity,
        })),
      );
    }

    case 'radiated': {
      const load = testLoad ?? weights[weights.length - 1] ?? model.max_capacity;
      // OIML sweep points across 80–2000 MHz at the 10 V/m immunity level.
      return [80, 100, 150, 200, 300, 500, 800, 1200, 2000].map((mhz, i) => ({
        sequence_no: i + 1,
        load_value: load,
        frequency_mhz: mhz,
        field_strength_v_m: 10,
      }));
    }

    case 'span_stability': {
      const load = testLoad ?? model.max_capacity;
      return ['Reference (start of campaign)', 'Mid-campaign', 'End of campaign'].map(
        (condition, i) => ({
          sequence_no: i + 1,
          load_value: load,
          condition,
        }),
      );
    }

    case 'equilibrium': {
      // R76 takes five readings at one load; the verdict belongs to their spread.
      const load = testLoad ?? model.max_capacity;
      return Array.from({ length: 5 }, (_, i) => ({ sequence_no: i + 1, load_value: load }));
    }

    case 'zero_creep': {
      const load = testLoad ?? model.max_capacity;
      return [
        { sequence_no: 1, load_value: 0, condition: 'Zero return (unloaded)' },
        { sequence_no: 2, load_value: load, condition: 'Creep hold, 0 min' },
        { sequence_no: 3, load_value: load, condition: 'Creep hold, 10 min' },
        { sequence_no: 4, load_value: load, condition: 'Creep hold, 20 min' },
        { sequence_no: 5, load_value: load, condition: 'Creep hold, 30 min' },
      ];
    }

    default:
      return [];
  }
}

/**
 * Insert a run's rows in a single statement.
 *
 * Previously one INSERT per row, so every autosave paid a round trip per
 * measurement (~6 s for an 11-load sheet against remote Postgres). One
 * multi-row VALUES keeps the same all-or-nothing semantics inside the
 * caller's transaction at the cost of one round trip.
 */
async function insertRows(runId: number, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0] as Record<string, unknown>);
  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (const row of rows) {
    values.push(runId, ...columns.map((c) => row[c] ?? null));
    placeholders.push(
      `(${Array.from({ length: columns.length + 1 }, () => `?`).join(', ')})`,
    );
  }
  await run(
    `INSERT INTO observation (test_run_id, ${columns.join(', ')})
     VALUES ${placeholders.join(', ')}`,
    values,
  );
  console.error(`[insertRows] run=${runId} rows=${rows.length} cols=${columns.length}`);
}

export function registerTestRoutes(router: Router): void {
  /**
 * Attach simulated proof-of-history anchors to one result page.
 *
 * Anchors cover the returned page (not the whole log) so the chain stays cheap
 * at any table size; paging through keeps each page's own chain verifiable.
 * Only terminal (pass/fail) verdicts anchor — unfinished runs would shift the
 * chain on every edit.
 */
function withPoH<T extends { id: number; projectId: number; testTypeCode: string; verdict: string; updatedAt: string }>(
  items: T[],
) {
  // Only terminal verdicts anchor: incomplete and not-started runs keep changing,
  // and every edit would break their chain position. They anchor on completion.
  const final = items.filter((r) => r.verdict === 'pass' || r.verdict === 'fail');
  const inputs = final.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    testTypeCode: r.testTypeCode,
    verdict: r.verdict,
    updatedAt: r.updatedAt,
  }));
  const anchors = pohAnchorChain(inputs);
  return {
    testRuns: items.map((r) => ({ ...r, poh: anchors.get(r.id) ?? null })),
    poh: { ...pohStatus(), anchored: anchors.size, verified: pohVerify(inputs, anchors) },
  };
}

/** Unified test run history & log across all models and projects. */
  router.get(
    '/api/test-runs',
    async (ctx) => {
      const search = (ctx.query.get('search') ?? '').trim().toLowerCase();
      const verdict = ctx.query.get('verdict');
      const testType = ctx.query.get('testType');
      const modelId = ctx.query.get('modelId');
      const projectId = ctx.query.get('projectId');
      const rawFrom = ctx.query.get('dateFrom') ?? '';
      const rawTo = ctx.query.get('dateTo') ?? '';
      const rawSort = ctx.query.get('dateSort') ?? '';
      // Effective run date: operator-entered date_performed, falling back to the
      // row's updated_at. Compared as YYYY-MM-DD strings so the same SQL works
      // on SQLite and Postgres.
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const dateFrom = DATE_RE.test(rawFrom) ? rawFrom : null;
      const dateTo = DATE_RE.test(rawTo) ? rawTo : null;
      const dateDir = rawSort === 'asc' ? 'ASC' : rawSort === 'desc' ? 'DESC' : null;
      // date_performed is TEXT (YYYY-MM-DD), updated_at is TIMESTAMPTZ: the CAST
      // makes both arms TEXT so COALESCE resolves (Postgres has no common type
      // for text + timestamptz). substr(...,1,10) then yields YYYY-MM-DD either way.
      const EFF_DATE = `substr(coalesce(tr.date_performed, CAST(tr.updated_at AS TEXT)), 1, 10)`;
      // Paginated: the history table grows without bound, so the default page is
      // 50 rows (cap 200). Filters apply in SQL so every page is full.
      const limit = Math.min(Math.max(Number(ctx.query.get('limit') ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(ctx.query.get('offset') ?? 0) || 0, 0);

      const where: string[] = [];
      const params: unknown[] = [];
      if (verdict === 'pass') where.push('tr.overall_pass = 1');
      else if (verdict === 'fail') where.push('tr.overall_pass = 0');
      else if (verdict === 'incomplete') where.push('(tr.overall_pass IS NULL AND tr.status = \'in_progress\')');
      else if (verdict === 'not_started') where.push('(tr.overall_pass IS NULL AND tr.status <> \'in_progress\')');
      if (testType) {
        where.push('tr.test_type_code = ?');
        params.push(testType);
      }
      if (modelId) {
        where.push('tr.model_id = ?');
        params.push(Number(modelId));
      }
      if (projectId) {
        where.push('p.id = ?');
        params.push(Number(projectId));
      }
      if (dateFrom) {
        where.push(`${EFF_DATE} >= ?`);
        params.push(dateFrom);
      }
      if (dateTo) {
        where.push(`${EFF_DATE} <= ?`);
        params.push(dateTo);
      }
      if (search) {
        const like = `%${search}%`;
        where.push(`(lower(p.task_no) LIKE ? OR lower(p.report_no) LIKE ?
          OR lower(mfr.name) LIKE ? OR lower(m.model_name) LIKE ?
          OR lower(tr.test_type_code) LIKE ? OR lower(tt.display_name) LIKE ?
          OR lower(tr.operator_name) LIKE ? OR lower(tt.category) LIKE ?)`);
        params.push(like, like, like, like, like, like, like, like);
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const fromSql = `FROM test_run tr
            JOIN instrument_model m ON m.id = tr.model_id
            JOIN instrument_family f ON f.id = m.family_id
            JOIN project p ON p.id = f.project_id
            JOIN manufacturer mfr ON mfr.id = p.manufacturer_id
            JOIN test_type tt ON tt.code = tr.test_type_code
          ${whereSql}`;

      const total =
        (await get<{ count: string }>(`SELECT count(*) AS count ${fromSql}`, params))?.count ?? '0';

      // Default newest-first; dateSort=asc|desc reorders the effective run date.
      const orderDir = dateDir ?? 'DESC';
      const rows = await all<{
        id: number;
        model_id: number;
        model_name: string;
        family_name: string;
        project_id: number;
        task_no: string;
        report_no: string;
        danak_no: string | null;
        manufacturer_name: string;
        test_type_code: string;
        display_name: string;
        category: string | null;
        report_sheet_ref: string | null;
        status: string;
        overall_pass: number | null;
        temperature_c: number | null;
        chamber_temp_c: number | null;
        room_temp_c: number | null;
        humidity_pct: number | null;
        date_performed: string | null;
        time_performed: string | null;
        operator_name: string | null;
        remarks: string | null;
        test_load: number | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT tr.id, tr.model_id, tr.test_type_code, tr.status, tr.overall_pass,
                tr.temperature_c, tr.chamber_temp_c, tr.room_temp_c, tr.humidity_pct,
                tr.date_performed, tr.time_performed, tr.operator_name, tr.remarks,
                tr.test_load, tr.created_at, tr.updated_at,
                m.model_name, f.family_name, p.id AS project_id, p.task_no, p.report_no, p.danak_no,
                mfr.name AS manufacturer_name,
                tt.display_name, tt.category, tt.report_sheet_ref
           FROM test_run tr
           JOIN instrument_model m ON m.id = tr.model_id
           JOIN instrument_family f ON f.id = m.family_id
           JOIN project p ON p.id = f.project_id
           JOIN manufacturer mfr ON mfr.id = p.manufacturer_id
           JOIN test_type tt ON tt.code = tr.test_type_code
           ${whereSql}
           ORDER BY ${EFF_DATE} ${orderDir}, tr.updated_at ${orderDir}, tr.id DESC
           LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      const items = rows.map((r) => {
        const itemVerdict =
          r.overall_pass === null
            ? r.status === 'in_progress'
              ? 'incomplete'
              : 'not_started'
            : r.overall_pass
              ? 'pass'
              : 'fail';
        return {
          id: r.id,
          modelId: r.model_id,
          modelName: r.model_name,
          familyName: r.family_name,
          projectId: r.project_id,
          taskNo: r.task_no,
          reportNo: r.report_no,
          danakNo: r.danak_no,
          manufacturerName: r.manufacturer_name,
          testTypeCode: r.test_type_code,
          displayName: r.display_name,
          category: r.category,
          reportSheetRef: r.report_sheet_ref,
          status: r.status,
          verdict: itemVerdict,
          temperatureC: r.temperature_c,
          chamberTempC: r.chamber_temp_c,
          roomTempC: r.room_temp_c,
          humidityPct: r.humidity_pct,
          datePerformed: r.date_performed,
          timePerformed: r.time_performed,
          operatorName: r.operator_name,
          remarks: r.remarks,
          testLoad: r.test_load,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      });

      // Anchors cover this page only (withPoH): page-relative slots keep the
      // chain cheap at any table size. The SQL above already filtered.
      const anchored = withPoH(items);
      return { testRuns: anchored.testRuns, poh: anchored.poh, total: Number(total), limit, offset };
    },
    [],
  );
  /** Every test for a model, whether or not a run exists yet — this drives the sidebar. */
  router.get(
    '/api/models/:id/tests',
    async (ctx) => {
      const modelId = Number(ctx.params.id);
      const [model, projectContext, testTypes, runs] = await Promise.all([
        getModel(modelId),
        // Project id and standard in one lookup, so nothing waits on a second round trip.
        get<{ project_id: number; standard_version: string }>(
          `SELECT f.project_id, p.standard_version
             FROM instrument_model m
             JOIN instrument_family f ON f.id = m.family_id
             JOIN project p ON p.id = f.project_id
            WHERE m.id = ?`,
          [modelId],
        ),
        getCachedTestTypes<{
          code: string;
          display_name: string;
          report_sheet_ref: string | null;
          category: string | null;
          form_kind: string | null;
          implemented: boolean;
          applicable_standards: string;
          sort_order: number;
        }>(),
        all<{ id: number; test_type_code: string; status: string; overall_pass: number | null }>(
          'SELECT id, test_type_code, status, overall_pass FROM test_run WHERE model_id = ?',
          [modelId],
        ),
      ]);
      const projectId = projectContext?.project_id ?? 0;
      const project = projectContext
        ? { standard_version: projectContext.standard_version }
        : null;

      const runByCode = new Map(runs.map((r) => [r.test_type_code, r]));

      const tests = testTypes
        .filter((t) =>
          !project ||
          parseJson<string[]>(t.applicable_standards, []).includes(project.standard_version),
        )
        .map((t) => {
          const testRun = runByCode.get(t.code);
          const verdict = !testRun
            ? 'not_started'
            : testRun.overall_pass === null
              ? testRun.status === 'in_progress'
                ? 'incomplete'
                : 'not_started'
              : testRun.overall_pass
                ? 'pass'
                : 'fail';
          return {
            code: t.code,
            displayName: t.display_name,
            reportSheetRef: t.report_sheet_ref,
            category: t.category,
            formKind: t.form_kind,
            implemented: Boolean(t.implemented),
            testRunId: testRun?.id ?? null,
            verdict,
          };
        });

      return {
        model: { ...model, spec: toInstrumentSpec(model) },
        projectId,
        standardVersion: project?.standard_version ?? null,
        tests,
      };
    },
    [],
  );

  /**
   * Open a test: returns the existing run or creates one pre-filled with the model's
   * reference weights. Idempotent, so the client can navigate straight to a test screen
   * without a separate "create" step.
   *
   * The pre-check plus insert used to race: two concurrent opens both passed the
   * SELECT, one died on the UNIQUE constraint (a 500 with a burned run id), and the
   * loser could hand the UI an id for a run that never committed. The insert is now
   * conflict-proof and the whole open retries, so every duplicate converges on the
   * single committed run instead of producing ghosts.
   */
  router.post(
    '/api/models/:id/tests/:code',
    async (ctx) => {
      const modelId = Number(ctx.params.id);
      const code = ctx.params.code!;
      await getModel(modelId);

      const testType = findTestType(code);
      if (!testType) throw notFound(`Unknown test type: ${code}`);
      if (!testType.formKind) {
        throw badRequest(
          `${testType.displayName} is defined in the standard but has no data-entry form in this build`,
        );
      }

      const testLoad = numOrNull(ctx.body.test_load);

      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await get<{ id: number }>(
          'SELECT id FROM test_run WHERE model_id = ? AND test_type_code = ?',
          [modelId, code],
        );
        if (existing) return { testRun: await evaluateTestRun(existing.id), created: false };

        try {
          const out = await transaction(async () => {
            const inserted = await run(
              `INSERT INTO test_run (model_id, test_type_code, status, test_load, operator_name)
               VALUES (?, ?, 'not_started', ?, ?)
               ON CONFLICT (model_id, test_type_code) DO NOTHING`,
              [modelId, code, testLoad, ctx.user?.name ?? null],
            );
            // Lost the race after all: loop back and return the winner.
            if (inserted.changes === 0) throw new RaceLostError();
            const row = await get<{ id: number }>(
              'SELECT id FROM test_run WHERE model_id = ? AND test_type_code = ?',
              [modelId, code],
            );
            if (!row) throw new RaceLostError();
            await insertRows(row.id, await starterRows(modelId, testType.formKind, testLoad, code));
            return { testRun: await refreshTestRunVerdict(row.id), created: true };
          });
          // TEMPORARY ghost hunt: verify post-commit visibility.
          const verify = await get<{ id: number }>('SELECT id FROM test_run WHERE id = ?', [
            (out.testRun as { run: { id: number } }).run.id,
          ]);
          console.error(`[create-verify] model=${modelId} code=${code} id=${(out.testRun as { run: { id: number } }).run.id} visible=${!!verify}`);
          return out;
        } catch (error) {
          if (error instanceof RaceLostError) continue;
          throw error;
        }
      }
      throw badRequest('Could not open the test after several attempts; please retry.');
    },
    [],
  );

  router.get(
    '/api/test-runs/:id',
    async (ctx) => ({ testRun: await evaluateTestRun(Number(ctx.params.id)) }),
    [],
  );

  /**
   * Save a run: metadata plus the full row set, evaluated and returned in one response.
   *
   * Returning the freshly computed result means the client never has to duplicate the
   * rules to show a verdict — it renders whatever the server computed.
   */
  router.put(
    '/api/test-runs/:id',
    async (ctx) => {
      const runId = Number(ctx.params.id);
      const testRun = await getTestRun(runId);
      const testType = findTestType(testRun.test_type_code);
      const formKind = testType?.formKind ?? null;

      const fields = readRunFields(ctx.body);

      // Envelope check, not a verdict: a recording outside the OIML operating
      // range is refused rather than stored.
      const asNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
      const condIssue = validateTestConditions({
        temperatureC: asNum(fields.temperature_c),
        chamberTempC: asNum(fields.chamber_temp_c),
        roomTempC: asNum(fields.room_temp_c),
        humidityPct: asNum(fields.humidity_pct),
        pressureHPa: asNum(fields.barometric_hpa),
      })[0];
      if (condIssue) throw badRequest(condIssue.message);

      return await transaction(async () => {
        // `updated_at` alone is a valid update: a request that only replaces rows still
        // touches the run, and `SET , updated_at = ...` would not parse.
        const assignments = Object.keys(fields).map((column) => `${column} = ?`);
        await run(
          `UPDATE test_run SET ${[...assignments, 'updated_at = CURRENT_TIMESTAMP'].join(', ')}
            WHERE id = ?`,
          [...Object.values(fields), runId],
        );

        if (Array.isArray(ctx.body.rows)) {
          const parsed = ctx.body.rows.map((row, index) =>
            readObservation(formKind, row, index),
          );
          const sequences = new Set(parsed.map((r) => r.sequence_no));
          if (sequences.size !== parsed.length) {
            throw badRequest('Duplicate sequence numbers in rows');
          }
          // Physical sanity per row (negative loads, non-numeric readings).
          // Verdict-neutral: this refuses storage, it never fails a test.
          const spec = toInstrumentSpec(await getModel(testRun.model_id));
          for (const r of parsed) {
            const issue = validateObservationInput(
              {
                sequenceNo: r.sequence_no as number,
                loadValue: r.load_value as number,
                indicationUp: r.indication_up as number | null,
                indicationDown: r.indication_down as number | null,
                deltaLUp: r.delta_l_up as number | null,
                deltaLDown: r.delta_l_down as number | null,
                testVoltageKv: r.test_voltage_kv as number | null,
                frequencyMhz: r.frequency_mhz as number | null,
                fieldStrengthVM: r.field_strength_v_m as number | null,
                indicationBefore: r.indication_before as number | null,
                indicationAfter: r.indication_after as number | null,
                loadZero: r.load_zero as number | null,
                indicationZero: r.indication_zero as number | null,
              },
              spec,
            )[0];
            if (issue) throw badRequest(issue.message);
          }
          await run('DELETE FROM observation WHERE test_run_id = ?', [runId]);
          await insertRows(runId, parsed);
        } else if (ctx.body.rows !== undefined) {
          throw badRequest('rows must be an array of observation objects');
        }

        if ('status' in ctx.body) {
          // Accepted but advisory: refreshTestRunVerdict derives the real status from the
          // rows, so a client cannot mark an incomplete table "complete".
          oneOf(ctx.body.status, RUN_STATUSES, 'status');
        }

        await run('UPDATE project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
          await projectIdForModel(testRun.model_id),
        ]);

        return { testRun: await refreshTestRunVerdict(runId) };
      });
    },
    [],
  );

  /** Add a row to a run — used by the "add measurement" button on variable-length tables. */
  router.post(
    '/api/test-runs/:id/rows',
    async (ctx) => {
      const runId = Number(ctx.params.id);
      const testRun = await getTestRun(runId);
      const formKind = findTestType(testRun.test_type_code)?.formKind ?? null;

      const next = await get<{ next: number }>(
        'SELECT coalesce(max(sequence_no), 0) + 1 AS next FROM observation WHERE test_run_id = ?',
        [runId],
      );
      const row = readObservation(formKind, ctx.body, (next?.next ?? 1) - 1);
      row.sequence_no = next?.next ?? 1;

      const spec = toInstrumentSpec(await getModel(testRun.model_id));
      const rowIssue = validateObservationInput(
        {
          sequenceNo: row.sequence_no as number,
          loadValue: row.load_value as number,
          indicationUp: row.indication_up as number | null,
          indicationDown: row.indication_down as number | null,
          deltaLUp: row.delta_l_up as number | null,
          deltaLDown: row.delta_l_down as number | null,
          testVoltageKv: row.test_voltage_kv as number | null,
          frequencyMhz: row.frequency_mhz as number | null,
          fieldStrengthVM: row.field_strength_v_m as number | null,
          indicationBefore: row.indication_before as number | null,
          indicationAfter: row.indication_after as number | null,
          loadZero: row.load_zero as number | null,
          indicationZero: row.indication_zero as number | null,
        },
        spec,
      )[0];
      if (rowIssue) throw badRequest(rowIssue.message);

      await insertRows(runId, [row]);
      return { testRun: await refreshTestRunVerdict(runId) };
    },
    [],
  );

  router.delete(
    '/api/test-runs/:runId/rows/:rowId',
    async (ctx) => {
      const runId = Number(ctx.params.runId);
      await getTestRun(runId);
      const { changes } = await run('DELETE FROM observation WHERE id = ? AND test_run_id = ?', [
        Number(ctx.params.rowId),
        runId,
      ]);
      if (changes === 0) throw notFound('Observation row not found on this run');
      return { testRun: await refreshTestRunVerdict(runId) };
    },
    [],
  );

  /** Reset a run back to blank indications, keeping the loads. */
  router.post(
    '/api/test-runs/:id/reset',
    async (ctx) => {
      const runId = Number(ctx.params.id);
      const testRun = await getTestRun(runId);
      const formKind = findTestType(testRun.test_type_code)?.formKind ?? null;
      return await transaction(async () => {
        await run('DELETE FROM observation WHERE test_run_id = ?', [runId]);
        await insertRows(runId, await starterRows(testRun.model_id, formKind, testRun.test_load, testRun.test_type_code));
        return { testRun: await refreshTestRunVerdict(runId) };
      });
    },
    [],
  );

  router.delete(
    '/api/test-runs/:id',
    async (ctx) => {
      const runId = Number(ctx.params.id);
      await getTestRun(runId);
      await run('DELETE FROM test_run WHERE id = ?', [runId]);
      return { deleted: runId };
    },
    [],
  );
}
