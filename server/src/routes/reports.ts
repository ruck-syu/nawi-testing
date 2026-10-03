/**
 * Report generation, report repository and attachment routes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { all, get, run } from '../db/index.ts';
import { config } from '../config.ts';
import { badRequest, notFound, num, numOrNull, oneOf, strOrNull, type Router } from '../http.ts';
import {
  generateReport,
  listReports,
  renderProjectReport,
} from '../services/report.ts';
import { requireEditableProject } from '../services/review.ts';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * The origin this request arrived on (proxy-aware). undefined when no host
 * header is present — callers fall back to SITE_URL in that case.
 */
function requestBaseUrl(req: IncomingMessage): string | undefined {
  const first = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  const host = first(req.headers['x-forwarded-host'] ?? req.headers.host).split(',')[0]!.trim();
  if (!host) return undefined;
  const proto = first(req.headers['x-forwarded-proto']).split(',')[0]!.trim() ||
    ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

export function registerReportRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  router.post(
    '/api/projects/:id/reports',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      const format = oneOf(ctx.body.format, ['html', 'pdf', 'docx', 'xlsx'] as const, 'format', 'html');
      const { report, pdfFallback } = await generateReport(projectId, {
        format,
        generatedBy: ctx.user?.name ?? undefined,
        baseUrl: requestBaseUrl(ctx.req),
      });
      return {
        report,
        pdfFallback,
      };
    },
    [],
  );

  /** Live preview: renders on demand without writing a history row. */
  router.get(
    '/api/projects/:id/reports/preview',
    async (ctx) => {
      const html = await renderProjectReport(Number(ctx.params.id), {
        interactive: true,
        generatedBy: ctx.user?.name ?? undefined,
      });
      ctx.res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      ctx.res.end(html);
    },
    [],
  );

  router.get(
    '/api/projects/:id/reports',
    async (ctx) => ({ reports: await listReports(Number(ctx.params.id)) }),
    [],
  );

  /** The cross-project report repository. */
  router.get(
    '/api/reports',
    async (ctx) => {
      const search = (ctx.query.get('search') ?? '').trim().toLowerCase();
      const verdict = ctx.query.get('verdict');

      const rows = await all<{
        id: number;
        project_id: number;
        report_no: string | null;
        format: string;
        file_path: string;
        generated_by: string | null;
        generated_at: string;
        overall_verdict: string | null;
        test_count: number | null;
        pass_count: number | null;
        fail_count: number | null;
        task_no: string;
        manufacturer_name: string;
      }>(
        `SELECT gr.*, p.task_no, m.name AS manufacturer_name
           FROM generated_report gr
           JOIN project p ON p.id = gr.project_id
           JOIN manufacturer m ON m.id = p.manufacturer_id
          ORDER BY gr.generated_at DESC, gr.id DESC`,
      );

      return {
        reports: rows
          .filter((r) => !verdict || r.overall_verdict === verdict)
          .filter((r) =>
            !search ||
            [r.report_no, r.task_no, r.manufacturer_name, r.generated_by]
              .filter(Boolean)
              .some((f) => String(f).toLowerCase().includes(search)),
          )
          .map((r) => ({ ...r, url: `/reports/${r.file_path}` })),
      };
    },
    [],
  );

  router.delete(
    '/api/reports/:id',
    async (ctx) => {
      const id = Number(ctx.params.id);
      const report = await get<{ file_path: string }>(
        'SELECT file_path FROM generated_report WHERE id = ?',
        [id],
      );
      if (!report) throw notFound(`Report ${id} not found`);
      // The row goes; the file is left on disk deliberately, so a report that may have
      // been circulated stays recoverable from the reports directory.
      await run('DELETE FROM generated_report WHERE id = ?', [id]);
      return { deleted: id };
    },
    ['admin'],
  );

  // -------------------------------------------------------------------------
  // Public verification
  // -------------------------------------------------------------------------

  /**
   * Unauthenticated verification lookup: the unguessable verification token in
   * the path is the credential, same pattern as `/api/public/share/:token`.
   * Unknown tokens return `{ valid: false }` rather than 404 so scanners get a
   * plain verdict instead of an error page.
   */
  router.get(
    '/api/public/verify/:token',
    async (ctx) => {
      const row = await get<{
        report_no: string | null;
        overall_verdict: string | null;
        test_count: number | null;
        pass_count: number | null;
        fail_count: number | null;
        generated_at: string;
        integrity_hash: string | null;
        project_id: number;
        task_no: string;
        standard_version: string;
        approved_at: string | null;
        manufacturer_name: string;
        approved_by_name: string | null;
      }>(
        `SELECT gr.report_no, gr.overall_verdict, gr.test_count, gr.pass_count,
                gr.fail_count, gr.generated_at, gr.integrity_hash,
                p.id AS project_id, p.task_no, p.standard_version, p.approved_at,
                m.name AS manufacturer_name, u.name AS approved_by_name
           FROM generated_report gr
           JOIN project p ON p.id = gr.project_id
           JOIN manufacturer m ON m.id = p.manufacturer_id
           LEFT JOIN "user" u ON u.id = p.approved_by
          WHERE gr.verification_token = ?`,
        [String(ctx.params.token ?? '')],
      );
      if (!row) return { valid: false };

      const instrument = await get<{
        model_name: string;
        max_capacity: number;
        accuracy_class: string;
      }>(
        `SELECT im.model_name, im.max_capacity, im.accuracy_class
           FROM instrument_model im
           JOIN instrument_family f ON f.id = im.family_id
          WHERE f.project_id = ?
          ORDER BY im.id
          LIMIT 1`,
        [row.project_id],
      );

      const testCount = row.test_count ?? 0;
      const passCount = row.pass_count ?? 0;
      const failCount = row.fail_count ?? 0;

      ctx.res.setHeader('Cache-Control', 'no-store');

      return {
        valid: true,
        reportNo: row.report_no,
        taskNo: row.task_no,
        standardVersion: row.standard_version,
        manufacturer: row.manufacturer_name,
        instrument: instrument
          ? `${instrument.model_name} · Max ${instrument.max_capacity} · Class ${instrument.accuracy_class}`
          : null,
        overallVerdict: row.overall_verdict,
        testCount,
        passCount,
        failCount,
        incompleteCount: testCount - passCount - failCount,
        approvedBy: row.approved_by_name,
        approvedAt: row.approved_at,
        generatedAt: row.generated_at,
        integrityHash: row.integrity_hash,
      };
    },
    null,
  );

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  router.post(
    '/api/projects/:id/attachments',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireEditableProject(projectId, ctx);
      if (ctx.files.length === 0) throw badRequest('No file uploaded');

      fs.mkdirSync(config.uploadsDir, { recursive: true });
      const saved = [];

      for (const file of ctx.files) {
        if (!IMAGE_TYPES.has(file.mimeType)) {
          throw badRequest(
            `Unsupported file type ${file.mimeType}. Accepted: ${[...IMAGE_TYPES].join(', ')}`,
          );
        }
        // Stored under a generated name: the uploaded filename is untrusted input, and
        // using it directly would put path traversal into a filesystem write.
        const name = `${crypto.randomUUID()}${EXTENSIONS[file.mimeType] ?? ''}`;
        fs.writeFileSync(path.join(config.uploadsDir, name), file.data);

        const { lastInsertRowid } = await run(
          `INSERT INTO attachment
             (project_id, model_id, test_run_id, file_path, original_name, mime_type, caption, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            numOrNull(ctx.body.model_id),
            numOrNull(ctx.body.test_run_id),
            name,
            file.originalName,
            file.mimeType,
            strOrNull(ctx.body.caption),
            ctx.user?.name ?? null,
          ],
        );
        saved.push(await get('SELECT * FROM attachment WHERE id = ?', [lastInsertRowid]));
      }

      return { attachments: saved };
    },
    [],
  );

  router.get(
    '/api/projects/:id/attachments',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      const modelId = ctx.query.get('modelId');
      const runId = ctx.query.get('testRunId');

      let sql = 'SELECT * FROM attachment WHERE project_id = ?';
      const params: unknown[] = [projectId];
      if (modelId) {
        sql += ' AND model_id = ?';
        params.push(Number(modelId));
      }
      if (runId) {
        sql += ' AND test_run_id = ?';
        params.push(Number(runId));
      }
      sql += ' ORDER BY uploaded_at';

      const rows = await all<{ file_path: string }>(sql, params);
      return {
        attachments: rows.map((a) => ({
          ...a,
          url: `/uploads/${a.file_path}`,
        })),
      };
    },
    [],
  );

  router.patch(
    '/api/attachments/:id',
    async (ctx) => {
      const id = num(ctx.params.id, 'id');
      const attachment = await get<{ project_id: number }>('SELECT project_id FROM attachment WHERE id = ?', [id]);
      if (!attachment) throw notFound(`Attachment ${id} not found`);
      await requireEditableProject(attachment.project_id, ctx);
      const { changes } = await run('UPDATE attachment SET caption = ? WHERE id = ?', [
        strOrNull(ctx.body.caption),
        id,
      ]);
      if (changes === 0) throw notFound(`Attachment ${id} not found`);
      return { attachment: await get('SELECT * FROM attachment WHERE id = ?', [id]) };
    },
    [],
  );

  router.delete(
    '/api/attachments/:id',
    async (ctx) => {
      const id = Number(ctx.params.id);
      const attachment = await get<{ file_path: string; project_id: number }>(
        'SELECT file_path FROM attachment WHERE id = ?',
        [id],
      );
      if (!attachment) throw notFound(`Attachment ${id} not found`);
      await requireEditableProject(attachment.project_id, ctx);
      await run('DELETE FROM attachment WHERE id = ?', [id]);
      try {
        fs.rmSync(path.join(config.uploadsDir, attachment.file_path), { force: true });
      } catch {
        /* the row is gone either way; a stale file is not worth failing the request */
      }
      return { deleted: id };
    },
    [],
  );
}
