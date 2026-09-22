# Roadmap — OIML R76 Digital Test Report System (SIH 26035)

> Generated 2026-09-04 from codebase audit. Source of truth for what is built vs pending.
> Specs: `plan.md` (build spec), `PAGES_SPECIFICATION.md` (Tier 1/2/3), `README.md` (deviations).

## 1. Status snapshot

| Area | Done | To do |
|---|---|---|
| Tier 1 Prototype (7 tests, wizard, report) | ✅ mostly | 3 polish items |
| Tier 2 MVP (19 tests, equipment, import, DOCX) | 🟡 schema-ready | 12 tests + 4 modules |
| Tier 3 Enterprise (audit, RBAC, IoT, registry) | ⬜ | all planned |
| Tech debt / correctness | — | 6 items (1 blocking: MPE table) |

## 2. DONE — verified in code

### Domain (`packages/domain/src/`)
- [x] `mpeRules.ts` — stepped MPE staircase (SPEC + OIML_R76 tables), `E=I+0.5e-L`, `Ec=E-E0`, `bothDirectionsPass`, fixed-tolerance rules (EQUIL/ZERO/CREEP/TEMP/SPAN), `errorBasisFor`, tolerance-expression evaluator
- [x] `calc.ts` — `computeObservations/summariseTable`, `computeRepeatability`, `computeEccentricity` (+pan coordinates), `computeEsd`, `computeSpanStability`, `generateReferenceWeights`, `judgedErrorUp/Down` published for charts
- [x] `testTypes.ts` — 19-type catalogue (15 `implemented:true`), 7 `formKind`s + `disturbance` spec, 15 checklist clauses, `applicable_standards` versioning
- [x] `numeric.ts`, `types.ts` — rounding, `decimalsFor`, `InstrumentSpec` narrow type
- [x] 120 unit tests (`npm test`), 117 e2e checks (`npm run verify`: `section8.py` + `chartcheck.py` geometry checks)

### Backend (`server/src/`)
- [x] `node:http` Router + JWT auth (`admin`/`technician`), seed users `admin@delta.test` / `tech@delta.test`
- [x] Supabase Postgres (`db/index.ts`, `db/schema.sql`) — no derived values stored, `n=round(Max/e)` server-written, `overall_pass` write-through cache
- [x] Routes: `auth/projects/tests/reports` — project CRUD, model/family/weights, test-run save-whole-table-in-transaction, observations, checklist results, attachments (image-only, UUID names), signatures
- [x] `services/evaluation.ts` — single verdict path (`evaluateTestRun`, `modelSummary`, `projectRollup` batched in 3 queries)
- [x] `services/report.ts` — 8-sheet print-HTML (cover/checklist/summary/info/conditions/photos/tests/signatures), step-envelope SVG (fixed 2.5×MPE axis), pan SVG, photo data-URI embed, append-only `generated_report`, Puppeteer PDF if installed else print-CSS fallback
- [x] Seed NHB150 demo (Task A530947, DANAK-1911302, 11 loads, 7 tests pre-filled) — `server/src/db/seed.ts`
- [x] ~~Domain→browser mirror on boot (`client/vendor/`, `scripts/build-domain-esm.mjs`)~~ — retired with the classic client; the web UI imports `packages/domain/src` directly

### Frontend (was `client/src/`, zero-build ES modules — retired; now `web/`, Vite + React)
- [x] Shell (`app.js` bench + rail), `router.js`, `api.js`, `dom/components`, `chart.js`
- [x] Routes live: `#/login`, `#/projects`, `#/projects/new` (3-step wizard), `#/projects/:id`, `#/projects/:id/checklist`, `#/models/:id` + `#/models/:id/tests/:code`, `#/reports`, `#/test-history`
- [x] Test forms: `weighing.js` (INTRINSIC/T1/T2), `repeatability.js`, `eccentricity.js` (+pan diagram), `esd.js`, `span.js`, `conditions.js`, `attachments.js`, `common.js`
- [x] Live server-computed re-render (~500ms debounce), summary rollup flips on edit, report preview + repository with search/filter, test-history stream

## 3. TO DO — Tier 1 polish (demo-blocking, small)

- [x] Housekeeping deletes — verified 2026-09-04: files already absent, nothing to remove
- [x] `server/package.json` description corrected to `node:http + Supabase PostgreSQL`
- [x] `verify.sh` scratch-DB isolation (`VERIFY_DATABASE_URL` + `seed --clean` teardown; live flow still needs `VERIFY_ALLOW_LIVE=1`) — safe paths validated; first full green run needs a real scratch Postgres (none in this env)
- [x] Reports vault: format badge (HTML/PDF), Download-vs-Open label, Print/PDF button hidden for PDFs
- [x] MPE table env override (`MPE_TABLE=spec|oiml_r76`, default `spec` unchanged) threaded through all 5 evaluation paths — metrologist decision still pending, now flippable without code change
- [x] Post-session code review (agy): applied 3/4 findings — `mpeTable` union cast, dead `case` block removal (+secret-host leak), `dbPath` removal from config; rejected format-casing nit (DB CHECK guarantees lowercase)
- [x] Puppeteer direct-PDF verified (17-page A4, CSS `@page` honored via `preferCSSPageSize`, vector charts, tagged PDF) — needs `PUPPETEER_EXECUTABLE_PATH` where the Chrome CDN download fails; `PAGES_SPEC §6.3` done

## 4. TO DO — Tier 2 MVP (pilot-lab)

### 4.1 Remaining 4 tests (seed rows exist — add UI + seed data where the shape is new)
- [x] `T3` lower limit, `T4` return-to-reference (reused `weighing_performance`; 10/10 round-trip checks green, live DB master-data synced, demo untouched)
- [x] `EMC_BURST` bursts (reused `esd` shape via `disturbance` catalogue spec; 11/11 round-trip checks green; `EMC_RADIATED` honestly needs a sweep table → declaration)
- [x] `EQUIL` (spread-vs-1e trials) + `ZERO_CREEP` (zero-residual + creep series; 9 domain tests, 12/12 round-trip checks green, demo untouched)
- [x] `TARE`, `VOLT`, `DAMP1` (reused `weighing_performance`, zero code changes; 15/15 round-trip checks green, demo untouched)
- [ ] `EMC_RADIATED` radiated sweep (new frequency-sweep formKind), `DISCRIM` (new small form)
- [ ] `TILT`, `WARMUP` (new `FIXED_VALUE` forms)

### 4.2 Modules
- [ ] Equipment & standard-weights master (`#/equipment`: E2/F1/M1, certs, uncertainty, expiry, auto-link to runs)
- [ ] Direct ingestion (`#/models/:id/tests/:code/import`): CSV/Excel upload + RS232/USB serial capture
- [ ] Metrologist PIN signature + SHA-256 state seal (`#/projects/:id/sign`)
- [ ] DOCX export vault — **PARKED per 2026-09-04 decision** (plan ready: `docx` lib sibling renderer, schema `format +docx`, no round-trip import)
- [ ] Lab KPI dashboard (`#/dashboard`: active projects, pass rate, pending sign-offs, calibration deadlines)

## 5. TO DO — Tier 3 Enterprise (accredited-lab)

- [ ] Executive multi-lab dashboard (`#/executive`)
- [ ] RBAC + SSO (SAML/OAuth/AD): Technician / Sr Metrologist / Director / Auditor(read-only)
- [ ] Immutable audit trail (`audit_log` hash-chained cell edits, IP, before/after, revocation) — 17025 / 21 CFR Part 11
- [ ] Standards rules engine (`#/admin/standards`): MPE tables per edition (R76:1992/2006, EN45501:2015, HB44) + national deviations — replaces one-line `DEFAULT_MPE_TABLE` switch
- [ ] IoT chamber streaming (T/RH/pressure auto-fill headers)
- [ ] National registry sync (TAC / OIML CoC issue)

## 6. Tech debt / correctness (do before real work)

| # | Item | Severity |
|---|---|---|
| 1 | **Class II MPE bands**: spec `500/2000` vs OIML `5000/20000` — spec is 3x permissive at 50g. Needs metrologist decision + switch `DEFAULT_MPE_TABLE` | 🔴 blocking |
| 2 | `instrument_model` uses `REAL` — migrate to `NUMERIC(20,6)` / integer minor units to avoid float drift in legal quantities | 🟡 |
| 3 | `verify.sh` sqlite env vs Postgres code — repair or drop legacy sqlite path | 🟡 |
| 4 | `npm test` TAP `not ok` swallowed on `describe` throw (runner greps — keep) + `verify.sh` self-test with injected failure | 🟢 guard |
| 5 | `generated_report.format CHECK (html,pdf)` blocks future docx — migrate when unparked | 🟢 |
| 6 | Chart `errorBasis` label per-test + axis label from `judgedError/errorBasis` (fields exist, UI pending) | 🟢 |

## 7. Suggested order

1. §6.1 MPE decision → §3 polish (PDF vault, deletes, verify repair) → demo freeze
2. §4.1 TILT/WARMUP (new `FIXED_VALUE` forms) → equipment master → DISCRIM + radiated sweep
3. Unpark DOCX → KPIs → import → PIN seal
4. §5 audit trail before any production claim
