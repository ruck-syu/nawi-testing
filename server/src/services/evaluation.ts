/**
 * evaluation — the single place where stored rows meet the calculation rules.
 *
 * Every read path (test screens, summary dashboard, generated report) goes through
 * `evaluateTestRun`, so there is exactly one implementation of "what is this test's
 * verdict". That is what makes the summary table trustworthy: it cannot disagree with
 * the test screen, because it is not a separate calculation.
 */

import { all, get, getCachedTestTypes, parseJson, run } from '../db/index.ts';
import { notFound } from '../http.ts';
import { config } from '../config.ts';
import {
  computeEccentricity,
  computeEquilibrium,
  computeEsd,
  computeRadiated,
  computeRepeatability,
  computeSpanStability,
  computeZeroCreep,
  eccentricityPositions,
  resolveMpeTable,
  summariseTable,
  type EccentricityPositionInput,
  type EsdRowInput,
  type InstrumentSpec,
  type ObservationInput,
  type PanShape,
  type RadiatedPointInput,
  type SpanMeasurementInput,
  type Verdict,
  findTestType,
} from '../domain.ts';

/** Active MPE table per MPE_TABLE env (default 'spec' — no behaviour change until set). */
function activeMpeTable() {
  return resolveMpeTable(config.mpeTable);
}

/**
 * Transaction safety note: `db/index.ts` pins the transaction client via AsyncLocalStorage,
 * so plain `all`/`get`/`run` calls made anywhere inside a `transaction()` callback — including
 * through these helpers — are routed onto the pinned connection and see that transaction's
 * uncommitted writes.
 */

export interface ModelRow {
  id: number;
  family_id: number;
  model_name: string;
  max_capacity: number;
  min_capacity: number;
  e_value: number;
  d_value: number;
  n_intervals: number;
  accuracy_class: string;
  fractional_factor_pi: number;
  mpd_span_stability: number;
  pan_shape: string;
  [key: string]: unknown;
}

export interface TestRunRow {
  id: number;
  model_id: number;
  test_type_code: string;
  status: string;
  temperature_c: number | null;
  chamber_temp_c: number | null;
  room_temp_c: number | null;
  humidity_pct: number | null;
  barometric_hpa: number | null;
  date_performed: string | null;
  time_performed: string | null;
  operator_name: string | null;
  test_load: number | null;
  indication_zero: number | null;
  remarks: string | null;
  overall_pass: number | null;
  [key: string]: unknown;
}

export interface ObservationRow {
  id: number;
  test_run_id: number;
  sequence_no: number;
  load_value: number;
  indication_up: number | null;
  indication_down: number | null;
  delta_l_up: number | null;
  delta_l_down: number | null;
  position_code: string | null;
  position_label: string | null;
  load_zero: number | null;
  indication_zero: number | null;
  test_voltage_kv: number | null;
  application_mode: string | null;
  polarity: string | null;
  indication_before: number | null;
  indication_after: number | null;
  frequency_mhz: number | null;
  field_strength_v_m: number | null;
  condition: string | null;
  measured_at: string | null;
}

/** Project the stored model row onto the narrow shape the rules need. */
export function toInstrumentSpec(model: ModelRow): InstrumentSpec {
  return {
    max: model.max_capacity,
    min: model.min_capacity,
    e: model.e_value,
    d: model.d_value,
    accuracyClass: (model.accuracy_class as InstrumentSpec['accuracyClass']) ?? 'II',
    fractionalFactorPi: model.fractional_factor_pi ?? 1,
    mpdSpanStability: model.mpd_span_stability ?? 0.25,
  };
}

export async function getModel(modelId: number) {
  const model = await get<ModelRow>('SELECT * FROM instrument_model WHERE id = ?', [modelId]);
  if (!model) throw notFound(`Instrument model ${modelId} not found`);
  return model;
}

export async function getTestRun(runId: number) {
  const testRun = await get<TestRunRow>('SELECT * FROM test_run WHERE id = ?', [runId]);
  if (!testRun) throw notFound(`Test run ${runId} not found`);
  return testRun;
}

export async function getObservations(runId: number) {
  return all<ObservationRow>(
    'SELECT * FROM observation WHERE test_run_id = ? ORDER BY sequence_no',
    [runId],
  );
}

/**
 * The computed shape of a test run, discriminated by `formKind` so the client can render
 * the right table without re-deriving anything.
 */
export type EvaluatedRun = {
  run: TestRunRow;
  testType: ReturnType<typeof findTestType>;
  spec: InstrumentSpec;
  model: ModelRow;
  verdict: Verdict;
  overallPass: boolean;
  formKind: string | null;
  /** The computed table, shaped per form kind. */
  result: unknown;
  attachments: AttachmentRow[];
};

export interface AttachmentRow {
  id: number;
  project_id: number;
  model_id: number | null;
  test_run_id: number | null;
  file_path: string;
  original_name: string | null;
  mime_type: string | null;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

/**
 * Compute a test run's full result.
 *
 * The dispatch on `formKind` rather than on test code is deliberate: adding T3, T4, or
 * another EMC sub-test means seeding a row with an existing form kind, and this function
 * already handles it.
 */
export async function evaluateTestRun(runId: number) {
  const testRun = await getTestRun(runId);
  // Model, observations and attachments are independent reads once the run is
  // known — one round trip instead of three.
  const [model, observations, attachments] = await Promise.all([
    getModel(testRun.model_id),
    getObservations(runId),
    all<AttachmentRow>('SELECT * FROM attachment WHERE test_run_id = ? ORDER BY uploaded_at', [runId]),
  ]);
  const spec = toInstrumentSpec(model);
  const testType = findTestType(testRun.test_type_code);
  const formKind = testType?.formKind ?? null;

  let result: unknown = null;
  let verdict: Verdict = 'incomplete';

  switch (formKind) {
    case 'weighing_performance': {
      const rows: ObservationInput[] = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        loadValue: row.load_value,
        indicationUp: row.indication_up,
        indicationDown: row.indication_down,
        deltaLUp: row.delta_l_up,
        deltaLDown: row.delta_l_down,
      }));
      const summary = summariseTable(rows, spec, { testTypeCode: testRun.test_type_code, table: activeMpeTable() });
      result = summary;
      verdict = summary.verdict;
      break;
    }

    case 'repeatability': {
      const trials = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        indication: row.indication_up,
      }));
      // The load under test lives on the run, not per row — every trial uses the same load.
      const load = testRun.test_load ?? observations[0]?.load_value ?? 0;
      const summary = computeRepeatability(
        trials,
        load,
        testRun.indication_zero ?? 0,
        spec,
        activeMpeTable(),
      );
      result = { ...summary, load };
      verdict = summary.verdict;
      break;
    }

    case 'eccentricity': {
      const rows: EccentricityPositionInput[] = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        positionCode: row.position_code ?? '',
        positionLabel: row.position_label ?? '',
        loadZero: row.load_zero ?? 0,
        indicationZero: row.indication_zero,
        loadValue: row.load_value,
        indication: row.indication_up,
      }));
      const summary = computeEccentricity(rows, spec, activeMpeTable());
      result = {
        ...summary,
        panShape: model.pan_shape,
        positions: eccentricityPositions(model.pan_shape as PanShape),
      };
      verdict = summary.verdict;
      break;
    }

    case 'esd': {
      const rows: EsdRowInput[] = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        testVoltageKv: row.test_voltage_kv ?? 0,
        applicationMode: row.application_mode ?? 'contact',
        polarity: row.polarity ?? 'positive',
        loadValue: row.load_value,
        indicationBefore: row.indication_before,
        indicationAfter: row.indication_after,
      }));
      const summary = computeEsd(rows, spec, activeMpeTable());
      // The client renders per-test vocabulary (burst vs discharge steps, mode options)
      // from this rather than hardcoding it, so the next disturbance test is still data.
      result = { ...summary, disturbance: testType?.disturbance ?? null };
      verdict = summary.verdict;
      break;
    }

    case 'radiated': {
      const rows: RadiatedPointInput[] = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        frequencyMhz: row.frequency_mhz,
        fieldStrengthVM: row.field_strength_v_m,
        loadValue: row.load_value,
        indicationBefore: row.indication_before,
        indicationAfter: row.indication_after,
      }));
      const summary = computeRadiated(rows, spec, activeMpeTable());
      result = summary;
      verdict = summary.verdict;
      break;
    }

    case 'span_stability': {
      const rows: SpanMeasurementInput[] = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        condition: row.condition ?? '',
        measuredAt: row.measured_at,
        loadValue: row.load_value,
        indication: row.indication_up,
        indicationZero: row.indication_zero,
      }));
      const summary = computeSpanStability(rows, spec, activeMpeTable());
      result = summary;
      verdict = summary.verdict;
      break;
    }

    case 'equilibrium': {
      const trials = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        indication: row.indication_up,
      }));
      const load = testRun.test_load ?? observations[0]?.load_value ?? 0;
      const summary = computeEquilibrium(trials, load, spec);
      result = { ...summary, load };
      verdict = summary.verdict;
      break;
    }

    case 'zero_creep': {
      const readings = observations.map((row) => ({
        sequenceNo: row.sequence_no,
        condition: row.condition ?? '',
        measuredAt: row.measured_at,
        loadValue: row.load_value,
        indication: row.indication_up,
      }));
      const summary = computeZeroCreep(readings, spec);
      result = summary;
      verdict = summary.verdict;
      break;
    }

    default:
      // Seeded but not implemented: no data entry, so nothing to judge.
      result = { rows: [], notImplemented: true };
      verdict = 'incomplete';
  }

  return {
    run: testRun,
    testType,
    spec,
    model,
    verdict,
    overallPass: verdict === 'pass',
    formKind,
    result,
    attachments,
  };
}

/**
 * Recompute and persist a run's cached verdict.
 *
 * `overall_pass` is a cache for sorting and filtering, never the source of truth — it is
 * rewritten from the rules on every save, so it cannot drift.
 */
export async function refreshTestRunVerdict(
  runId: number,
): Promise<EvaluatedRun> {
  const evaluated = await evaluateTestRun(runId);
  const hasEnteredData = (): boolean => {
    if (!evaluated.result || typeof evaluated.result !== 'object') return false;
    const res = evaluated.result as Record<string, unknown>;
    if ('rowsEntered' in res && typeof res.rowsEntered === 'number') return res.rowsEntered > 0;
    if (Array.isArray(res.trials)) {
      return (res.trials as { indication?: number | null }[]).some((t) => t.indication !== null);
    }
    if (Array.isArray(res.rows)) {
      return (res.rows as {
        indication?: number | null;
        indicationBefore?: number | null;
        indicationAfter?: number | null;
      }[]).some(
        (r) => r.indication !== null || r.indicationBefore !== null || r.indicationAfter !== null,
      );
    }
    if (Array.isArray(res.measurements)) {
      return (res.measurements as { indication?: number | null }[]).some((m) => m.indication !== null);
    }
    return false;
  };

  const status =
    evaluated.verdict === 'incomplete'
      ? hasEnteredData()
        ? 'in_progress'
        : 'not_started'
      : 'complete';

  const overallPass = evaluated.verdict === 'incomplete' ? null : evaluated.overallPass ? 1 : 0;

  await run(
    `UPDATE test_run
        SET overall_pass = ?, status = ?, updated_at = now()
      WHERE id = ?`,
    [overallPass, status, runId],
  );

  // The returned run must carry the values just written, not the ones read at the top of
  // this function. Echoing the pre-update row would hand the client a payload whose
  // cached `overall_pass` contradicts its own `verdict` field.
  return {
    ...evaluated,
    run: { ...evaluated.run, status, overall_pass: overallPass },
  };
}

// ---------------------------------------------------------------------------
export interface SummaryEntry {
  testRunId: number | null;
  testTypeCode: string;
  displayName: string;
  reportSheetRef: string;
  category: string;
  implemented: boolean;
  /**
   * Derived from the cached `overall_pass` column rather than a fresh evaluation:
   * 1 -> pass, 0 -> fail, null -> incomplete while in progress, otherwise not started.
   */
  verdict: Verdict | 'not_started';
  remarks: string | null;
  rowsEntered: number | null;
  rowsTotal: number | null;
}

/**
 * Verdict from the cached run columns alone, without loading observations.
 *
 * `overall_pass` is rewritten from the full rules on every write to the run (see
 * `refreshTestRunVerdict`), so it can be trusted here precisely because nothing
 * else ever writes it.
 */
function cachedVerdict(run: {
  overall_pass: number | null;
  status: string;
}): Verdict | 'not_started' {
  if (run.overall_pass === 1) return 'pass';
  if (run.overall_pass === 0) return 'fail';
  return run.status === 'in_progress' ? 'incomplete' : 'not_started';
}

/**
 * Summaries for many models in a fixed number of queries, regardless of how many models or
 * runs are involved: one pass over the cached test_type master data, one over test_run for
 * every model at once, one grouped count over observation for every run at once. This keeps
 * the dashboards and report off the O(runs x observations) path that per-run
 * `evaluateTestRun` calls would put them on.
 */
async function summariseModels(
  modelIds: number[],
  standardVersion: string,
): Promise<Map<number, SummaryEntry[]>> {
  const summaries = new Map<number, SummaryEntry[]>(modelIds.map((id) => [id, []]));

  const testTypes = await getCachedTestTypes<{
    code: string;
    display_name: string;
    report_sheet_ref: string;
    category: string;
    implemented: boolean;
    applicable_standards: unknown;
  }>();
  const applicable = testTypes.filter((t) =>
    parseJson<string[]>(t.applicable_standards, []).includes(standardVersion),
  );

  const runsQuery =
    modelIds.length === 0
      ? Promise.resolve([])
      : all<{
          id: number;
          model_id: number;
          test_type_code: string;
          status: string;
          remarks: string | null;
          overall_pass: number | null;
        }>(
          `SELECT id, model_id, test_type_code, status, remarks, overall_pass
             FROM test_run WHERE model_id IN (${modelIds.map(() => '?').join(', ')})`,
          modelIds,
        );

  // Row counts keyed by run, filtered by model rather than by run id — so this
  // query needs no run list first and runs in parallel with the one above.
  // `entered` counts rows where any recorded reading column is populated,
  // whichever form kind the run uses; count(*) returns bigint, which the driver
  // delivers as a string, hence the Number() coercion.
  const countsQuery =
    modelIds.length === 0
      ? Promise.resolve([])
      : all<{
          test_run_id: number;
          entered: number | string;
          total: number | string;
        }>(
          `SELECT o.test_run_id,
                  sum(CASE WHEN COALESCE(o.indication_up, o.indication_down,
                           o.indication_before, o.indication_after) IS NOT NULL
                      THEN 1 ELSE 0 END)::int AS entered,
                  count(*) AS total
             FROM observation o
             JOIN test_run tr ON tr.id = o.test_run_id
            WHERE tr.model_id IN (${modelIds.map(() => '?').join(', ')})
            GROUP BY o.test_run_id`,
          modelIds,
        );

  const [runs, countRows] = await Promise.all([runsQuery, countsQuery]);
  const runByKey = new Map(runs.map((r) => [`${r.model_id}:${r.test_type_code}`, r]));

  const counts = new Map(
    countRows.map((c) => [
      Number(c.test_run_id),
      { entered: Number(c.entered), total: Number(c.total) },
    ]),
  );

  for (const modelId of modelIds) {
    const entries = summaries.get(modelId)!;
    for (const testType of applicable) {
      const run = runByKey.get(`${modelId}:${testType.code}`);
      if (!run) {
        entries.push({
          testRunId: null,
          testTypeCode: testType.code,
          displayName: testType.display_name,
          reportSheetRef: testType.report_sheet_ref,
          category: testType.category,
          implemented: Boolean(testType.implemented),
          verdict: 'incomplete',
          remarks: null,
          rowsEntered: null,
          rowsTotal: null,
        });
        continue;
      }
      const count = counts.get(run.id);
      entries.push({
        testRunId: run.id,
        testTypeCode: testType.code,
        displayName: testType.display_name,
        reportSheetRef: testType.report_sheet_ref,
        category: testType.category,
        implemented: Boolean(testType.implemented),
        verdict: cachedVerdict(run),
        remarks: run.remarks,
        rowsEntered: count?.entered ?? null,
        rowsTotal: count?.total ?? null,
      });
    }
  }

  return summaries;
}

/**
 * The Summary of Results table for one model, computed from the cached run state rather than
 * entered by hand or re-evaluated per run. Includes seeded-but-unimplemented tests so the
 * report shows the full intended scope with honest "not performed" rows.
 */
export async function modelSummary(
  modelId: number,
  standardVersion: string,
): Promise<SummaryEntry[]> {
  const summaries = await summariseModels([modelId], standardVersion);
  return summaries.get(modelId) ?? [];
}

export interface ProjectRollup {
  models: Array<{
    model: ModelRow;
    summary: SummaryEntry[];
    verdict: Verdict;
  }>;
  testCount: number;
  passCount: number;
  failCount: number;
  incompleteCount: number;
  verdict: Verdict;
}

/**
 * Roll a whole project up to one verdict.
 *
 * Only implemented tests that have a run count toward the verdict: an unimplemented
 * seeded test should not make a project look permanently unfinished. All models'
 * summaries come out of one batched `summariseModels` call — three queries total,
 * whatever the project's size.
 */
export async function projectRollup(
  projectId: number,
  preloaded?: { standardVersion?: string; models?: ModelRow[] },
): Promise<ProjectRollup> {
  const standardVersion =
    preloaded?.standardVersion ??
    (
      await get<{ standard_version: string }>(
        'SELECT standard_version FROM project WHERE id = ?',
        [projectId],
      )
    )?.standard_version;

  if (!standardVersion) throw notFound(`Project ${projectId} not found`);

  const models =
    preloaded?.models ??
    (await all<ModelRow>(
      `SELECT m.* FROM instrument_model m
         JOIN instrument_family f ON f.id = m.family_id
        WHERE f.project_id = ?
        ORDER BY m.id`,
      [projectId],
    ));

  const summaries = await summariseModels(
    models.map((m) => m.id),
    standardVersion,
  );

  let passCount = 0;
  let failCount = 0;
  let incompleteCount = 0;

  const modelRollups = models.map((model) => {
    const summary = summaries.get(model.id) ?? [];
    const relevant = summary.filter((entry) => entry.implemented && entry.testRunId !== null);

    for (const entry of relevant) {
      if (entry.verdict === 'pass') passCount += 1;
      else if (entry.verdict === 'fail') failCount += 1;
      else incompleteCount += 1;
    }

    const modelVerdict: Verdict = relevant.some((e) => e.verdict === 'fail')
      ? 'fail'
      : relevant.length > 0 && relevant.every((e) => e.verdict === 'pass')
        ? 'pass'
        : 'incomplete';

    return { model, summary, verdict: modelVerdict };
  });

  const testCount = passCount + failCount + incompleteCount;
  const verdict: Verdict =
    failCount > 0 ? 'fail' : testCount > 0 && incompleteCount === 0 ? 'pass' : 'incomplete';

  return {
    models: modelRollups,
    testCount,
    passCount,
    failCount,
    incompleteCount,
    verdict,
  };
}
