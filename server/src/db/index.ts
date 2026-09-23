/** PostgreSQL access for the Supabase-backed application. */

import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres, { type Sql } from 'postgres';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, 'schema.sql');
type QueryClient = Sql<Record<string, unknown>>;
let sql: QueryClient | null = null;
const transactionStore = new AsyncLocalStorage<QueryClient>();

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for the Supabase PostgreSQL connection');
  return url;
}

/** Preserve the existing handwritten SQL API while translating `?` to PostgreSQL `$n`. */
function postgresQuery(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

export function getSql(): QueryClient {
  if (!sql) {
    const url = getDatabaseUrl();
    // Supabase's connection pooler (port 6543, transaction mode) cannot use
    // prepared statements — without this every query fails against a pooler URL.
    const pooled = /:6543(\/|$|\?)/.test(url) || url.includes('pgbouncer=true');
    sql = postgres(url, {
      ssl: 'require',
      max: 20,
      // Long idle retention: every reconnect to Supabase costs a TLS handshake
      // (~0.3–1 s), and with 60 s the pool went cold between ordinary clicks, so
      // nearly every request paid it. Ten minutes keeps the working set warm; the
      // pooler is built for idle connections.
      idle_timeout: 600,
      connect_timeout: 15,
      fetch_types: false,
      ...(pooled ? { prepare: false } : {}),
    });
  }
  return sql;
}

const MASTER_DATA_CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry<T> = { value: T; expiresAt: number };
let testTypesCache: CacheEntry<Row[]> | null = null;
let checklistItemsCache: CacheEntry<Row[]> | null = null;
let testTypesPending: Promise<Row[]> | null = null;
let checklistItemsPending: Promise<Row[]> | null = null;
let masterDataGeneration = 0;

async function getCachedMasterData(
  kind: 'testTypes' | 'checklistItems',
  query: string,
): Promise<Row[]> {
  const cache = kind === 'testTypes' ? testTypesCache : checklistItemsCache;
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const pending = kind === 'testTypes' ? testTypesPending : checklistItemsPending;
  if (pending) return pending;

  const generation = masterDataGeneration;
  const request = all<Row>(query).then((value) => {
    if (generation === masterDataGeneration) {
      const entry = { value, expiresAt: Date.now() + MASTER_DATA_CACHE_TTL_MS };
      if (kind === 'testTypes') testTypesCache = entry;
      else checklistItemsCache = entry;
    }
    return value;
  }).finally(() => {
    if (kind === 'testTypes') testTypesPending = null;
    else checklistItemsPending = null;
  });

  if (kind === 'testTypes') testTypesPending = request;
  else checklistItemsPending = request;
  return request;
}

export async function getCachedTestTypes<T = Row>(): Promise<T[]> {
  return (await getCachedMasterData(
    'testTypes',
    'SELECT * FROM test_type ORDER BY sort_order',
  )) as T[];
}

export async function getCachedChecklistItems<T = Row>(): Promise<T[]> {
  return (await getCachedMasterData(
    'checklistItems',
    'SELECT * FROM checklist_item ORDER BY sort_order',
  )) as T[];
}

export function invalidateMasterDataCache(): void {
  masterDataGeneration += 1;
  testTypesCache = null;
  checklistItemsCache = null;
}

function activeClient(): QueryClient {
  return transactionStore.getStore() ?? getSql();
}

export type Row = Record<string, unknown>;

export async function all<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await activeClient().unsafe<T[]>(postgresQuery(query), params as any[])) as T[];
}

export async function get<T = Row>(query: string, params: unknown[] = []): Promise<T | null> {
  const rows = await all<T>(query, params);
  return rows[0] ?? null;
}

/** Execute a statement and return an inserted identity plus affected-row count. */
export async function run(
  query: string,
  params: unknown[] = [],
): Promise<{ lastInsertRowid: number; changes: number }> {
  const trimmed = query.trim();
  const needsId = /^insert\s+into\s+/i.test(trimmed) &&
    !/\breturning\b/i.test(trimmed) &&
    !/^insert\s+into\s+test_type\b/i.test(trimmed);
  const executable = needsId ? `${trimmed} RETURNING id` : trimmed;
  const result = await activeClient().unsafe<Row[]>(postgresQuery(executable), params as any[]);
  const metadata = result as unknown as { count?: number };
  const first = result[0] as Record<string, unknown> | undefined;
  const firstValue = first?.id ?? (first ? Object.values(first)[0] : undefined);
  const numericId = firstValue !== undefined && firstValue !== null ? Number(firstValue) : 0;
  return {
    lastInsertRowid: Number.isFinite(numericId) ? numericId : 0,
    changes: Number(metadata.count ?? 0),
  };
}

export async function transaction<T>(fn: (tx: QueryClient) => Promise<T>): Promise<T> {
  const client = getSql();
  return (await client.begin(async (tx) =>
    transactionStore.run(tx as unknown as QueryClient, () => fn(tx as unknown as QueryClient)),
  )) as T;
}

/** Accept both SQLite text JSON and native PostgreSQL JSON/JSONB values. */
export function parseJson<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val as T;
  if (typeof val !== 'string' || val.trim() === '') return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

export async function applySchema(): Promise<void> {
  const schema = await fs.readFile(schemaPath, 'utf8');
  await getSql().unsafe(schema);
  invalidateMasterDataCache();
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
    invalidateMasterDataCache();
  }
}

export async function dropAllObjects(): Promise<void> {
  const client = getSql();
  await client.begin(async (tx) => {
    await tx.unsafe(`
      DROP TABLE IF EXISTS generated_report, signature, attachment,
        project_checklist_result, observation, test_run, reference_weight,
        instrument_model, instrument_family, project, checklist_item,
        test_type, manufacturer, "user" CASCADE
    `);
    const schema = await fs.readFile(schemaPath, 'utf8');
    await tx.unsafe(schema);
  });
  invalidateMasterDataCache();
}
