# NAWI Testing — OIML R76 Digital Test Report System

Software that produces OIML R76 / EN 45501 type-test reports for non-automatic weighing
instruments (NAWI), replacing the manual Excel workbooks laboratories keep by hand.

**SIH 2026 · Problem Statement 26035** — *Automated OIML R76 non-automatic weighing
instrument digital test report & pattern approval system.*

## The core idea

No verdict is ever typed. A technician enters only what they observed — the applied load
and the instrument's indication — and every derived quantity (error, corrected error, MPE,
pass/fail, run verdict, project rollup) is computed from those observations by pure
functions on the server. A report cannot disagree with the readings behind it, because the
readings are the only thing anyone can edit.

## Features

- **Dashboard** — all examinations with search, status/verdict filters, and date filtering
  (presets, custom range, newest/oldest sort).
- **Creation wizard** — project metadata, instrument spec (Max, Min, e, d, auto-computed n,
  accuracy class), and auto-generated reference weights.
- **19 OIML R76 test types, 16 with data entry** — intrinsic error, repeatability,
  eccentricity (with pan diagram), temperature, humidity, EMC (ESD/burst/radiated), span
  stability, equilibrium, zero creep, tare, tilting, warm-up, voltage variation, damping,
  discrimination — with live error curves and MPE envelopes.
- **Pattern conformity checklist** — EN 45501 clauses with pass/fail/NA and remarks.
- **Report repository** — every generation kept (PDF/DOCX/HTML), downloadable, printable,
  with verdict and generation history per examination.
- **Test history** — chronological log of all runs with filters, plus a simulated
  proof-of-history anchoring demo (hash chain per page).
- **Evidence photos, signatures, user profiles** with role-based access (admin/technician).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS (`web/`) |
| Backend | Dependency-free `node:http` REST API (`server/src/`) |
| Database | Supabase PostgreSQL (`DATABASE_URL`) |
| Rules engine | Pure functions in `packages/domain/` — no DB, no clock, unit-testable |

## Run it (5 minutes)

Prerequisites: **Node 22.18+**, a Supabase Postgres database, `python3` + `curl` (for `verify` only).

```bash
npm install
cd web && npx vite build && cd ..   # build the client (server serves web/dist)
cp .env.example .env                # fill in DATABASE_URL + Supabase keys
npm run seed                        # create demo data
npm start                           # API + app on http://127.0.0.1:4000
```

Open http://127.0.0.1:4000 and sign in:

| Email | Password | Role |
|---|---|---|
| `admin@delta.test` | `admin123` | Admin / signatory |
| `tech@delta.test` | `tech123` | Technician |

For frontend development with hot reload: `npx vite` inside `web/` (port 5173, proxies `/api` to the backend on 4000).

## Host the UI on Vercel

The repo ships a `vercel.json`: import the repo, Vercel builds `web/` and serves it
statically (SPA fallback included). The install step sets `PUPPETEER_SKIP_DOWNLOAD=1`
so it never downloads the headless-Chrome binary the API uses for server-side PDFs —
that download is what hangs installs on networks where the Chrome
CDN is blocked. Do NOT use Vercel's Supabase integration — nothing in this repo reads
its variables, so connecting it changes nothing. The database connection is direct
(UI → API server → Supabase Postgres) and needs exactly two values:

1. **API host** (wherever `npm start` runs) needs `DATABASE_URL`. Use the Supabase
   **pooler URL** (port `6543`, Supavisor `transaction` mode) rather than the direct
   connection — direct connections hang from hosts without IPv6, which looks exactly
   like an app that "keeps loading". The server disables prepared statements
   automatically for pooler URLs.
2. **Same API host** needs `CLIENT_ORIGIN=https://your-app.vercel.app` (comma-separated
   if several UIs call one API), otherwise the browser blocks every request.
3. **Vercel project** → Environment Variables: `VITE_API_BASE=https://your-api-host`
   (no trailing slash), then redeploy. Leave it unset when UI and API share an origin.

If sign-in fails, the login screen now names the API origin it tried and gives up after
15 s instead of loading forever — that message tells you which of the three is wrong.
A quick chain check from any machine: `curl https://your-api-host/api/health` should
return `{"ok":true,…}` (it touches the database, so it proves API→Supabase too).

## 3-minute demo script

1. **Dashboard** — a seeded examination is ready: task **A530947** (Taiwan Scale NHB150,
   Max 150 g, class II). Try the search and date filters.
2. **Open it** — project summary, instrument models, per-test verdicts.
3. **A test sheet** (e.g. Intrinsic Error) — edit one indication and watch that row flip to
   fail while neighbours stay green; the run verdict and project rollup follow. Type text
   into a reading to see the invalid-datatype guard. Restore the value and it rolls back.
4. **Checklist** — assess EN 45501 clauses.
5. **Generate report** — one click produces the document; find it in the **Reports** vault
   alongside earlier versions.
6. **Test history** — every run, filterable, with the anchoring demo per page.

## Checks

```bash
npm test        # domain unit suite (no registry access needed)
npm run verify  # end-to-end: boots a throwaway DB, walks the demo, 100+ checks
```

## Project layout

```
packages/domain/   the standard as pure functions (MPE tables, error arithmetic, verdicts)
server/src/        REST API, report renderer (HTML/PDF/DOCX), seed script, auth
web/src/           React app: pages, test forms, charts, filters
scripts/           test runner + end-to-end verification harness
docs/              OIML R76 background research summary
```

Runtime state (database, uploaded photos, generated reports) lives outside the repo and is
rebuilt with `npm run seed`. See `docs/OIML_R76_2_RESEARCH_SUMMARY.md` for standard background.
