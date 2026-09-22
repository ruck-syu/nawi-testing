/**
 * A small HTTP router over `node:http`.
 *
 * This covers the slice of Express the app actually uses — path params, JSON bodies,
 * multipart uploads, static files, CORS, auth guards, and consistent error shapes —
 * in a form that runs with no installed packages. Handlers receive a plain context
 * object, so moving to Express later means rewriting this file only.
 */

import http from 'node:http';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { verifyToken, type TokenPayload } from './auth.ts';

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  pathname: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body, or `{}` for requests without one. */
  body: Record<string, unknown>;
  /** Populated for multipart requests. */
  files: UploadedFile[];
  /** Set when a valid bearer token was presented. */
  user: TokenPayload | null;
}

export interface UploadedFile {
  fieldName: string;
  originalName: string;
  mimeType: string;
  data: Buffer;
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

/** Thrown by handlers to produce a specific HTTP status. */
export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, message);
export const forbidden = (message = 'Not permitted') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  /** Roles allowed to call this route. Empty means any authenticated user. */
  roles: string[] | null;
}

export class Router {
  private routes: Route[] = [];

  /**
   * Register a route. `pattern` uses `:name` for path params.
   * `roles: null` (the default) leaves the route public; `[]` requires any logged-in
   * user; a non-empty array requires one of those roles.
   */
  add(method: string, pattern: string, handler: Handler, roles: string[] | null = null): this {
    this.routes.push({
      method,
      segments: pattern.split('/').filter(Boolean),
      handler,
      roles,
    });
    return this;
  }

  get(p: string, h: Handler, roles?: string[] | null) { return this.add('GET', p, h, roles ?? null); }
  post(p: string, h: Handler, roles?: string[] | null) { return this.add('POST', p, h, roles ?? null); }
  put(p: string, h: Handler, roles?: string[] | null) { return this.add('PUT', p, h, roles ?? null); }
  patch(p: string, h: Handler, roles?: string[] | null) { return this.add('PATCH', p, h, roles ?? null); }
  delete(p: string, h: Handler, roles?: string[] | null) { return this.add('DELETE', p, h, roles ?? null); }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i]!;
        const value = parts[i]!;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  /** True when the path exists under a different method — lets us answer 405 not 404. */
  hasPath(pathname: string): boolean {
    const parts = pathname.split('/').filter(Boolean);
    return this.routes.some(
      (route) =>
        route.segments.length === parts.length &&
        route.segments.every((s, i) => s.startsWith(':') || s === parts[i]),
    );
  }
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `Request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse a multipart/form-data body.
 *
 * Operates on raw bytes rather than a decoded string, because decoding binary image
 * data as UTF-8 first would corrupt it.
 */
function parseMultipart(
  buffer: Buffer,
  boundary: string,
): { fields: Record<string, string>; files: UploadedFile[] } {
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];

  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    const next = buffer.indexOf(delimiter, start);
    if (next === -1) break;
    parts.push(buffer.subarray(start, next));
    cursor = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerText = part.subarray(0, headerEnd).toString('utf8');
    // Trailing CRLF before the next delimiter is part of the framing, not the content.
    const content = part.subarray(headerEnd + 4, part.length - 2);

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1]!;

    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    if (filenameMatch && filenameMatch[1]) {
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      files.push({
        fieldName,
        originalName: filenameMatch[1],
        mimeType: typeMatch?.[1]?.trim() ?? 'application/octet-stream',
        data: content,
      });
    } else {
      fields[fieldName] = content.toString('utf8');
    }
  }

  return { fields, files };
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Serve a file from `rootDir`. Returns false when the file is absent so the caller can
 * fall through to routing.
 *
 * `relative` is resolved and then checked to be inside `rootDir`, which blocks
 * `../` traversal out of the served directory.
 */
export function serveStatic(res: http.ServerResponse, rootDir: string, relative: string): boolean {
  const target = path.resolve(rootDir, '.' + path.posix.normalize('/' + relative));
  if (!target.startsWith(path.resolve(rootDir) + path.sep)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function applyCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', config.clientOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export interface ServerOptions {
  router: Router;
  /** Hooks for paths handled outside the router, e.g. static assets. Return true if handled. */
  staticHandlers?: Array<(ctx: { pathname: string; res: http.ServerResponse }) => boolean>;
}

export function createServer({ router, staticHandlers = [] }: ServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    applyCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      for (const handler of staticHandlers) {
        if (handler({ pathname, res })) return;
      }

      const matched = router.match(req.method ?? 'GET', pathname);
      if (!matched) {
        throw router.hasPath(pathname)
          ? new HttpError(405, `${req.method} not allowed on ${pathname}`)
          : notFound(`No route for ${req.method} ${pathname}`);
      }

      const contentType = String(req.headers['content-type'] ?? '');
      let body: Record<string, unknown> = {};
      let files: UploadedFile[] = [];

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const raw = await readBody(req, config.maxUploadBytes);
        if (raw.length > 0) {
          if (contentType.includes('multipart/form-data')) {
            const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
            const value = boundary?.[1] ?? boundary?.[2];
            if (!value) throw badRequest('Malformed multipart body: no boundary');
            const parsed = parseMultipart(raw, value.trim());
            body = parsed.fields;
            files = parsed.files;
          } else if (contentType.includes('application/json')) {
            try {
              body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
            } catch {
              throw badRequest('Request body is not valid JSON');
            }
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
          }
        }
      }

      const authHeader = String(req.headers.authorization ?? '');
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const user = token ? verifyToken(token) : null;

      const { route, params } = matched;
      if (route.roles !== null) {
        if (!user) throw unauthorized();
        if (route.roles.length > 0 && !route.roles.includes(user.role)) {
          throw forbidden(`Requires role: ${route.roles.join(' or ')}`);
        }
      }

      const ctx: Ctx = {
        req,
        res,
        method: req.method ?? 'GET',
        pathname,
        params,
        query: url.searchParams,
        body,
        files,
        user,
      };

      const result = await route.handler(ctx);

      // A handler that wrote the response itself (a file stream, say) returns undefined.
      if (res.writableEnded || result === undefined) return;
      sendJson(res, res.statusCode === 200 ? 200 : res.statusCode, result);
    } catch (error) {
      if (res.writableEnded) return;
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, details: error.details });
        return;
      }
      // Unexpected failures are logged server-side; the client gets a generic message
      // so internal details are not leaked.
      console.error(`[error] ${req.method} ${pathname}`, error);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}

// ---------------------------------------------------------------------------
// Input coercion
// ---------------------------------------------------------------------------

/**
 * Read a required number from a request body.
 *
 * Note the explicit empty-string check: `Number('')` is 0, which would silently turn a
 * blank form field into a real measurement of zero. In a metrology tool that is exactly
 * the kind of quiet data corruption worth being strict about.
 */
export function num(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '') {
    throw badRequest(`Missing required number: ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(`${field} must be a number, got ${String(value)}`);
  return parsed;
}

/** Read an optional number. Blank and null both mean "not entered"; invalid inputs throw 400. */
export function numOrNull(value: unknown, field?: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${field ? field + ' ' : ''}must be a number, got ${String(value)}`);
  }
  return parsed;
}

export function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`Missing required text: ${field}`);
  }
  return value.trim();
}

export function strOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

/** Validate and parse an optional date string in YYYY-MM-DD format. */
export function dateOrNull(value: unknown, field?: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw badRequest(`${field ? field + ' ' : ''}must be a date string (YYYY-MM-DD)`);
  }
  const str = value.trim();
  if (str === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw badRequest(`${field ? field + ' ' : ''}must be in YYYY-MM-DD format, got "${str}"`);
  }
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m! - 1 ||
    date.getUTCDate() !== d
  ) {
    throw badRequest(`${field ? field + ' ' : ''}is not a valid calendar date: "${str}"`);
  }
  return str;
}

/** Validate and parse an optional time string in HH:MM or HH:MM:SS format. */
export function timeOrNull(value: unknown, field?: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw badRequest(`${field ? field + ' ' : ''}must be a time string (HH:MM)`);
  }
  const str = value.trim();
  if (str === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(str)) {
    throw badRequest(`${field ? field + ' ' : ''}must be in HH:MM format, got "${str}"`);
  }
  return str;
}

/** Validate an email address format. */
export function emailOrNull(value: unknown, field = 'email'): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be an email string`);
  }
  const str = value.trim().toLowerCase();
  if (str === '') return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
    throw badRequest(`${field} must be a valid email address`);
  }
  return str;
}

/** Validate a value against an allowed set, with a helpful error listing the options. */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback?: T,
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  if (fallback !== undefined && (value === undefined || value === null || value === '')) {
    return fallback;
  }
  throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
}
