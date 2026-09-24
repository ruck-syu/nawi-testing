import crypto from 'node:crypto';
import { get, run, transaction } from '../db/index.ts';
import { notFound } from '../http.ts';

export interface ShareRow {
  id: number;
  project_id: number;
  token: string;
  created_by: number | null;
  created_at: string;
  revoked_at: string | null;
}

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

async function requireProjectExists(projectId: number): Promise<void> {
  const row = await get<{ id: number }>('SELECT id FROM project WHERE id = ?', [projectId]);
  if (!row) throw notFound(`Project ${projectId} not found`);
}

/** Active (unrevoked) share link for a project, if any. */
export async function getActiveShare(projectId: number): Promise<ShareRow | null> {
  return get<ShareRow>(
    'SELECT * FROM project_share WHERE project_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
    [projectId],
  );
}

/**
 * Create (or rotate) the single active share link for a project.
 * Revokes any existing active row first; the partial unique index
 * `idx_share_project_active` guards against concurrent creates.
 */
export async function createShare(projectId: number, createdBy: number | null): Promise<ShareRow> {
  return transaction(async () => {
    await requireProjectExists(projectId);
    await run('UPDATE project_share SET revoked_at = CURRENT_TIMESTAMP WHERE project_id = ? AND revoked_at IS NULL', [
      projectId,
    ]);
    const row = await get<ShareRow>(
      'INSERT INTO project_share (project_id, token, created_by) VALUES (?, ?, ?) RETURNING *',
      [projectId, newToken(), createdBy],
    );
    if (!row) throw notFound(`Share link for project ${projectId} not found`);
    return row;
  });
}

/** Revoke the active share link. Returns true when a row was revoked. */
export async function revokeShare(projectId: number): Promise<boolean> {
  await requireProjectExists(projectId);
  const { changes } = await run(
    'UPDATE project_share SET revoked_at = CURRENT_TIMESTAMP WHERE project_id = ? AND revoked_at IS NULL',
    [projectId],
  );
  return changes > 0;
}

/** Resolve a public token to its active share row, or null when unknown/revoked. */
export async function resolveShareToken(token: string): Promise<ShareRow | null> {
  if (!token || typeof token !== 'string') return null;
  return get<ShareRow>('SELECT * FROM project_share WHERE token = ? AND revoked_at IS NULL', [token]);
}
