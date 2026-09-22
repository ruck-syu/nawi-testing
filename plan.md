# Build Spec: OIML R76 Digital Test Report System (SIH Prototype)

## 0. Context (read this first)

We are building a prototype for Smart India Hackathon. The problem statement asks for
software that generates OIML R76 type-test reports for Non-Automatic Weighing Instruments
(NAWIs), replacing the current industry practice of manually filling giant Excel workbooks
(DELTA's `DTPR76-vX.X` templates are the real-world example we are digitizing).

Reference real-world document we are modeling this on: a DELTA Test Report for a
"Taiwan Scale NHB series" balance, tested under OIML R76 / EN 45501:1992, accuracy class II.
We will use the NHB150 model's real numbers as our seed/demo data (see Section 6).

This is a PROTOTYPE, not the full production system. Build a representative subset of
tests that proves the architecture generalizes, not all ~25 OIML R76 test types. See
Section 5 for exactly which tests to implement.

---

## 1. Tech stack (use this unless a strong reason not to)

- Frontend: React (Vite), TypeScript, Tailwind CSS, Recharts (for error-curve charts)
- Backend: Node.js + Express (or FastAPI/Python if preferred), REST API
- Database: PostgreSQL (SQLite acceptable for prototype speed if Postgres setup is friction)
- Auth: simple JWT-based login, two roles only: `admin` and `technician`
- Report export: 
  - PDF via Puppeteer (render an HTML report template to PDF) — simplest for prototype
  - Word export via `docxtemplater` (Node) or `python-docx` (Python) — optional stretch goal
- File storage: local filesystem `/uploads` folder for the prototype (no cloud storage needed)
- Charts inside exported report: render Recharts to PNG (or use Chart.js server-side canvas) and embed as image

Keep the whole thing runnable locally with `npm install && npm run dev` (or equivalent). No
cloud deployment required for the demo video.

---

## 2. Core domain concepts (glossary — implement exactly this vocabulary)

- **Max**: maximum capacity of the instrument (e.g. 150 g)
- **e**: verification scale interval — legal resolution unit (e.g. 0.02 g)
- **d**: actual displayed increment (can be finer than e)
- **n**: number of verification scale intervals = Max / e (e.g. 7500)
- **Accuracy Class**: I / II / III / IIII (we only need to support Class II for the prototype)
- **Load (L)**: reference weight applied during a test
- **Indication (I)**: what the instrument displays for that load
- **Error (E)**: `E = I + 0.5*e - L`
- **Corrected Error (Ec)**: `Ec = E - E0` where E0 is the error at zero load (isolates drift from a fixed offset)
- **MPE (Maximum Permissible Error)**: the legal tolerance for a given load, looked up from a rule table
- **Pass/Fail**: `abs(E) <= MPE` (or `abs(Ec) <= MPE` depending on test type — see 3.2)

### 2.1 MPE lookup table for Class II (THE core business rule — implement as a pure function)

For "weighing performance" style tests (Intrinsic Error, Temperature tests T1-T4, Damp Heat,
Tare), MPE depends on how many scale intervals the load represents (`n_i = L / e`):

| n_i range          | MPE (Class II) |
|--------------------|----------------|
| 0 ≤ n_i ≤ 500       | ± 0.5 e        |
| 500 < n_i ≤ 2000    | ± 1.0 e        |
| 2000 < n_i ≤ 10000  | ± 1.5 e        |

```
function lookupMPE_ClassII(n_i: number, e: number): number {
  if (n_i <= 500) return 0.5 * e;
  if (n_i <= 2000) return 1.0 * e;
  return 1.5 * e;
}
```

Other test types use FIXED (not load-dependent) tolerances — do not reuse the table above
for these, store them as constants per test type:

| Test                          | Requirement (fixed, independent of load) |
|--------------------------------|-------------------------------------------|
| Repeatability                  | `max(P) - min(P) <= MPE_at_that_load`   (uses table above, evaluated at the single test load) |
| Stability of Equilibrium       | spread across 5 readings ≤ 1 × e |
| Zero return                    | ≤ 0.25 × e (roughly — use `0.25*e` as default, expose as configurable constant) |
| Creep (30 min under load)      | drift ≤ 0.5 × e per interval (configurable constant) |
| Temperature effect on no-load  | zero drift per 5°C ≤ `pi × e` (pi = fractional factor, usually 1) |
| Span stability (across whole campaign) | `max - min` across all span measurements ≤ a fixed `mpd` (e.g. 0.25 g for this instrument — store as a configurable field per instrument, not hardcoded globally) |

Implement all of these as named functions in one `mpeRules.ts` module so it's obvious which
rule governs which test, and so this module can be swapped when OIML revises the standard.

### 2.2 Error formula variants

- Standard error: `E = I + 0.5*e - L`
- Corrected error: `Ec = E - E0`
- For up/down loading tests, compute both `E_up` and `E_down` per row, and the row only
  passes if BOTH are within MPE.

---

## 3. Data model (implement this schema)

```
Manufacturer
  id, name, address, contact_person, email, phone

Project  (= one "Task"/type-examination campaign)
  id, manufacturer_id, task_no, report_no, danak_no,
  standard_version ("EN45501:1992" — store as string, this drives which tests/clauses apply),
  examination_start_date, examination_end_date, status (draft/in_progress/completed/approved)

InstrumentFamily
  id, project_id, family_name (e.g. "NHB")

InstrumentModel  (one row per tested model, e.g. NHB150, NHB1500, NHB6000)
  id, family_id, model_name, max_capacity, min_capacity, e_value, d_value,
  n_intervals (computed = max/e), accuracy_class, fractional_factor_pi,
  load_cell_type, load_cell_manufacturer, load_cell_capacity, load_cell_rated_output_mVV,
  load_cell_min_impedance_ohm, zero_setting_types (json: {nonauto, semiauto, autozero, initial, tracking}),
  tare_types (json: {balancing, weighing, preset, subtractive, additive}, max_tare_pct),
  operating_temp_min, operating_temp_max,
  power_ac_nominal_v, power_ac_min_v, power_ac_max_v,
  power_dc_nominal_v, power_dc_min_v, power_dc_max_v,
  mpd_span_stability (fixed absolute tolerance for span stability meta-test)

ReferenceWeight  (auto-generated per InstrumentModel, but editable)
  id, model_id, nominal_load_value, sequence_order

TestType (seed/master data — one row per kind of test, versioned by standard)
  id, code (e.g. "INTRINSIC", "T1", "T2", "T3", "T4", "ECC", "REP", "ZERO_CREEP",
            "EQUIL", "TILT", "TARE", "WARMUP", "VOLT", "EMC_ESD", "DAMP1..3", "SPAN1..8"),
  display_name, description, applicable_standards (json list),
  rule_type ("MPE_TABLE" | "FIXED_VALUE" | "DERIVED_NO_ENTRY"),
  fixed_tolerance_expression (nullable, e.g. "1*e" or "0.25*e")

TestRun (one instance of a test performed on a model)
  id, model_id, test_type_code, status (not_started/in_progress/complete),
  temperature_c, humidity_pct, date_performed, time_performed, operator_name,
  overall_pass (bool, computed), remarks

Observation (rows inside a TestRun's data table)
  id, test_run_id, sequence_no,
  load_value, indication_up, indication_down,
  error_up (computed), error_down (computed),
  corrected_error_up (computed), corrected_error_down (computed),
  n_i (computed), mpe (computed), row_pass (computed)

ChecklistItem (seed/master data, versioned by standard_version)
  id, clause_no, description, category

ProjectChecklistResult (per-project answers to ChecklistItem)
  id, project_id, checklist_item_id, applicable (existent/non_existent/na),
  status (pass/fail/na), remarks, linked_test_run_id (nullable — link to actual test evidence)

Attachment
  id, project_id, model_id (nullable), test_run_id (nullable),
  file_path, caption, uploaded_by, uploaded_at

User
  id, name, email, password_hash, role (admin/technician)

Signature
  id, project_id, signed_by_name, signed_by_title, signed_at, signature_image_path (nullable)
```

---

## 4. Screens to build (in priority order)

1. **Login** (simple email/password, 2 roles)
2. **Dashboard**: list of Projects with status chips (Draft / In Progress / Completed / Approved),
   search by manufacturer/report no./model, "New Project" button
3. **New Project wizard**:
   - Step 1: Manufacturer + Project info (task no, report no, standard version, dates)
   - Step 2: Add Instrument Family + one or more Instrument Models (the big spec form —
     Section 3's `InstrumentModel` fields). Auto-compute `n = Max/e` live as user types.
   - Step 3: Auto-generate Reference Weight set for the model (see Section 6 formula),
     editable table
4. **Model workspace** (the main working screen, one per InstrumentModel):
   - Left sidebar: list of TestTypes applicable to this model/standard, each showing a
     status badge (Not started / In progress / Pass / Fail)
   - Main panel: selected test's data-entry form (see Section 5 for exact fields per test)
   - Each test form auto-pulls Max/e/n/AccuracyClass/LoadCell info from the InstrumentModel
     (read-only header, NEVER re-typed)
   - Live-calculated columns (Error, MPE, Pass/Fail) recompute as user types Indication values
   - Auto-rendered error-curve chart under each weighing-performance-style test
   - Attach photo button on each test screen (uploads to Attachment table linked to this test_run)
5. **Checklist screen**: list of ChecklistItems for the project's standard_version, each with
   Applicable/Status/Remarks inputs, optional link-to-test-run dropdown
6. **Summary/Dashboard tab** (per project): auto-rolled table exactly like the PDF's
   "Summary of Results" page — TestType | Report sheet ref | Pass/Fail | Remarks — computed
   live from TestRun.overall_pass, not manually entered
7. **Report generation screen**: "Generate Report" button → produces PDF (and optionally
   Word) → shows preview → download link. Store generated report file + generation
   timestamp so it appears in a "Report History" list.
8. **Report repository / search**: searchable list of all generated reports across projects
   (filter by manufacturer, model, date, status)

---

## 5. Tests to implement in the prototype (do ONLY these — do not attempt full R76 test suite)

For each test below: implement the data entry form + calculation + pass/fail + (where noted)
chart + summary rollup. Use the exact column layout described (these mirror the real report).

### 5.1 Instrument Spec (not a "test", but mandatory prerequisite screen)
Already covered in Section 4, Step 2. This is the single source of truth for Max/e/n/class/etc.

### 5.2 Initial Intrinsic Error (`INTRINSIC`) — build this FIRST, it's the core pattern
- Header (read-only, pulled from InstrumentModel): Max, e, n, Accuracy Class, Load cell + impedance
- Conditions: temperature, date/time (editable)
- Table columns: `Load (L)` | `Indication↓ (loading up)` | `Indication↑ (loading down)` |
  `Error↓` | `Error↑` | `Corrected Error↓` | `Corrected Error↑` | `MPE` | `Pass/Fail`
- Default 10-11 rows using the ReferenceWeight set (0.4/2.4/5/10/30/50/70/90/110/130/150 style
  pattern — see Section 6 formula)
- Auto chart: Load (x) vs Error (y), two lines (up-loading, down-loading) + MPE band lines
- Overall pass = AND of all rows

### 5.3 Temperature Test — implement T1 (reference) and T2 (high temp) only
(T3 low-temp and T4 return-to-reference are structurally IDENTICAL to T1/T2 — mention in the
demo that they reuse the same component, don't build separately unless time permits)
- Same table/columns as Intrinsic Error
- Extra header fields: room temp, chamber temp, humidity
- Same chart component reused

### 5.4 Repeatability (`REP`)
- Pick one load near Max (or half-Max) — table of 10 repeated readings: `Trial #` | `Indication` | `P (=I - I0)`
- Compute `Pmax - Pmin`, compare to MPE at that load (via `lookupMPE_ClassII`)
- Single pass/fail result, no chart needed (simple bar/scatter optional)

### 5.5 Eccentricity (`ECC`)
- Loading positions: center (a), then 4 corners (b, c, d, e) — let user pick pan shape
  (4-corner rectangular / 3-point triangular) which changes position labels
- Table: `Position` | `Load(L0=0)` | `Indication(I0)` | `Load` | `Indication(I)` | `Error` | `Corrected Error` | `MPE` | `Pass/Fail`
- Render the small loading-diagram as an SVG based on selected pan shape (not an uploaded photo)
- Attach-photo button here too (to demonstrate general attachment capability)

### 5.6 Checklist module
- Seed ~15 representative clauses from the categories seen in the real report (descriptive
  markings, verification marks, indicating device, zero-setting, tare devices) — do NOT
  transcribe the full ~150-row OIML checklist
- Each row: clause_no, description, Existent/Non-existent, Pass/Fail/NA, remarks, optional
  link to a TestRun

### 5.7 One EMC/disturbance test as a stand-in (`EMC_ESD` — Electrostatic Discharge)
- Header: test voltage levels (2kV/4kV/6kV contact, 8kV air), load applied (e.g. 100g)
- Table: `Test Voltage` | `Polarity` | `Indication before` | `Indication after` | `Error` | `MPE` | `Pass/Fail`
- Mention in the demo narration: "same pattern extends to the other 11 EMC sub-tests
  (bursts, surge, radiated field, conducted field, vehicle transients)"

### 5.8 Span Stability (mock 3 of the 8 real measurements, not all 8)
- Table: `Measurement #` | `Condition` (e.g. "Reference", "After temp test", "After humidity") |
  `Load` | `Indication` | `Error` | `Corrected Error`
- Summary row: `max(Ec) - min(Ec)` vs `mpd_span_stability` from InstrumentModel → Pass/Fail
- Small line chart: error value across measurements in chronological order with tolerance band

### 5.9 Summary Dashboard (auto-rolled, described in Section 4.6)

### 5.10 Report generation (PDF at minimum, Word as stretch goal)
- Must include: cover page, project info, instrument spec, reference weight table,
  each implemented test's table + chart, checklist section, summary-of-results table,
  attached photos in their correct sections, signature block
- Should visually resemble the structure of the real DELTA report (section order:
  cover → checklist → per-model: title/contents → summary → instrument info →
  test spec → equipment → photos → each test → )

**Explicitly SKIP for the prototype** (mention as "future work" in the demo):
Discrimination, Zero-return+Creep as separate detailed pages (just do a simplified combined
version if time permits), Stability of Equilibrium, Tilting, Tare (all 9 variants — do 1 if
time allows), Warm-up time, Voltage variation, remaining 11 EMC sub-tests, Damp Heat (all 3
phases), remaining Span Stability measurements (5-8), multi-model annexes (NHB1500/NHB6000
supplementary testing) — architecture should obviously support adding these later since
TestType is a seeded/extensible table, not hardcoded.

---

## 6. Seed / demo data (use these REAL numbers from the reference DELTA report, model NHB150)

```
Manufacturer: Taiwan Scale Mfg. Co., Ltd.
Address: 99 Shuchang Road, Zhoushi Town, Kunshan City, 215300 Jiangsu Province, China
Contact: Tom Hong, service@taiwanscale.com

Project: Task A530947, Report DANAK-1911302, Standard "EN45501:1992/AC:1993"
Examination period: 2011-01-03 to 2011-02-24

InstrumentModel "NHB150":
  Max = 150 g, Min = 0.4 g, e = 0.02 g, d = 0.002 g, n = 7500, Accuracy Class = II,
  fractional_factor pi = 1
  Load cell: type SPL, manufacturer HBM, capacity 0.2 kg, rated output 0.9 mV/V,
  min impedance 420 ohm
  Zero-setting: semi-automatic=true, initial=true, tracking=true (range ±2%, initial ±20%)
  Tare: balancing=true, subtractive=true, max tare 100%
  Operating temp: 5°C to 40°C
  Power: AC 230V 50/60Hz (external supply); DC battery 9-12V
  mpd_span_stability = 0.25 g

Reference weight set (auto-generation formula, derive this as a function so other
models generate their own set from Max/e):
  points = [0.4, 2.4, 5, 10, 30, 50, 70, 90, 110, 130, 150]
  (pattern: first two points ≈ Min and ~5000e%/e-ish small values, then evenly spaced
  steps of Max/5 up to Max — implement as: 
    p0 = Min
    p1 = Min + 2 (approx small step)
    p2 = 5000*e/1000 rounded sensibly  -- OR simpler: just hardcode this exact array
         per seed model and expose an "auto-generate evenly spaced points" button
         for new models: [Min, Max*0.02, Max*0.033, Max*0.067, Max*0.2, Max*0.33,
         Max*0.47, Max*0.6, Max*0.73, Max*0.87, Max]
    -- exact reproduction of DELTA's spacing isn't critical, just produce ~10-11
       sensible points spanning Min to Max)

Sample Intrinsic Error observations (temp 20.3°C, use these as literal seed rows):
Load(g) | Ind.up(g) | Ind.down(g)
0.4     | 0.396     | 0.4
2.4     | 2.396     | 2.4
5       | 4.996     | 5
10      | 9.996     | 10
30      | 29.998    | 29.996
50      | 49.996    | 49.996
70      | 69.996    | 69.996
90      | 90        | 89.998
110     | 109.998   | 109.998
130     | 129.998   | 130
150     | 149.998   | 149.998
(All rows Pass, MPE = 0.5*e = 0.01g for all — since n_i stays under 500 for every load
 point given e=0.02: max n_i = 150/0.02 = 7500... wait, note: actual MPE column in the
 source report literally shows 0.5 for every row meaning the report used absolute MPE=0.5*e
 uniformly here — reproduce this behavior: MPE displayed as 0.5 (i.e. 0.5, treat as the
 e-multiplier shown in report, so actual tolerance = 0.5 * e = 0.01g). Use this to test
 your lookupMPE function edge cases.)
```

Use this as your seeded "demo project" so the video has one fully working, realistic
end-to-end example without you hand-typing data live on camera.

---

## 7. Non-functional requirements
- All computed fields (Error, MPE, Pass/Fail, n_i, Corrected Error) must be pure functions,
  unit-testable, NOT stored as manually-entered values.
- Every test screen's header block (Max/e/n/AccuracyClass/LoadCell info) must be read-only
  and sourced from InstrumentModel — never duplicated as editable fields per test.
- ChecklistItem and TestType tables must carry an `applicable_standards` field so future
  OIML revisions can be added as new seed rows without code changes.
- Report generation must be re-triggerable (regenerate after edits) and each generation
  stored with a timestamp in a report history table.

## 8. Definition of done for the demo video
- Seed the NHB150 demo project via a script (`npm run seed`) so it's ready before recording.
- Live-demo: open Model workspace → show Intrinsic Error test with live calc as you tweak
  one indication value (flip a Pass to a Fail) → show chart update.
- Show Repeatability and Eccentricity briefly to prove pattern reuse.
- Show Checklist screen.
- Show auto-rolled Summary Dashboard flipping when a test result changes.
- Click "Generate Report" → show resulting PDF opening with correct sections/photos/chart.
- Show Report repository search finding it.