/**
 * Project, instrument model and checklist routes.
 *
 * The `n` interval count is always written as round(Max/e) by this layer, never taken
 * from the request. Clients display it live for feedback, but the stored value comes from
 * the rule, so a hand-edited form field cannot introduce an inconsistent instrument.
 */

import {
  all,
  get,
  getCachedChecklistItems,
  parseJson,
  run,
  transaction,
} from '../db/index.ts';
import {
  badRequest,
  dateOrNull,
  forbidden,
  notFound,
  num,
  numOrNull,
  oneOf,
  str,
  strOrNull,
  type Router,
} from '../http.ts';
import { computeN, generateReferenceWeights, validateInstrumentSpecInput, type AccuracyClass } from '../domain.ts';
import { projectRollup, toInstrumentSpec, getModel, type ModelRow } from './../services/evaluation.ts';
import { requireProjectStage, requireEditableProject } from '../services/review.ts';
import { createShare, getActiveShare, revokeShare } from '../services/share.ts';

const ACCURACY_CLASSES = ['I', 'II', 'III', 'IIII'] as const;
const PAN_SHAPES = ['rectangular_4corner', 'triangular_3point'] as const;

interface ProjectRow {
  id: number;
  manufacturer_id: number;
  task_no: string;
  report_no: string;
  danak_no: string | null;
  standard_version: string;
  examination_start_date: string | null;
  examination_end_date: string | null;
  status: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Shape a stored model row for the client, expanding the JSON flag blobs. */
async function serialiseModel(model: ModelRow) {
  return {
    ...model,
    zero_setting_types: parseJson<Record<string, unknown>>(model.zero_setting_types, {}),
    tare_types: parseJson<Record<string, unknown>>(model.tare_types, {}),
    spec: toInstrumentSpec(model),
    referenceWeights: await all<{ id: number; nominal_load_value: number; sequence_order: number }>(
      'SELECT id, nominal_load_value, sequence_order FROM reference_weight WHERE model_id = ? ORDER BY sequence_order',
      [model.id],
    ),
  };
}

async function requireProject(id: number) {
  const project = await get<ProjectRow>('SELECT * FROM project WHERE id = ?', [id]);
  if (!project) throw notFound(`Project ${id} not found`);
  return project;
}

async function touchProject(id: number) {
  await run('UPDATE project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

/**
 * Read model fields from a request body.
 *
 * `n_intervals` is absent by design — see the file header.
 */
function readModelFields(body: Record<string, unknown>) {
  const max = num(body.max_capacity, 'max_capacity');
  const e = num(body.e_value, 'e_value');
  const d = numOrNull(body.d_value, 'd_value') ?? e;
  const min = num(body.min_capacity, 'min_capacity');
  const pi = numOrNull(body.fractional_factor_pi, 'fractional_factor_pi') ?? 1;
  const mpd = numOrNull(body.mpd_span_stability, 'mpd_span_stability') ?? 0.25;
  const accuracyClass = oneOf<AccuracyClass>(body.accuracy_class, ACCURACY_CLASSES, 'accuracy_class', 'II');
  const panShape = oneOf(body.pan_shape, PAN_SHAPES, 'pan_shape', 'rectangular_4corner');
  const optMin = numOrNull(body.operating_temp_min, 'operating_temp_min');
  const optMax = numOrNull(body.operating_temp_max, 'operating_temp_max');

  const issues = validateInstrumentSpecInput({
    max,
    min,
    e,
    d,
    accuracyClass,
    fractionalFactorPi: pi,
    mpdSpanStability: mpd,
    operating_temp_min: optMin,
    operating_temp_max: optMax,
  });
  if (issues.length > 0) {
    throw badRequest(issues[0]!.message);
  }

  return {
    model_name: str(body.model_name, 'model_name'),
    max_capacity: max,
    min_capacity: min,
    e_value: e,
    d_value: d,
    n_intervals: computeN(max, e),
    accuracy_class: accuracyClass,
    fractional_factor_pi: pi,
    load_cell_type: strOrNull(body.load_cell_type),
    load_cell_manufacturer: strOrNull(body.load_cell_manufacturer),
    load_cell_capacity: strOrNull(body.load_cell_capacity),
    load_cell_rated_output_mvv: numOrNull(body.load_cell_rated_output_mvv, 'load_cell_rated_output_mvv'),
    load_cell_min_impedance_ohm: numOrNull(body.load_cell_min_impedance_ohm, 'load_cell_min_impedance_ohm'),
    zero_setting_types: JSON.stringify(body.zero_setting_types ?? {}),
    tare_types: JSON.stringify(body.tare_types ?? {}),
    max_tare_pct: numOrNull(body.max_tare_pct, 'max_tare_pct'),
    operating_temp_min: optMin,
    operating_temp_max: optMax,
    power_ac_nominal_v: numOrNull(body.power_ac_nominal_v, 'power_ac_nominal_v'),
    power_ac_min_v: numOrNull(body.power_ac_min_v, 'power_ac_min_v'),
    power_ac_max_v: numOrNull(body.power_ac_max_v, 'power_ac_max_v'),
    power_dc_nominal_v: numOrNull(body.power_dc_nominal_v, 'power_dc_nominal_v'),
    power_dc_min_v: numOrNull(body.power_dc_min_v, 'power_dc_min_v'),
    power_dc_max_v: numOrNull(body.power_dc_max_v, 'power_dc_max_v'),
    mpd_span_stability: mpd,
    pan_shape: panShape,
    serial_no: strOrNull(body.serial_no),
  };
}

async function insertModel(familyId: number, body: Record<string, unknown>) {
  const fields = readModelFields(body);
  const columns = Object.keys(fields);
  const { lastInsertRowid } = await run(
    `INSERT INTO instrument_model (family_id, ${columns.join(', ')})
     VALUES (?, ${columns.map(() => '?').join(', ')})`,
    [familyId, ...Object.values(fields)],
  );
  return lastInsertRowid;
}

/**
 * Write a model's reference weight set.
 *
 * Replaces the whole set rather than diffing rows: the set is an ordered sequence, and a
 * partial update would leave gaps in `sequence_order`.
 */
async function replaceReferenceWeights(modelId: number, weights: number[]) {
  await run('DELETE FROM reference_weight WHERE model_id = ?', [modelId]);
  for (const [index, value] of weights.entries()) {
    await run(
      'INSERT INTO reference_weight (model_id, nominal_load_value, sequence_order) VALUES (?, ?, ?)',
      [modelId, value, index + 1],
    );
  }
}

function readWeightList(value: unknown): number[] {
  if (!Array.isArray(value)) throw badRequest('referenceWeights must be an array of numbers');
  if (value.length === 0) throw badRequest('referenceWeights must contain at least one weight');
  const parsed = value.map((v, i) => num(v, `referenceWeights[${i}]`));
  if (parsed.some((v) => v <= 0)) throw badRequest('Reference weights must be positive numbers');
  return [...parsed].sort((a, b) => a - b);
}

export function registerProjectRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // Dashboard listing
  // -------------------------------------------------------------------------
  router.get(
    '/api/projects',
    async (ctx) => {
      const search = (ctx.query.get('search') ?? '').trim().toLowerCase();
      const statusFilter = ctx.query.get('status');

      const rows = await all<ProjectRow & {
        manufacturer_name: string;
        model_names: string | null;
        model_count: string | number;
        test_count: string | number;
        pass_count: string | number;
        fail_count: string | number;
        incomplete_count: string | number;
      }>(
        `SELECT p.*, m.name AS manufacturer_name,
                (SELECT string_agg(im.model_name, ', ')
                   FROM instrument_model im
                   JOIN instrument_family f ON f.id = im.family_id
                  WHERE f.project_id = p.id) AS model_names,
                (SELECT count(DISTINCT im.id)
                   FROM instrument_model im
                   JOIN instrument_family f ON f.id = im.family_id
                  WHERE f.project_id = p.id) AS model_count,
                (SELECT count(*)
                   FROM test_run tr
                   JOIN instrument_model im ON im.id = tr.model_id
                   JOIN instrument_family f ON f.id = im.family_id
                  WHERE f.project_id = p.id) AS test_count,
                (SELECT count(*)
                   FROM test_run tr
                   JOIN instrument_model im ON im.id = tr.model_id
                   JOIN instrument_family f ON f.id = im.family_id
                  WHERE f.project_id = p.id AND tr.overall_pass = 1) AS pass_count,
                (SELECT count(*)
                   FROM test_run tr
                   JOIN instrument_model im ON im.id = tr.model_id
                   JOIN instrument_family f ON f.id = im.family_id
                  WHERE f.project_id = p.id AND tr.overall_pass = 0) AS fail_count,
                (SELECT count(*)
                   FROM test_run tr
                   JOIN instrument_model im ON im.id = tr.model_id
                   JOIN instrument_family f ON f.id = im.family_id
                  WHERE f.project_id = p.id AND tr.overall_pass IS NULL) AS incomplete_count
           FROM project p
           JOIN manufacturer m ON m.id = p.manufacturer_id
          ORDER BY p.updated_at DESC, p.id DESC`,
      );

      const projects = rows
        .filter((row) => !statusFilter || row.status === statusFilter)
        .filter((row) => {
          if (!search) return true;
          return [row.task_no, row.report_no, row.danak_no, row.manufacturer_name, row.model_names]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(search));
        })
        .map((row) => {
          const testCount = Number(row.test_count ?? 0);
          const passCount = Number(row.pass_count ?? 0);
          const failCount = Number(row.fail_count ?? 0);
          const incompleteCount = Number(row.incomplete_count ?? 0);
          const verdict =
            failCount > 0 ? 'fail' : testCount > 0 && incompleteCount === 0 ? 'pass' : 'incomplete';
          return {
            ...row,
            modelNames: row.model_names ? row.model_names.split(', ') : [],
            verdict,
            testCount,
            passCount,
            failCount,
            incompleteCount,
            modelCount: Number(row.model_count ?? 0),
          };
        });

      return { projects };
    },
    [],
  );

  /** Manufacturer directory for pickers and API users creating examinations. */
  router.get(
    '/api/manufacturers',
    async () => ({
      manufacturers: await all<{
        id: number;
        name: string;
        address: string | null;
        contact_person: string | null;
        email: string | null;
        phone: string | null;
      }>('SELECT id, name, address, contact_person, email, phone FROM manufacturer ORDER BY name'),
    }),
    [],
  );

  /** Update manufacturer details (address, contact, email, phone). */
  router.patch(
    '/api/manufacturers/:id',
    async (ctx) => {
      const id = num(ctx.params.id, 'id');
      if (!await get('SELECT id FROM manufacturer WHERE id = ?', [id])) {
        throw notFound(`Manufacturer ${id} not found`);
      }
      const fields: Record<string, unknown> = {};
      for (const key of ['name', 'address', 'contact_person', 'email', 'phone'] as const) {
        if (key in ctx.body) fields[key] = strOrNull(ctx.body[key]);
      }
      if (fields.name !== undefined && !String(fields.name).trim()) {
        throw badRequest('Manufacturer name must not be empty');
      }
      if (fields.email !== undefined && fields.email !== null && !String(fields.email).includes('@')) {
        throw badRequest('Manufacturer email must be a valid email address');
      }
      if (Object.keys(fields).length === 0) throw badRequest('Nothing to update');
      const assignments = Object.keys(fields).map((column) => `${column} = ?`);
      await run(`UPDATE manufacturer SET ${assignments.join(', ')} WHERE id = ?`, [
        ...Object.values(fields),
        id,
      ]);
      return {
        manufacturer: await get('SELECT id, name, address, contact_person, email, phone FROM manufacturer WHERE id = ?', [id]),
      };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Creation wizard — one transaction for the whole 3-step form
  // -------------------------------------------------------------------------

  /**
   * Create a project with its manufacturer, family, models and weight sets in one
   * transaction. The wizard collects all three steps client-side and submits once, so a
   * half-created project can never be left behind by an abandoned wizard.
   */
  router.post(
    '/api/projects',
    async (ctx) => {
      const body = ctx.body;
      // Manufacturer by id (legacy callers) or by name with find-or-create (the
      // wizard and API users, who cannot be expected to guess a surrogate id
      // that shifts on every reseed).
      let manufacturerId: number;
      if (body.manufacturer_id !== undefined && body.manufacturer_id !== null) {
        manufacturerId = num(body.manufacturer_id, 'manufacturer_id');
        if (!await get('SELECT id FROM manufacturer WHERE id = ?', [manufacturerId])) {
          throw badRequest(`Manufacturer ${manufacturerId} does not exist; pass manufacturer_name to create one.`);
        }
      } else {
        const name = str(body.manufacturer_name, 'manufacturer_name').trim();
        if (!name) throw badRequest('manufacturer_name must not be empty');
        const existing = await get<{ id: number }>(
          'SELECT id FROM manufacturer WHERE lower(name) = lower(?)',
          [name],
        );
        if (existing) {
          manufacturerId = existing.id;
        } else {
          const inserted = await run(
            'INSERT INTO manufacturer (name, address, contact_person) VALUES (?, ?, ?)',
            [name, strOrNull(body.manufacturer_address), strOrNull(body.contact_person)],
          );
          manufacturerId = inserted.lastInsertRowid;
        }
      }
      const taskNo = str(body.task_no, 'task_no');
      const reportNo = str(body.report_no, 'report_no');
      const danakNo = strOrNull(body.danak_no);
      const standardVersion = str(body.standard_version, 'standard_version');
      const startDate = dateOrNull(body.examination_start_date, 'examination_start_date');
      const endDate = dateOrNull(body.examination_end_date, 'examination_end_date');
      if (startDate && endDate && startDate > endDate) {
        throw badRequest('examination_start_date must be on or before examination_end_date');
      }
      if (!Array.isArray(body.models) || body.models.length === 0) {
        throw badRequest('At least one instrument model is required');
      }

      const familyName = strOrNull(body.family_name) ?? (body.models[0]?.model_name || 'Family');

      return await transaction(async () => {
        const { lastInsertRowid: projectId } = await run(
          `INSERT INTO project
             (manufacturer_id, task_no, report_no, danak_no, standard_version,
              examination_start_date, examination_end_date, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            manufacturerId,
            taskNo,
            reportNo,
            danakNo,
            standardVersion,
            startDate,
            endDate,
            'draft',
            ctx.user?.sub ?? null,
          ],
        );

        const { lastInsertRowid: familyId } = await run(
          'INSERT INTO instrument_family (project_id, family_name) VALUES (?, ?)',
          [projectId, familyName],
        );

        for (const rawModel of body.models as Array<Record<string, unknown>>) {
          const modelFields = readModelFields(rawModel);
          const modelId = await insertModel(familyId, modelFields);
          const weights = Array.isArray(rawModel.referenceWeights)
            ? readWeightList(rawModel.referenceWeights)
            : generateReferenceWeights({
                max: modelFields.max_capacity,
                min: modelFields.min_capacity,
                e: modelFields.e_value,
                d: modelFields.d_value,
              });
          await replaceReferenceWeights(modelId, weights);
        }

        // Seed empty checklist rows for every clause applicable to this project's standard.
        const checklistItems = await getCachedChecklistItems<{
          id: number;
          applicable_standards: string;
        }>();
        for (const item of checklistItems) {
          const applicableStandards = parseJson<string[]>(item.applicable_standards, []);
          if (
            applicableStandards.length === 0 ||
            applicableStandards.includes(standardVersion)
          ) {
            await run(
              `INSERT INTO project_checklist_result (project_id, checklist_item_id, applicable, status)
               VALUES (?, ?, 'existent', 'na')`,
              [projectId, item.id],
            );
          }
        }

        return { id: projectId };
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Single project
  // -------------------------------------------------------------------------

  router.get(
    '/api/projects/:id',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      const [project, manufacturer, familyRows, allModels, allWeights, signature] = await Promise.all([
        requireProject(projectId),
        get<Record<string, unknown>>(
          'SELECT * FROM manufacturer WHERE id = (SELECT manufacturer_id FROM project WHERE id = ?)',
          [projectId],
        ),
        all<{ id: number; family_name: string }>(
          'SELECT id, family_name FROM instrument_family WHERE project_id = ? ORDER BY id',
          [projectId],
        ),
        all<ModelRow>(
          `SELECT im.* FROM instrument_model im
             JOIN instrument_family f ON f.id = im.family_id
            WHERE f.project_id = ? ORDER BY im.id`,
          [projectId],
        ),
        all<{ id: number; model_id: number; nominal_load_value: number; sequence_order: number }>(
          `SELECT rw.id, rw.model_id, rw.nominal_load_value, rw.sequence_order
             FROM reference_weight rw
             JOIN instrument_model im ON im.id = rw.model_id
             JOIN instrument_family f ON f.id = im.family_id
            WHERE f.project_id = ? ORDER BY rw.sequence_order`,
          [projectId],
        ),
        get('SELECT * FROM signature WHERE project_id = ? ORDER BY id DESC LIMIT 1', [
          projectId,
        ]),
      ]);

      const rollup = await projectRollup(projectId, {
        standardVersion: project.standard_version,
        models: allModels,
      });

      const weightsByModel = new Map<number, { id: number; model_id: number; nominal_load_value: number; sequence_order: number }[]>();
      for (const w of allWeights) {
        const arr = weightsByModel.get(w.model_id) ?? [];
        arr.push(w);
        weightsByModel.set(w.model_id, arr);
      }

      const modelsByFamily = new Map<number, Record<string, unknown>[]>();
      for (const model of allModels) {
        const arr = modelsByFamily.get(model.family_id) ?? [];
        arr.push({
          ...model,
          zero_setting_types: parseJson<Record<string, unknown>>(model.zero_setting_types, {}),
          tare_types: parseJson<Record<string, unknown>>(model.tare_types, {}),
          spec: toInstrumentSpec(model),
          referenceWeights: weightsByModel.get(model.id) ?? [],
        });
        modelsByFamily.set(model.family_id, arr);
      }

      const families = familyRows.map((family) => ({
        ...family,
        models: modelsByFamily.get(family.id) ?? [],
      }));

      return {
        project,
        manufacturer,
        families,
        signature,
        rollup: {
          verdict: rollup.verdict,
          testCount: rollup.testCount,
          passCount: rollup.passCount,
          failCount: rollup.failCount,
          incompleteCount: rollup.incompleteCount,
          models: rollup.models.map((m) => ({
            modelId: m.model.id,
            modelName: m.model.model_name,
            verdict: m.verdict,
            summary: m.summary,
          })),
        },
      };
    },
    [],
  );

  router.patch(
    '/api/projects/:id',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireEditableProject(projectId, ctx);

      const requiredFields = ['task_no', 'report_no', 'standard_version'] as const;

      const updates: string[] = [];
      const values: unknown[] = [];
      for (const field of requiredFields) {
        if (field in ctx.body) {
          const val = strOrNull(ctx.body[field]);
          if (!val) throw badRequest(`Field ${field} cannot be empty`);
          updates.push(`${field} = ?`);
          values.push(val);
        }
      }
      if ('danak_no' in ctx.body) {
        updates.push('danak_no = ?');
        values.push(strOrNull(ctx.body.danak_no));
      }
      if ('examination_start_date' in ctx.body) {
        const d = dateOrNull(ctx.body.examination_start_date, 'examination_start_date');
        updates.push('examination_start_date = ?');
        values.push(d);
      }
      if ('examination_end_date' in ctx.body) {
        const d = dateOrNull(ctx.body.examination_end_date, 'examination_end_date');
        updates.push('examination_end_date = ?');
        values.push(d);
      }
      if ('status' in ctx.body) {
        throw badRequest('Use the review actions to change the report stage.');
      }
      if (updates.length === 0) throw badRequest('No updatable fields supplied');

      await run(
        `UPDATE project SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, projectId],
      );
      return { project: await requireProject(projectId) };
    },
    [],
  );

  router.patch('/api/projects/:id/review', async (ctx) => {
    const projectId = Number(ctx.params.id);
    const action = oneOf(ctx.body.action, ['mark_reviewed', 'approve'] as const, 'action');
    const project = await requireProjectStage(projectId);

    if (action === 'mark_reviewed') {
      if (ctx.user?.role !== 'technician') throw forbidden('Only technicians may mark reports as reviewed.');
      if (project.status === 'approved') throw badRequest('Approved reports cannot be marked as reviewed.');
      await run(
        `UPDATE project
            SET status = 'reviewed', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [ctx.user.sub, projectId],
      );
      return { project: await requireProject(projectId) };
    }

    if (ctx.user?.role !== 'admin') throw forbidden('Only administrators may review reports.');
    const adminId = ctx.user.sub;
    if (project.status === 'approved') throw badRequest('This report is already approved.');

    const signer = await get<{ name: string; signature_path: string | null }>(
      'SELECT name, signature_path FROM "user" WHERE id = ?',
      [adminId],
    );
    if (!signer?.signature_path) {
      throw badRequest('Upload your administrator signature in Profile before approving a report.');
    }

    return await transaction(async () => {
      await run(
        `UPDATE project
            SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [adminId, projectId],
      );
      await run(
        `INSERT INTO signature
           (project_id, signed_by_name, signed_by_title, signature_image_path, signed_by_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [projectId, signer.name, 'Responsible for the examination', signer.signature_path, adminId],
      );
      return { project: await requireProject(projectId) };
    });
  }, []);

  router.delete(
    '/api/projects/:id',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      const project = await requireProject(projectId);
      // Cascades remove families, models, runs, observations, checklist rows and reports.
      await run('DELETE FROM project WHERE id = ?', [projectId]);
      await run('DELETE FROM manufacturer WHERE id = ?', [project.manufacturer_id]);
      return { deleted: projectId };
    },
    ['admin'],
  );

  router.get(
    '/api/projects/:id/summary',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      // The project row is already in hand: hand its standard down so the rollup
      // skips re-reading it.
      const project = await requireProject(projectId);
      const rollup = await projectRollup(projectId, {
        standardVersion: project.standard_version,
      });
      return {
        verdict: rollup.verdict,
        testCount: rollup.testCount,
        passCount: rollup.passCount,
        failCount: rollup.failCount,
        incompleteCount: rollup.incompleteCount,
        models: rollup.models.map((m) => ({
          modelId: m.model.id,
          modelName: m.model.model_name,
          verdict: m.verdict,
          summary: m.summary,
        })),
      };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Manufacturer share link — single active token per project
  // -------------------------------------------------------------------------

  router.get(
    '/api/projects/:id/share',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireProject(projectId);
      return { share: await getActiveShare(projectId) };
    },
    [],
  );

  router.post(
    '/api/projects/:id/share',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireProject(projectId);
      return { share: await createShare(projectId, ctx.user?.sub ?? null) };
    },
    [],
  );

  router.delete(
    '/api/projects/:id/share',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireProject(projectId);
      return { revoked: await revokeShare(projectId) };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------------

  router.post(
    '/api/projects/:id/models',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireEditableProject(projectId, ctx);

      const familyId = numOrNull(ctx.body.family_id);
      const family = familyId
        ? await get<{ id: number }>('SELECT id FROM instrument_family WHERE id = ? AND project_id = ?', [
            familyId,
            projectId,
          ])
        : await get<{ id: number }>(
            'SELECT id FROM instrument_family WHERE project_id = ? ORDER BY id LIMIT 1',
            [projectId],
          );
      if (!family) throw notFound('No instrument family on this project');

      return await transaction(async () => {
        const modelId = await insertModel(family.id, ctx.body);
        const weights = Array.isArray(ctx.body.referenceWeights)
          ? readWeightList(ctx.body.referenceWeights)
          : generateReferenceWeights(toInstrumentSpec(await getModel(modelId)));
        await replaceReferenceWeights(modelId, weights);
        await touchProject(projectId);
        return { model: await serialiseModel(await getModel(modelId)) };
      });
    },
    [],
  );

  /**
   * Instrument registry: every model across all projects, newest first.
   *
   * Powers the Instruments tab and the wizard's "reuse an existing spec" picker,
   * so repeat and family-variant examinations start from a recorded spec instead
   * of a blank form. Search covers model, family, task/report numbers and
   * manufacturer.
   */
  router.get(
    '/api/models',
    async (ctx) => {
      const search = (ctx.query.get('search') ?? '').trim().toLowerCase();
      const limit = Math.min(Math.max(Number(ctx.query.get('limit') ?? 100) || 100, 1), 200);
      const where: string[] = [];
      const params: unknown[] = [];
      if (search) {
        const like = `%${search}%`;
        where.push(`(lower(m.model_name) LIKE ? OR lower(f.family_name) LIKE ?
          OR lower(p.task_no) LIKE ? OR lower(p.report_no) LIKE ? OR lower(mfr.name) LIKE ?)`);
        params.push(like, like, like, like, like);
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await all<{
        id: number;
        model_name: string;
        serial_no: string | null;
        max_capacity: number;
        min_capacity: number;
        e_value: number;
        d_value: number;
        n_intervals: number;
        accuracy_class: string;
        pan_shape: string | null;
        load_cell_type: string | null;
        family_id: number;
        family_name: string;
        project_id: number;
        task_no: string;
        report_no: string;
        standard_version: string;
        project_status: string;
        manufacturer_name: string;
        run_count: number;
      }>(
        `SELECT m.id, m.model_name, m.serial_no, m.max_capacity, m.min_capacity,
                m.e_value, m.d_value, m.n_intervals, m.accuracy_class, m.pan_shape,
                m.load_cell_type,
                f.id AS family_id, f.family_name, f.project_id,
                p.task_no, p.report_no, p.standard_version, p.status AS project_status,
                mfr.name AS manufacturer_name,
                (SELECT count(*) FROM test_run tr WHERE tr.model_id = m.id) AS run_count
           FROM instrument_model m
           JOIN instrument_family f ON f.id = m.family_id
           JOIN project p ON p.id = f.project_id
           JOIN manufacturer mfr ON mfr.id = p.manufacturer_id
          ${whereSql}
          ORDER BY m.id DESC
          LIMIT ?`,
        [...params, limit],
      );
      return { models: rows };
    },
    [],
  );

  router.get('/api/models/:id', async (ctx) => {    const model = await getModel(Number(ctx.params.id));
    const context = await get<{ project_id: number; family_name: string }>(
      `SELECT f.project_id, f.family_name FROM instrument_family f WHERE f.id = ?`,
      [model.family_id],
    );
      return { model: await serialiseModel(model), ...context };
  }, []);

  router.put(
    '/api/models/:id',
    async (ctx) => {
      const modelId = Number(ctx.params.id);
      const model = await getModel(modelId);
      const project = await get<{ project_id: number }>(
        'SELECT f.project_id FROM instrument_family f WHERE f.id = ?', [model.family_id],
      );
      if (!project) throw notFound(`Project for model ${modelId} not found`);
      await requireEditableProject(project.project_id, ctx);
      const fields = readModelFields(ctx.body);
      await run(
        `UPDATE instrument_model SET ${Object.keys(fields).map((c) => `${c} = ?`).join(', ')}
          WHERE id = ?`,
        [...Object.values(fields), modelId],
      );
      return { model: await serialiseModel(await getModel(modelId)) };
    },
    [],
  );

  router.put(
    '/api/models/:id/reference-weights',
    async (ctx) => {
      const modelId = Number(ctx.params.id);
      const model = await getModel(modelId);
      const project = await get<{ project_id: number }>(
        'SELECT f.project_id FROM instrument_family f WHERE f.id = ?', [model.family_id],
      );
      if (!project) throw notFound(`Project for model ${modelId} not found`);
      await requireEditableProject(project.project_id, ctx);
      const weights = readWeightList(ctx.body.referenceWeights);
      return await transaction(async () => {
        await replaceReferenceWeights(modelId, weights);
        return { model: await serialiseModel(await getModel(modelId)) };
      });
    },
    [],
  );

  /** Suggested weight set for a given Max/Min/e, used by the wizard before the model exists. */
  router.post(
    '/api/reference-weights/suggest',
    async (ctx) => {
      const max = num(ctx.body.max_capacity, 'max_capacity');
      const e = num(ctx.body.e_value, 'e_value');
      const min = num(ctx.body.min_capacity, 'min_capacity');
      return {
        n: computeN(max, e),
        referenceWeights: generateReferenceWeights({
          max,
          min,
          e,
          d: numOrNull(ctx.body.d_value) ?? e,
        }),
      };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Checklist
  // -------------------------------------------------------------------------

  router.get(
    '/api/projects/:id/checklist',
    async (ctx) => {
      const projectId = Number(ctx.params.id);

      // The rows query needs no project data — only the JS filter below uses the
      // standard version — so both reads run together.
      const [project, rows] = await Promise.all([
        requireProject(projectId),
        all<{
          id: number | null;
          item_id: number;
          clause_no: string;
          description: string;
          category: string | null;
          applicable_standards: string;
          sort_order: number;
          applicable: string | null;
          status: string | null;
          remarks: string | null;
          linked_test_run_id: number | null;
        }>(
          `SELECT r.id, ci.id AS item_id, ci.clause_no, ci.description, ci.category,
                  ci.applicable_standards, ci.sort_order,
                  r.applicable, r.status, r.remarks, r.linked_test_run_id
             FROM checklist_item ci
             LEFT JOIN project_checklist_result r
                    ON r.checklist_item_id = ci.id AND r.project_id = ?
            ORDER BY ci.sort_order`,
          [projectId],
        ),
      ]);

      const items = rows
        .filter((row) =>
          parseJson<string[]>(row.applicable_standards, []).includes(project.standard_version),
        )
        .map((row) => ({
          resultId: row.id,
          itemId: row.item_id,
          clauseNo: row.clause_no,
          description: row.description,
          category: row.category,
          applicable: row.applicable ?? 'existent',
          status: row.status ?? 'na',
          remarks: row.remarks,
          linkedTestRunId: row.linked_test_run_id,
        }));

      const answered = items.filter((i) => i.status !== 'na' || i.applicable === 'na').length;

      return {
        items,
        progress: { answered, total: items.length },
        failCount: items.filter((i) => i.status === 'fail').length,
      };
    },
    [],
  );

  router.put(
    '/api/projects/:id/checklist',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireEditableProject(projectId, ctx);

      const results = Array.isArray(ctx.body.results) ? ctx.body.results : [];
      if (results.length === 0) throw badRequest('results must be a non-empty array');

      return await transaction(async () => {
        for (const raw of results) {
          const entry = raw as Record<string, unknown>;
          const itemId = num(entry.itemId, 'itemId');
          const linkedRunId = numOrNull(entry.linkedTestRunId);
          if (linkedRunId !== null) {
            const runRow = await get<{ id: number }>(
              `SELECT tr.id FROM test_run tr
               JOIN instrument_model m ON tr.model_id = m.id
               JOIN instrument_family f ON m.family_id = f.id
               WHERE tr.id = ? AND f.project_id = ?`,
              [linkedRunId, projectId],
            );
            if (!runRow) {
              throw badRequest(`Linked test run ${linkedRunId} does not belong to project ${projectId}`);
            }
          }
          await run(
            `INSERT INTO project_checklist_result
               (project_id, checklist_item_id, applicable, status, remarks, linked_test_run_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(project_id, checklist_item_id) DO UPDATE SET
               applicable = excluded.applicable,
               status = excluded.status,
               remarks = excluded.remarks,
               linked_test_run_id = excluded.linked_test_run_id,
               updated_at = CURRENT_TIMESTAMP`,
            [
              projectId,
              itemId,
              oneOf(entry.applicable, ['existent', 'non_existent', 'na'] as const, 'applicable', 'existent'),
              oneOf(entry.status, ['pass', 'fail', 'na'] as const, 'status', 'na'),
              strOrNull(entry.remarks),
              linkedRunId,
            ],
          );
        }
        await touchProject(projectId);
        return { saved: results.length };
      });
    },
    [],
  );

}
