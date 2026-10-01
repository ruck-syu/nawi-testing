/**
 * Mobile photo-upload sessions ("Upload from Mobile").
 *
 * ADDITIVE module: nothing here changes existing upload, report, auth or
 * review flows. A session is a short-lived, opaque, single-test credential:
 *
 *  - created by an authenticated technician/admin from a desktop test sheet,
 *  - scoped to exactly one (project, model, test_run) triple,
 *  - usable from a phone with no login (the token IS the credential),
 *  - multi-photo (upload_count tracks each accepted photo),
 *  - expired after a TTL (default 60 min, max 24 h) or when revoked,
 *  - refused once the parent report is approved (read-only).
 *
 * The public mobile page only ever learns the test's display names, never
 * observations, verdicts, or other tests' data.
 */

import crypto from 'node:crypto';
import { get, run } from '../db/index.ts';
import { notFound } from '../http.ts';

export interface MobileUploadSessionRow {
  id: number;
  token: string;
  project_id: number;
  model_id: number | null;
  test_run_id: number;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  upload_count: number;
  last_upload_at: string | null;
  revoked_at: string | null;
}

export const MOBILE_UPLOAD_DEFAULT_TTL_MINUTES = 60;
export const MOBILE_UPLOAD_MAX_TTL_MINUTES = 24 * 60;

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function isSessionExpired(row: Pick<MobileUploadSessionRow, 'expires_at' | 'revoked_at'>): boolean {
  if (row.revoked_at) return true;
  return new Date(row.expires_at).getTime() <= Date.now();
}

/**
 * Verify that a test run belongs to a project (through model -> family), and
 * return the canonical triple to store on the session. Rejects runs from any
 * other project so a QR can never point at the wrong test.
 */
export async function resolveTestScope(
  projectId: number,
  testRunId: number,
): Promise<{ projectId: number; modelId: number; testRunId: number }> {
  const row = await get<{ id: number; model_id: number; project_id: number }>(
    `SELECT tr.id, tr.model_id, f.project_id
       FROM test_run tr
       JOIN instrument_model m ON m.id = tr.model_id
       JOIN instrument_family f ON f.id = m.family_id
      WHERE tr.id = ?`,
    [testRunId],
  );
  if (!row || row.project_id !== projectId) {
    throw notFound(`Test run ${testRunId} does not belong to project ${projectId}`);
  }
  return { projectId, modelId: row.model_id, testRunId: row.id };
}

export async function createMobileUploadSession(
  projectId: number,
  testRunId: number,
  createdBy: number | null,
  ttlMinutes?: number,
): Promise<MobileUploadSessionRow> {
  const scope = await resolveTestScope(projectId, testRunId);
  const ttl =
    ttlMinutes === undefined || ttlMinutes === null || Number.isNaN(Number(ttlMinutes))
      ? MOBILE_UPLOAD_DEFAULT_TTL_MINUTES
      : Math.min(Math.max(Number(ttlMinutes), 1), MOBILE_UPLOAD_MAX_TTL_MINUTES);
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const row = await get<MobileUploadSessionRow>(
    `INSERT INTO mobile_upload_session (token, project_id, model_id, test_run_id, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [newToken(), scope.projectId, scope.modelId, scope.testRunId, createdBy, expiresAt],
  );
  if (!row) throw notFound('Could not create the mobile upload session');
  return row;
}

export async function getMobileUploadSession(token: string): Promise<MobileUploadSessionRow | null> {
  if (!token || typeof token !== 'string') return null;
  return get<MobileUploadSessionRow>('SELECT * FROM mobile_upload_session WHERE token = ?', [token]);
}

export async function revokeMobileUploadSession(token: string, projectId?: number): Promise<boolean> {
  const params: unknown[] = [token];
  let sql = 'UPDATE mobile_upload_session SET revoked_at = CURRENT_TIMESTAMP WHERE token = ? AND revoked_at IS NULL';
  if (projectId !== undefined) {
    sql += ' AND project_id = ?';
    params.push(projectId);
  }
  const { changes } = await run(sql, params);
  return changes > 0;
}

export async function recordMobileUpload(token: string): Promise<void> {
  await run(
    `UPDATE mobile_upload_session
        SET upload_count = upload_count + 1, last_upload_at = CURRENT_TIMESTAMP
      WHERE token = ?`,
    [token],
  );
}
