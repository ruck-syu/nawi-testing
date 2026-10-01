/**
 * Mobile photo-upload routes ("Upload from Mobile").
 *
 * ADDITIVE routes: no existing route is modified. Desktop upload
 * (`POST /api/projects/:id/attachments`) is untouched; these endpoints add a
 * second, QR-driven path that stores photos through the exact same
 * `attachment` rows and `uploads/` files.
 *
 *  - Authenticated (desktop): create / list / revoke sessions for one test run.
 *  - Public (phone, no login): read minimal session info + post one photo per
 *    request. The token is scoped to a single test run, expires, and is
 *    refused once the parent report is approved.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run } from '../db/index.ts';
import { config } from '../config.ts';
import {
  badRequest,
  notFound,
  forbidden,
  numOrNull,
  strOrNull,
  type Router,
} from '../http.ts';
import { requireEditableProject } from '../services/review.ts';
import {
  createMobileUploadSession,
  getMobileUploadSession,
  isSessionExpired,
  recordMobileUpload,
  resolveTestScope,
  revokeMobileUploadSession,
  type MobileUploadSessionRow,
} from '../services/mobileUpload.ts';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function serialiseSession(row: MobileUploadSessionRow) {
  return {
    token: row.token,
    projectId: row.project_id,
    modelId: row.model_id,
    testRunId: row.test_run_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    uploadCount: row.upload_count,
    lastUploadAt: row.last_upload_at,
    revokedAt: row.revoked_at,
    expired: isSessionExpired(row),
  };
}

export function registerMobileUploadRoutes(router: Router): void {
  // -- Desktop (authenticated): mint a QR session for one test run ----------
  router.post(
    '/api/projects/:id/mobile-upload-sessions',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireEditableProject(projectId, ctx);
      const testRunId = numOrNull(ctx.body.test_run_id ?? ctx.body.testRunId);
      if (!testRunId) throw badRequest('test_run_id is required');
      // Scope check: the run must belong to this project, otherwise a QR for
      // test A could be minted (or guessed) against project B.
      await resolveTestScope(projectId, testRunId);
      const ttlMinutes = numOrNull(ctx.body.ttl_minutes ?? ctx.body.ttlMinutes) ?? undefined;
      const session = await createMobileUploadSession(
        projectId,
        testRunId,
        ctx.user?.sub ?? null,
        ttlMinutes ?? undefined,
      );
      return { session: serialiseSession(session), mobilePath: `/m/${session.token}` };
    },
    [],
  );

  // -- Desktop (authenticated): session status for polling ------------------
  router.get(
    '/api/projects/:id/mobile-upload-sessions',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      const runId = ctx.query.get('testRunId');
      let sql = 'SELECT * FROM mobile_upload_session WHERE project_id = ?';
      const params: unknown[] = [projectId];
      if (runId) {
        sql += ' AND test_run_id = ?';
        params.push(Number(runId));
      }
      sql += ' ORDER BY created_at DESC LIMIT 20';
      const rows = await all<MobileUploadSessionRow>(sql, params);
      return { sessions: rows.map(serialiseSession) };
    },
    [],
  );

  // -- Desktop (authenticated): revoke a session -----------------------------
  router.post(
    '/api/projects/:id/mobile-upload-sessions/:token/revoke',
    async (ctx) => {
      const projectId = Number(ctx.params.id);
      await requireEditableProject(projectId, ctx);
      const revoked = await revokeMobileUploadSession(String(ctx.params.token ?? ''), projectId);
      if (!revoked) throw notFound('Mobile upload session not found or already closed');
      return { revoked: true };
    },
    [],
  );

  // -- Phone (public, no login): minimal session info ------------------------
  // Deliberately narrow: display names + expiry only. No observations,
  // verdicts, remarks, attachments of other tests, or contact details.
  router.get(
    '/api/public/mobile/:token',
    async (ctx) => {
      const session = await getMobileUploadSession(String(ctx.params.token ?? ''));
      if (!session || isSessionExpired(session)) {
        throw notFound('This mobile upload link is invalid, expired, or has been closed.');
      }
      const [model, testType, project] = await Promise.all([
        get<{ model_name: string }>('SELECT model_name FROM instrument_model WHERE id = ?', [
          session.model_id,
        ]),
        get<{ display_name: string; report_sheet_ref: string | null }>(
          `SELECT tt.display_name, tt.report_sheet_ref FROM test_run tr
             JOIN test_type tt ON tt.code = tr.test_type_code WHERE tr.id = ?`,
          [session.test_run_id],
        ),
        get<{ task_no: string; report_no: string; status: string }>(
          'SELECT task_no, report_no, status FROM project WHERE id = ?',
          [session.project_id],
        ),
      ]);
      if (!project) throw notFound('This mobile upload link is invalid, expired, or has been closed.');
      ctx.res.setHeader('Cache-Control', 'no-store');
      return {
        taskNo: project.task_no,
        reportNo: project.report_no,
        modelName: model?.model_name ?? 'Instrument',
        testName: testType?.display_name ?? 'Test',
        reportSheetRef: testType?.report_sheet_ref ?? null,
        expiresAt: session.expires_at,
        uploadCount: session.upload_count,
        projectLocked: project.status === 'approved',
      };
    },
    null,
  );

  // -- Phone (public, no login): upload one photo into the scoped test run ---
  router.post(
    '/api/public/mobile/:token/photo',
    async (ctx) => {
      const session = await getMobileUploadSession(String(ctx.params.token ?? ''));
      if (!session || isSessionExpired(session)) {
        throw notFound('This mobile upload link is invalid, expired, or has been closed.');
      }
      const project = await get<{ id: number; status: string }>(
        'SELECT id, status FROM project WHERE id = ?',
        [session.project_id],
      );
      if (!project) throw notFound('This mobile upload link is invalid, expired, or has been closed.');
      if (project.status === 'approved') {
        throw forbidden('This report has been approved and no longer accepts photos.');
      }
      if (ctx.files.length === 0) throw badRequest('No photo uploaded');
      const file = ctx.files[0]!;
      if (!IMAGE_TYPES.has(file.mimeType)) {
        throw badRequest(
          `Unsupported file type ${file.mimeType}. Accepted: ${[...IMAGE_TYPES].join(', ')}`,
        );
      }

      fs.mkdirSync(config.uploadsDir, { recursive: true });
      // Stored under a generated name: the uploaded filename is untrusted input.
      const name = `${crypto.randomUUID()}${EXTENSIONS[file.mimeType] ?? ''}`;
      fs.writeFileSync(path.join(config.uploadsDir, name), file.data);

      const { lastInsertRowid } = await run(
        `INSERT INTO attachment
           (project_id, model_id, test_run_id, file_path, original_name, mime_type, caption, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.project_id,
          session.model_id,
          session.test_run_id,
          name,
          file.originalName,
          file.mimeType,
          strOrNull(ctx.body.caption) ?? 'Mobile upload',
          'mobile',
        ],
      );
      await recordMobileUpload(session.token);
      const attachment = await get('SELECT * FROM attachment WHERE id = ?', [lastInsertRowid]);
      return {
        attachment: attachment
          ? { ...attachment, url: `/uploads/${(attachment as { file_path: string }).file_path}` }
          : null,
      };
    },
    null,
  );
}
