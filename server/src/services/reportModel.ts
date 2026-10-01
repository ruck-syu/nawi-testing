/**
 * Report data model.
 *
 * `buildReportModel` gathers every database value the report renderers need into one
 * plain-JSON object with no HTML in it. The HTML renderer (`report.ts`) and the future
 * DOCX renderer both consume this model, so adding a format never re-fetches or
 * re-interprets the data — it only re-presents it.
 *
 * Every number still comes from `evaluateTestRun` / `modelSummary` / `projectRollup`
 * (see `evaluation.ts`): the model assembles, it never computes verdicts.
 */

import { all, get, parseJson } from '../db/index.ts';
import { notFound } from '../http.ts';
import {
  evaluateTestRun,
  modelSummary,
  projectRollup,
  type AttachmentRow,
  type EvaluatedRun,
  type ModelRow,
  type ProjectRollup,
  type SummaryEntry,
} from './evaluation.ts';

export interface ReportProject {
  id: number;
  task_no: string;
  report_no: string;
  danak_no: string | null;
  standard_version: string;
  examination_start_date: string | null;
  examination_end_date: string | null;
  status: string;
}

/** One checklist row after filtering to the project's standard version. */
export interface ChecklistModelRow {
  clause_no: string;
  description: string;
  category: string | null;
  applicable: string | null;
  status: string | null;
  remarks: string | null;
}

/** Latest signature for the project, if the report has been signed. */
export interface SignatureModel {
  signed_by_name: string;
  signed_by_title: string | null;
  signed_at: string;
  /** File name of the signatory's uploaded signature image, if they hold one. */
  signature_image_path: string | null;
  /** Linked user account, when the signature was recorded with one. */
  signed_by_user_id: number | null;
}

/** Everything the renderers need for one model's section set. */
export interface ModelSection {
  model: ModelRow;
  familyName: string | null;
  referenceWeights: number[];
  summary: SummaryEntry[];
  runs: EvaluatedRun[];
  modelPhotos: AttachmentRow[];
}

export interface ReportModel {
  project: ReportProject;
  manufacturer: Record<string, unknown>;
  generatedAt: string;
  generatedBy: string;
  rollup: ProjectRollup;
  checklist: ChecklistModelRow[];
  models: ModelSection[];
  signature: SignatureModel | null;
  verification?: ReportVerification;
}

/** Verification block for a generated report, if verification was issued. */
export interface ReportVerification {
  token: string;
  qrDataUrl: string;
  qrBuffer: Buffer;
  integrityHash: string;
  verifyUrl: string;
}

export interface BuildOptions {
  /** Override the generation timestamp (snapshot tests use a fixed value). */
  generatedAt?: string;
  generatedBy?: string;
}

/**
 * Load the full report dataset for a project.
 *
 * The fetch order and queries mirror what `renderProjectReport` used to do inline,
 * so moving a query here cannot change rendered output — only where the await sits.
 */
export async function buildReportModel(
  projectId: number,
  options: BuildOptions = {},
): Promise<ReportModel> {
  // Project, manufacturer, checklist rows and signature are independent reads
  // keyed by project id — one round trip instead of four sequential ones. The
  // checklist filter needs the standard version but runs in JS below, so it
  // does not block on the project row.
  const [project, manufacturer, loadedChecklist, signature] = await Promise.all([
    get<ReportProject>('SELECT * FROM project WHERE id = ?', [projectId]),
    get<Record<string, unknown>>(
      'SELECT * FROM manufacturer WHERE id = (SELECT manufacturer_id FROM project WHERE id = ?)',
      [projectId],
    ),
    all<ChecklistModelRow & { applicable_standards: string }>(
      `SELECT ci.clause_no, ci.description, ci.category, ci.applicable_standards,
              r.applicable, r.status, r.remarks
         FROM checklist_item ci
         LEFT JOIN project_checklist_result r
                ON r.checklist_item_id = ci.id AND r.project_id = ?
        ORDER BY ci.sort_order`,
      [projectId],
    ),
    get<SignatureModel>('SELECT * FROM signature WHERE project_id = ? ORDER BY id DESC LIMIT 1', [
      projectId,
    ]),
  ]);
  if (!project) throw notFound(`Project ${projectId} not found`);

  const rollup = await projectRollup(projectId, { standardVersion: project.standard_version });

  const models = await Promise.all(
    rollup.models.map(async (entry): Promise<ModelSection> => {
      const model = entry.model;
      const [runRows, modelPhotos, summary, family, weights] = await Promise.all([
        all<{ id: number }>(
          `SELECT tr.id FROM test_run tr
             JOIN test_type tt ON tt.code = tr.test_type_code
            WHERE tr.model_id = ?
            ORDER BY tt.sort_order`,
          [model.id],
        ),
        all<AttachmentRow>(
          'SELECT * FROM attachment WHERE model_id = ? AND test_run_id IS NULL ORDER BY uploaded_at',
          [model.id],
        ),
        modelSummary(model.id, project.standard_version),
        get<{ family_name: string }>('SELECT family_name FROM instrument_family WHERE id = ?', [
          model.family_id,
        ]),
        all<{ nominal_load_value: number }>(
          'SELECT nominal_load_value FROM reference_weight WHERE model_id = ? ORDER BY sequence_order',
          [model.id],
        ),
      ]);

      const runs: EvaluatedRun[] = await Promise.all(runRows.map((r) => evaluateTestRun(r.id)));

      return {
        model,
        familyName: family?.family_name ?? null,
        referenceWeights: weights.map((w) => w.nominal_load_value),
        summary,
        runs,
        modelPhotos,
      };
    }),
  );

  const checklist: ChecklistModelRow[] = loadedChecklist
    .filter((r) => parseJson<string[]>(r.applicable_standards, []).includes(project.standard_version))
    .map(({ applicable_standards: _ignored, ...row }) => row);

  // The printed name and image always come from the linked user row when there
  // is one, so renames and re-uploads show up without re-signing. Unlinked
  // historical rows fall back to a name match, then to recorded values.
  if (signature) {
    const linked = signature.signed_by_user_id
      ? await get<{ name: string; signature_path: string | null }>(
          'SELECT name, signature_path FROM "user" WHERE id = ?',
          [signature.signed_by_user_id],
        )
      : null;
    const holder = linked ??
      (await get<{ name: string; signature_path: string | null }>(
        'SELECT name, signature_path FROM "user" WHERE name = ?',
        [signature.signed_by_name],
      ));
    if (holder) {
      signature.signed_by_name = holder.name;
      if (holder.signature_path) signature.signature_image_path = holder.signature_path;
    }
  }

  return {
    project,
    manufacturer: manufacturer ?? {},
    generatedAt: options.generatedAt ?? new Date().toISOString().replace('T', ' ').slice(0, 19),
    generatedBy: options.generatedBy ?? 'the R76 report system',
    rollup,
    checklist,
    models,
    signature,
  };
}
