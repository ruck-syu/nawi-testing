/**
 * Server entrypoint.
 *
 * Serves the API, the web client, the generated reports and uploaded photos from
 * one port. The client is the Vite-built React app in `web/dist` — rebuild it
 * with a Vite build inside `web/` after changing anything under `web/src`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT, ensureDirectories } from './config.ts';
import { applySchema, closeDb } from './db/index.ts';
import { applyMigrations } from './db/migrations.ts';
import { Router, createServer, serveStatic } from './http.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerTestRoutes } from './routes/tests.ts';
import { registerReportRoutes } from './routes/reports.ts';
import { registerUserRoutes } from './routes/users.ts';

const router = new Router();
registerAuthRoutes(router);
registerProjectRoutes(router);
registerTestRoutes(router);
registerReportRoutes(router);
registerUserRoutes(router);

const webDistDir = path.join(ROOT, 'web', 'dist');
// The web client is optional: API-only hosts (no web build) serve the API,
// reports and uploads, while the UI lives elsewhere.
const clientDir = webDistDir;
const hasClient = fs.existsSync(path.join(clientDir, 'index.html'));
if (!hasClient) {
  console.log('  web/dist/index.html is missing — running API-only (no UI on /).');
}

const server = createServer({
  router,
  staticHandlers: [
    ({ pathname, res }) =>
      pathname.startsWith('/reports/')
        ? serveStatic(res, config.reportsDir, pathname.slice('/reports/'.length))
        : false,

    ({ pathname, res }) =>
      pathname.startsWith('/uploads/')
        ? serveStatic(res, config.uploadsDir, pathname.slice('/uploads/'.length))
        : false,

    // The client. Unknown non-API paths fall back to index.html so client routing survives
    // a reload on a deep link.
    ({ pathname, res }) => {
      if (pathname.startsWith('/api/') || !fs.existsSync(clientDir)) return false;
      if (serveStatic(res, clientDir, pathname)) return true;
      return serveStatic(res, clientDir, 'index.html');
    },
  ],
});

ensureDirectories();

// Fail fast with an actionable message rather than surfacing database errors per request.
try {
  await applySchema();
  await applyMigrations();
} catch (error) {
  console.error(`\nCould not connect to PostgreSQL or apply the schema.\n${(error as Error).message}\n`);
  process.exit(1);
}

server.listen(config.port, config.host, () => {
  console.log(`\n  OIML R76 report system`);
  console.log(`  App      http://${config.host}:${config.port}`);
  console.log(`  API      http://${config.host}:${config.port}/api`);
  console.log(`  Database Supabase PostgreSQL\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
process.on(signal, () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}
