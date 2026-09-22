/**
 * Runtime configuration. Every value has a working default so the app boots with no
 * environment setup — a hackathon demo should never fail on a missing env var.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file rather than from cwd. */
export const ROOT = path.resolve(here, '..', '..');

export const SERVER_ROOT = path.resolve(here, '..');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // 0.0.0.0 by default: hosts like Render only detect ports bound on all
  // interfaces. Local dev is unaffected — localhost still reaches it.
  host: process.env.HOST ?? '0.0.0.0',

  uploadsDir: process.env.UPLOADS_DIR ?? path.join(SERVER_ROOT, 'uploads'),
  reportsDir: process.env.REPORTS_DIR ?? path.join(SERVER_ROOT, 'reports'),

  /**
   * Signing secret for session tokens. Randomised per boot when unset, which
   * invalidates old tokens on restart — fine for a prototype, and safer than
   * shipping a hard-coded default that could reach production.
   */
  jwtSecret: process.env.JWT_SECRET ?? null,
  tokenTtlSeconds: Number(process.env.TOKEN_TTL_SECONDS ?? 60 * 60 * 12),

  /** Max upload size for attachment photos. */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024),

  /** Vite dev server origin, allowed through CORS. */
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',

  /**
   * MPE tolerance table selector. No default change: 'spec' reproduces the build-spec
   * bands (Class II 500/2000); 'oiml_r76' applies published OIML R76-1 Table 3
   * (Class II 5000/20000). Pending metrologist decision — see ROADMAP §6.1 and
   * packages/domain/src/mpeRules.ts header. Invalid values fall back to 'spec'.
   */
  mpeTable: (process.env.MPE_TABLE === 'oiml_r76' ? 'oiml_r76' : 'spec') as 'oiml_r76' | 'spec',
};

export function ensureDirectories(): void {
  for (const dir of [config.uploadsDir, config.reportsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
