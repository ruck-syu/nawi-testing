/**
 * Public manufacturer status API.
 *
 * No login required: the unguessable share token in the path is the credential.
 * The response is an allow-listed projection — status, dates, verdict counts and
 * per-test verdicts only. Never observations, remarks, checklist rows, report
 * files, attachments, or manufacturer contact details.
 */

import { get } from '../db/index.ts';
import { notFound, type Router } from '../http.ts';
import { projectRollup } from '../services/evaluation.ts';
import { resolveShareToken } from '../services/share.ts';

export function registerShareRoutes(router: Router): void {
  router.get(
    '/api/public/share/:token',
    async (ctx) => {
      const share = await resolveShareToken(String(ctx.params.token ?? ''));
      if (!share) throw notFound('This tracking link is invalid or has been revoked.');

      const project = await get<{
        id: number;
        task_no: string;
        report_no: string;
        danak_no: string | null;
        standard_version: string;
        examination_start_date: string | null;
        examination_end_date: string | null;
        status: string;
        manufacturer_id: number;
        reviewed_at: string | null;
        approved_at: string | null;
        updated_at: string;
      }>(
        `SELECT id, task_no, report_no, danak_no, standard_version,
                examination_start_date, examination_end_date, status,
                manufacturer_id, reviewed_at, approved_at, updated_at
           FROM project WHERE id = ?`,
        [share.project_id],
      );
      if (!project) throw notFound('This tracking link is invalid or has been revoked.');

      const [manufacturer, rollup, signature] = await Promise.all([
        get<{ name: string }>('SELECT name FROM manufacturer WHERE id = ?', [project.manufacturer_id]),
        projectRollup(project.id, { standardVersion: project.standard_version }),
        get<{ signed_by_name: string; signed_by_title: string | null; signed_at: string }>(
          'SELECT signed_by_name, signed_by_title, signed_at FROM signature WHERE project_id = ? ORDER BY id DESC LIMIT 1',
          [project.id],
        ),
      ]);

      ctx.res.setHeader('Cache-Control', 'no-store');

      return {
        manufacturerName: manufacturer?.name ?? '—',
        taskNo: project.task_no,
        reportNo: project.report_no,
        danakNo: project.danak_no,
        standardVersion: project.standard_version,
        status: project.status,
        examinationStartDate: project.examination_start_date,
        examinationEndDate: project.examination_end_date,
        reviewedAt: project.reviewed_at,
        approvedAt: project.approved_at,
        updatedAt: project.updated_at,
        // Progress only, deliberately coarse: how many sheets are done out of
        // the total. No pass/fail split, no per-model or per-test outcomes —
        // those are the content of the official report issued by the ministry.
        completedSheets: rollup.testCount - rollup.incompleteCount,
        totalSheets: rollup.testCount,
        signature: signature
          ? {
              signedByName: signature.signed_by_name,
              signedByTitle: signature.signed_by_title,
              signedAt: signature.signed_at,
            }
          : null,
      };
    },
    null,
  );
}
