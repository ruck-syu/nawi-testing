/**
 * Auth and master-data routes.
 *
 * Master data (test types, checklist clauses) is served from the database rather than
 * from the domain package so that adding a test to a future standard revision means
 * inserting a row, not shipping a new client bundle.
 */

import { get, getCachedChecklistItems, getCachedTestTypes, parseJson } from '../db/index.ts';
import { issueToken, verifyPassword } from '../auth.ts';
import { badRequest, str, unauthorized, type Router } from '../http.ts';

interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'technician';
  is_active: boolean;
}

interface TestTypeRow {
  code: string;
  display_name: string;
  description: string | null;
  applicable_standards: string;
  rule_type: string;
  fixed_tolerance_expression: string | null;
  form_kind: string | null;
  report_sheet_ref: string | null;
  category: string | null;
  implemented: boolean;
  sort_order: number;
}

interface ChecklistItemRow {
  id: number;
  clause_no: string;
  description: string;
  category: string | null;
  applicable_standards: string;
  sort_order: number;
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/login', async (ctx) => {
    const email = str(ctx.body.email, 'email').toLowerCase();
    const password = str(ctx.body.password, 'password');

    const user = await get<UserRow>('SELECT * FROM "user" WHERE lower(email) = ?', [email]);
    // Same message for unknown user, wrong password and deactivated account,
    // so the response does not reveal which accounts exist or their status.
    if (!user || !verifyPassword(password, user.password_hash) || !user.is_active) {
      throw unauthorized('Incorrect email or password');
    }

    return {
      token: issueToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  });

  router.get('/api/auth/me', async (ctx) => ({ user: ctx.user }), []);

  router.get(
    '/api/test-types',
    async (ctx) => {
      const standard = ctx.query.get('standard');
      const rows = await getCachedTestTypes<TestTypeRow>();
      return {
        testTypes: rows
          .map((t) => ({
            code: t.code,
            displayName: t.display_name,
            description: t.description,
            applicableStandards: parseJson<string[]>(t.applicable_standards, []),
            ruleType: t.rule_type,
            fixedToleranceExpression: t.fixed_tolerance_expression,
            formKind: t.form_kind,
            reportSheetRef: t.report_sheet_ref,
            category: t.category,
            implemented: Boolean(t.implemented),
            sortOrder: t.sort_order,
          }))
          .filter(
            (t) =>
              !standard ||
              t.applicableStandards.length === 0 ||
              t.applicableStandards.includes(standard),
          ),
      };
    },
    [],
  );

  router.get(
    '/api/checklist-items',
    async (ctx) => {
      const standard = ctx.query.get('standard');
      const rows = await getCachedChecklistItems<ChecklistItemRow>();
      return {
        items: rows
          .map((item) => ({
            id: item.id,
            clauseNo: item.clause_no,
            description: item.description,
            category: item.category,
            applicableStandards: parseJson<string[]>(item.applicable_standards, []),
            sortOrder: item.sort_order,
          }))
          .filter(
            (item) =>
              !standard ||
              item.applicableStandards.length === 0 ||
              item.applicableStandards.includes(standard),
          ),
      };
    },
    [],
  );

  /** Standards supported by this installation. */
  router.get(
    '/api/standards',
    async () => {
      const types = await getCachedTestTypes<{ applicable_standards: string }>();
      const set = new Set<string>();
      for (const row of types) {
        for (const standard of parseJson<string[]>(row.applicable_standards, [])) {
          set.add(standard);
        }
      }
      return {
        standards: Array.from(set).sort(),
        defaultStandard: 'OIML R76-1:2006',
      };
    },
    [],
  );

  router.get('/api/health', async () => {
    const counts = await get<{ projects: number; runs: number }>(
      'SELECT (SELECT count(*) FROM project) AS projects, (SELECT count(*) FROM test_run) AS runs',
    );
    if (!counts) throw badRequest('Database not initialised — run `npm run seed`');
    return { ok: true, ...counts };
  });
}
