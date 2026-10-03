/**
 * Profile and user-administration routes.
 *
 * Any signed-in user may read and edit their own profile (name, signature image).
 * Role and active-status changes are admin-only and never self-service: admins edit
 * anyone except themselves through the admin endpoints, so nobody can escalate
 * their own role or lock themselves out by deactivating their own account.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run } from '../db/index.ts';
import { config } from '../config.ts';
import { hashPassword } from '../auth.ts';
import {
  badRequest,
  emailOrNull,
  forbidden,
  notFound,
  num,
  oneOf,
  str,
  type Router,
} from '../http.ts';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  signature_path: string | null;
  signature_image: string | null;
  is_active: boolean;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    has_signature: row.signature_path !== null,
    signature_url: row.signature_path ? `/uploads/${row.signature_path}` : null,
  };
}

async function requireUser(id: number): Promise<UserRow> {
  const user = await get<UserRow>('SELECT * FROM "user" WHERE id = ?', [id]);
  if (!user) throw notFound(`User ${id} not found`);
  return user;
}

export function registerUserRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // Own profile
  // -------------------------------------------------------------------------

  router.get('/api/users/me', async (ctx) => ({ user: publicUser(await requireUser(ctx.user!.sub)) }), []);

  router.patch('/api/users/me', async (ctx) => {
    const name = str(ctx.body.name, 'name').trim();
    if (!name) throw badRequest('Name must not be empty');
    await run('UPDATE "user" SET name = ? WHERE id = ?', [name, ctx.user!.sub]);
    return { user: publicUser(await requireUser(ctx.user!.sub)) };
  }, []);

  /** Standing signature image (PNG). Admins only: signatures sign reports. */
  router.post('/api/users/me/signature', async (ctx) => {
    if (ctx.user!.role !== 'admin') {
      throw forbidden('Signature upload is limited to administrators.');
    }
    const file = ctx.files[0];
    if (!file) throw badRequest('No file uploaded');
    if (file.mimeType !== 'image/png' && file.mimeType !== 'image/x-png') {
      throw badRequest(`Unsupported file type ${file.mimeType}. Signature must be a PNG.`);
    }
    if (file.data.length > 2 * 1024 * 1024) {
      throw badRequest('Signature image must be smaller than 2 MB.');
    }

    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const name = `sig-${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(config.uploadsDir, name), file.data);
    // Database copy (source of truth): the uploads directory is ephemeral on
    // hosted installs, so the image must survive without the file.
    const dataUrl = `data:image/png;base64,${file.data.toString('base64')}`;

    const previous = await requireUser(ctx.user!.sub);
    await run('UPDATE "user" SET signature_path = ?, signature_image = ? WHERE id = ?', [name, dataUrl, ctx.user!.sub]);
    if (previous.signature_path) {
      try {
        // basename: the stored value should always be a bare file name, but a
        // legacy row must never turn this into a path traversal.
        fs.rmSync(path.join(config.uploadsDir, path.basename(previous.signature_path)), { force: true });
      } catch {
        /* the row is updated either way; a stale file is not worth failing the request */
      }
    }
    return { user: publicUser(await requireUser(ctx.user!.sub)) };
  }, []);

  /**
   * The signature image itself, from the database copy (with a disk fallback
   * that backfills the database on first use). The profile page displays this,
   * so a wiped uploads directory never reads as a removed signature.
   */
  router.get('/api/users/me/signature', async (ctx) => {
    const me = await requireUser(ctx.user!.sub);
    if (me.signature_image) return { image: me.signature_image };
    if (me.signature_path) {
      const absolute = path.join(config.uploadsDir, path.basename(me.signature_path));
      try {
        const data = fs.readFileSync(absolute);
        if (data.length > 0 && data.length <= 2 * 1024 * 1024) {
          const dataUrl = `data:image/png;base64,${data.toString('base64')}`;
          await run('UPDATE "user" SET signature_image = ? WHERE id = ?', [dataUrl, me.id]);
          return { image: dataUrl };
        }
      } catch {
        /* fall through to null */
      }
    }
    return { image: null };
  }, []);

  router.delete('/api/users/me/signature', async (ctx) => {
    const me = await requireUser(ctx.user!.sub);
    if (me.signature_path) {
      try {
        fs.rmSync(path.join(config.uploadsDir, path.basename(me.signature_path)), { force: true });
      } catch {
        /* ignored: the row is cleared either way */
      }
      await run('UPDATE "user" SET signature_path = NULL, signature_image = NULL WHERE id = ?', [ctx.user!.sub]);
    } else if (me.signature_image) {
      await run('UPDATE "user" SET signature_image = NULL WHERE id = ?', [ctx.user!.sub]);
    }
    return { user: publicUser(await requireUser(ctx.user!.sub)) };
  }, []);

  // -------------------------------------------------------------------------
  // Administration (admin role only)
  // -------------------------------------------------------------------------

  router.get('/api/users', async () => {
    const rows = await all<UserRow>('SELECT * FROM "user" ORDER BY name');
    return { users: rows.map(publicUser) };
  }, ['admin']);

  /** Create an account. New users start active; they set no password themselves. */
  router.post('/api/users', async (ctx) => {
    const name = str(ctx.body.name, 'name').trim();
    if (!name) throw badRequest('Name must not be empty');
    const email = emailOrNull(ctx.body.email, 'email');
    if (!email) throw badRequest('A valid email address is required');
    const password = str(ctx.body.password, 'password');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    const role = oneOf(ctx.body.role ?? 'technician', ['admin', 'technician'] as const, 'role');
    if (await get('SELECT id FROM "user" WHERE lower(email) = ?', [email])) {
      throw badRequest(`An account for ${email} already exists`);
    }
    const { lastInsertRowid } = await run(
      'INSERT INTO "user" (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, hashPassword(password), role],
    );
    return { user: publicUser(await requireUser(lastInsertRowid)) };
  }, ['admin']);

  router.patch('/api/users/:id', async (ctx) => {
    const id = num(ctx.params.id, 'id');
    if (id === ctx.user!.sub) {
      // Roles and active flags are never self-service: this blocks both
      // privilege escalation and self-lockout in one check.
      throw forbidden('Use your profile page to edit your own details.');
    }
    await requireUser(id);

    const updates: string[] = [];
    const params: unknown[] = [];
    if (ctx.body.name !== undefined) {
      const name = str(ctx.body.name, 'name').trim();
      if (!name) throw badRequest('Name must not be empty');
      updates.push('name = ?');
      params.push(name);
    }
    if (ctx.body.role !== undefined) {
      updates.push('role = ?');
      params.push(oneOf(ctx.body.role, ['admin', 'technician'] as const, 'role'));
    }
    if (ctx.body.is_active !== undefined) {
      if (typeof ctx.body.is_active !== 'boolean') throw badRequest('is_active must be true or false');
      updates.push('is_active = ?');
      params.push(ctx.body.is_active);
    }
    if (updates.length === 0) throw badRequest('Nothing to update');

    params.push(id);
    await run(`UPDATE "user" SET ${updates.join(', ')} WHERE id = ?`, params);
    return { user: publicUser(await requireUser(id)) };
  }, ['admin']);
}
