# OIML R76 Digital Test Report System

Software for producing OIML R76 / EN 45501 type-test reports for non-automatic weighing
instruments, replacing the manual Excel workbook (`DTPR76-vX.X`) that laboratories keep by hand.
The demo data is a real examination: DELTA task A530947, report DANAK-1911302, a Taiwan Scale
NHB series balance, model NHB150 — Max 150 g, Min 0.4 g, e 0.02 g, d 0.002 g, n 7500, accuracy
class II.

The point of the system is that no verdict is ever typed. A technician enters what they observed
— the applied load and the instrument's indication — and every derived quantity (error, corrected
error, n_i, MPE, pass/fail, the run verdict, the project rollup) is computed from those observations
by a pure function on the server, never stored as an editable field. A report cannot disagree with
the readings behind it, because the readings are the only thing anyone can edit.

## Running it

Node 22.18 or newer. Nothing to install.

```bash
npm run seed      # create and populate the demo database
npm start         # serve API + client on http://127.0.0.1:4000
```

Then open http://127.0.0.1:4000 and sign in:

| Email              | Password   | Role                        |
| ------------------ | ---------- | --------------------------- |
| `admin@delta.test` | `admin123` | A. Nielsen — admin, signatory |
| `tech@delta.test`  | `tech123`  | technician                  |

`npm run seed -- --reset` rebuilds from empty, which is the one to use before recording a demo.
`npm test` runs the domain suite (120 tests, 28 suites) with no registry access — Node's built-in
runner executes the TypeScript directly and a local shim supplies the `vitest` API the test files
import. `npm run verify` is the end-to-end check: it boots a server against a throwaway database in
a temporary directory, walks the whole demo workflow, inspects the generated report, and tears
everything down again (117 checks). It needs `python3` and `curl`, and leaves your data untouched —
the one thing it writes inside the working copy is `client/vendor/`, which is generated and
git-ignored anyway (see below).

Runtime state — the database, uploaded photographs, generated reports — is written under `server/`
by default. To keep a working copy clean, point the three paths elsewhere:

```bash
DB_PATH=/tmp/demo/app.sqlite UPLOADS_DIR=/tmp/demo/uploads REPORTS_DIR=/tmp/demo/reports npm start
```

That covers everything you would not want to lose. Booting the server also refreshes
`client/vendor/domain/` when it is stale, which no environment variable moves — it is emitted
build output, git-ignored, and rebuilt on demand.

`npm run typecheck` needs `npm install` first, since `tsc` is the one real dependency. It is not
required to run or test the application.

## How it is put together

```
packages/domain/     the standard, as pure functions — the only place a verdict is decided
server/              node:http + node:sqlite REST API, report renderer, seed script
client/              zero-build ES modules served as static files
scripts/             test runner, end-to-end verification, and the domain emitter for the browser
```

`packages/domain` is the whole design. `mpeRules.ts` holds the tolerance staircase and the
pass/fail predicates; `calc.ts` turns a table of observations into a table of results; neither
reads a database or a clock. Being pure is what makes the rules unit-testable without a database or
a server, and it is why the arithmetic exists in exactly one place.

The server is the only thing that evaluates. A technician types indications, the client debounces
about half a second, sends the whole row set, and re-renders whatever the server computed — so the
numbers on screen are always numbers the server has agreed to, and there is no second
implementation of the rules in the browser to drift from the first. The cost is that derived columns
land a beat after typing stops rather than on the keystroke; the benefit is that a screen can never
show a verdict the database would disagree with. `npm run build:client` vendors the domain package
into `client/vendor/` so the browser can share the formatting and precision helpers from the same
source, which is all the client actually needs from it.

The domain vocabulary deliberately mirrors the standard and the printed report — Max, e, d, n, L,
I, E, Ec, MPE — so a metrologist reading the code recognises the terms without a translation layer.

Nineteen test types are seeded; fourteen accept data entry; seven arrive with the NHB150 numbers
already in them. They collapse onto five table shapes via a `formKind` discriminator, so adding
another EMC sub-test is a seed row, not a new screen. Test types and checklist clauses both carry
`applicable_standards`, which means a new OIML revision is new seed data rather than a code change.

## The demo, end to end

Every step below is asserted by `scripts/verify/section8.py` against a freshly seeded database:

1. **Seed** — one examination ready to open, rolling up to pass across 7 tests.
2. **Intrinsic Error** — 11 loads, the MPE staircase stepping `[0.01, 0.02, 0.03]` across the
   range, n_i computed per row. Edit one indication and that row flips to fail while its
   neighbours stay green; the run verdict follows; the failing row is named.
3. **Summary** — the project rolls to 6 pass / 1 fail and names the offending test. Restore the
   reading and it rolls back.
4. **Repeatability and Eccentricity** — the same pattern, judged differently: repeatability as a
   set (range against MPE, no per-trial verdict), eccentricity per position with a pan diagram.
5. **Checklist** — 15 clauses under EN 45501:1992/AC:1993, each with its clause reference.
6. **Generate Report** — sections, embedded photographs, the error curve, the pan diagram,
   signature sheet, paginated for print.
7. **Repository** — search finds it by task number, report number, manufacturer or generator.
   Regenerating appends; earlier reports stay openable.

## The error curve

The table already carries every number, so the chart is not there to convey missing data. It is
there because a reader cannot see from a column of figures whether the errors are drifting steadily
toward the tolerance or sitting comfortably in the middle of it, and that shape is what an examiner
actually judges.

Three decisions in it are worth knowing about, because each was made against an obvious
alternative:

**The envelope is drawn as a step function.** MPE changes at the band boundaries in the standard.
Interpolating between loads would draw a smooth taper that does not exist and would put the
boundary in the wrong place — precisely where the interesting readings sit.

**The vertical axis is fixed at 2.5× MPE and does not adapt to the readings.** Fitting the axis to
the data is the obvious choice and it is wrong twice over. A grossly failing reading — which is
what a transposed digit or the wrong test weight produces — rescales the axis around itself: the
tolerance band collapses to a sliver and every other reading flattens onto the zero line, so the
chart ends up answering "how big was the worst error", which the table answers exactly, while
destroying the one thing only the chart shows. And an adaptive axis makes two charts of the same
instrument incomparable, because the same curve drawn at two scales looks like two instruments.
A fixed frame costs the vertical space a tight curve would otherwise fill; that is the honest
picture. Readings past the frame are drawn at the edge as triangles rather than clipped, so nothing
is silently dropped, and the caption says how many.

**It plots the error the verdict was reached on.** Each test type is judged on either the raw error
or the corrected error. A chart that infers the column ("corrected if present, else raw") is right
for some test types and silently wrong for the rest, and the failure mode is the worst available:
a marker sitting inside the tolerance band beside a row the report has just marked fail. So the rule
that reaches the verdict publishes the value it judged, as `judgedErrorUp` / `judgedErrorDown`, and
both charts plot that rather than picking a column for themselves. It also publishes `errorBasis`,
naming which column that was, so a consumer can label the axis honestly — neither chart labels it
per-test yet, and the field is there for when one does.

The report's chart is static SVG rather than a charting library, because the document has to render
years from now from a single file, and a script tag that fetches a library renders an empty box the
moment the report is opened offline.

## Deviations from the build spec

**Backend is `node:http` + `node:sqlite`, not Express + Prisma/Postgres.** Chosen so the prototype
runs with zero `npm install`, which removes the most common way a demo fails on someone else's
machine. The trade is manual routing and hand-written SQL. The route table is small and the schema
is one file, so this is a reasonable trade at prototype scale and a poor one at production scale —
the domain package is deliberately free of both, so replacing the transport and the store does not
touch the rules.

**Client is vanilla ES modules, not React + Vite + Tailwind + Recharts.** Same reason, same trade:
no build step, no dependency tree, at the cost of writing the rendering helpers (`dom.js`,
`components.js`) and both charts by hand. The charts being hand-drawn turned out to matter more
than expected — the three decisions above are exactly the ones a charting library takes for you,
and it takes them the other way.

**Class II MPE band boundaries follow the spec, which does not match OIML R76-1 Table 3.** The
spec's boundaries — 500 and 2000 intervals — are what the standard assigns to Class III. Class II
uses 5000 and 20000. This is not academic, and it is not symmetric: for the NHB150 the two tables
agree up to 10 g and diverge above it, with the spec's table consistently the *more permissive* one.

| Load  | n_i  | Spec table | OIML R76-1 Table 3 |
| ----- | ---- | ---------- | ------------------ |
| 10 g  | 500  | 0.5 e      | 0.5 e              |
| 30 g  | 1500 | 1.0 e      | 0.5 e              |
| 50 g  | 2500 | 1.5 e      | 0.5 e              |
| 150 g | 7500 | 1.5 e      | 1.0 e              |

At 50 g the spec allows 0.03 g where the published table allows 0.01 g — three times the tolerance.
So an instrument can pass here and fail a properly conducted examination, which is the dangerous
direction for the error to run in.

The build ships the spec's table as the default (`MPE_TABLE_SPEC`) so it reproduces the source
document it was specified from, with the published boundaries available as `MPE_TABLE_OIML_R76` and
a one-line switch at `DEFAULT_MPE_TABLE` in `packages/domain/src/mpeRules.ts`. Both tables are
covered by the unit tests. **This needs a metrologist's decision before the software is used on real
work, and given which way the leniency runs, before any result from it is relied on.**

**PDF export is print-styled HTML.** Generating a report writes a paginated, print-stylesheet HTML
file; if Puppeteer happens to be installed it also renders a PDF, and if not the browser's own
Save-as-PDF produces the same pagination. Either path stores a timestamped history row, so the
repository behaves identically. The PDF render honors the report's own `@page` rule
(`preferCSSPageSize`), so margins paginate identically to the browser path. Where the Chrome
CDN download for Puppeteer fails, point `PUPPETEER_EXECUTABLE_PATH` at a system Chrome
instead — that configuration is verified (17-page A4, vector charts, tagged PDF).

## What exercising the server turned up

Testing the running server rather than trusting the code surfaced four defects a reading of it had
not. Each is worth recording because each is invisible to a unit test:

The report row that would have been **visible but unsearchable** — the history query joined on a
column the search did not. The caption endpoint was **PATCH, not PUT**, so an assumed-correct client
call silently did nothing. The chart's **y-axis rescaled around an outlier**, which broke the chart
during the exact demo step that breaks a reading on purpose. And the chart **plotted a quantity the
verdict was not reached on**, drawing a passing-looking dot beside a failing row.

The last two are why `chartcheck.py` parses geometry instead of grepping for tags. Both charts
contained every element you would check for by substring, and both were still wrong — a chart can
emit a `<polyline>` for every series and still plot them against the wrong axis.

Two things about the checks themselves. `npm test` can report success while a suite never runs: if a
`describe` callback throws, Node prints `not ok` for that suite but does not count it in `# fail` and
exits 0 — a green run with invisible missing tests, the worst possible failure mode for a suite whose
whole purpose is to be the green signal. The runner now greps the TAP output directly and fails on
any `not ok` regardless of the exit code. And `scripts/verify.sh` was itself checked by injecting a
deliberate failure and confirming it goes red and non-zero, because a verification script that cannot
fail is decoration.


## Housekeeping

Three files are left over from development and should be deleted:

```
server/check-tmp.ts
server/data/probe.sqlite
server/data/probe.sqlite-journal
```

`server/data/`, `server/uploads/`, `server/reports/` and `client/vendor/` are all generated and
git-ignored. The database is rebuilt by `npm run seed`; the vendored browser copy of the domain
package by `npm run build:client`.
