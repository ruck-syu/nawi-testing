/**
 * Excel (XLSX) report renderer — ADDITIVE format alongside HTML/PDF/DOCX.
 *
 * Consumes the shared `ReportModel` (the same data the PDF/DOCX renderers use),
 * so the workbook can never disagree with the other formats: every value comes
 * from `evaluation.ts` via the model, plus the raw stored observations (the
 * technician's entered values) read with `getObservations`. Nothing is invented.
 *
 * Layout: one cover sheet ("Report") plus one worksheet per test run. No images
 * are embedded; photo evidence appears as caption/file-name rows only.
 */

import ExcelJS from 'exceljs';
import {
  getObservations,
  type EvaluatedRun,
  type ObservationRow,
} from './evaluation.ts';
import type { ReportModel } from './reportModel.ts';

// ---------------------------------------------------------------------------
// Small presentation helpers (styling only — no data logic)
// ---------------------------------------------------------------------------

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' },
};
const TITLE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2A37' },
};
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
const SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
};

function fmt(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** "2024-05-06T…" / "2024-05-06 12:00:00" → "2024-05-06". */
function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

function styleTitleRow(sheet: ExcelJS.Worksheet, row: ExcelJS.Row, columns: number): void {
  row.font = TITLE_FONT;
  for (let i = 1; i <= columns; i += 1) {
    const cell = row.getCell(i);
    cell.fill = TITLE_FILL;
    cell.border = THIN_BORDER;
  }
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = HEADER_FONT;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
}

function styleDataRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.border = THIN_BORDER;
  });
}

function sectionTitle(sheet: ExcelJS.Worksheet, text: string, columns: number): void {
  const row = sheet.addRow([text]);
  row.font = SECTION_FONT;
  row.getCell(1).fill = HEADER_FILL;
  sheet.addRow([]);
  void columns;
}

function kv(sheet: ExcelJS.Worksheet, label: string, value: unknown): void {
  const row = sheet.addRow([label, fmt(value) ?? '—']);
  row.getCell(1).font = HEADER_FONT;
  styleDataRow(row);
}

/** Excel sheet names: max 31 chars, no []:*?/\. Deduplicated with a numeric suffix. */
function sheetNameFor(displayName: string, used: Set<string>): string {
  const clean = displayName.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Test';
  let name = clean;
  let n = 2;
  while (used.has(name)) {
    name = `${clean.slice(0, 28 - String(n).length - 1)} ${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// Column vocabularies
// ---------------------------------------------------------------------------

/** Raw observation columns: every value the technician entered. label + unit. */
const OBS_COLUMNS: Array<{ key: keyof ObservationRow; label: string; unit: string }> = [
  { key: 'sequence_no', label: 'Seq.', unit: '' },
  { key: 'load_value', label: 'Load', unit: 'g' },
  { key: 'indication_up', label: 'Indication (up)', unit: 'g' },
  { key: 'indication_down', label: 'Indication (down)', unit: 'g' },
  { key: 'delta_l_up', label: 'ΔL (up)', unit: 'g' },
  { key: 'delta_l_down', label: 'ΔL (down)', unit: 'g' },
  { key: 'position_code', label: 'Position code', unit: '' },
  { key: 'position_label', label: 'Position', unit: '' },
  { key: 'load_zero', label: 'Zero load', unit: 'g' },
  { key: 'indication_zero', label: 'Zero indication', unit: 'g' },
  { key: 'test_voltage_kv', label: 'Test voltage', unit: 'kV' },
  { key: 'application_mode', label: 'Application mode', unit: '' },
  { key: 'polarity', label: 'Polarity', unit: '' },
  { key: 'indication_before', label: 'Indication before', unit: 'g' },
  { key: 'indication_after', label: 'Indication after', unit: 'g' },
  { key: 'frequency_mhz', label: 'Frequency', unit: 'MHz' },
  { key: 'field_strength_v_m', label: 'Field strength', unit: 'V/m' },
  { key: 'condition', label: 'Condition', unit: '' },
  { key: 'measured_at', label: 'Measured at', unit: '' },
];

/**
 * Computed-row keys that are technician-entered inputs (mirrored into the
 * calculated result rows by the domain functions). Everything else on a
 * computed row is derived and belongs in the CALCULATED RESULTS table.
 */
const ENTERED_RESULT_KEYS = new Set([
  'sequenceNo',
  'loadValue',
  'indication',
  'indicationUp',
  'indicationDown',
  'deltaLUp',
  'deltaLDown',
  'positionCode',
  'positionLabel',
  'loadZero',
  'indicationZero',
  'testVoltageKv',
  'applicationMode',
  'polarity',
  'indicationBefore',
  'indicationAfter',
  'frequencyMhz',
  'fieldStrengthVM',
  'condition',
  'measuredAt',
  'notImplemented',
]);

const DERIVED_LABELS: Record<string, { label: string; unit: string }> = {
  error: { label: 'Error', unit: 'g' },
  errorUp: { label: 'Error (up)', unit: 'g' },
  errorDown: { label: 'Error (down)', unit: 'g' },
  correctedError: { label: 'Corrected error', unit: 'g' },
  correctedErrorUp: { label: 'Corrected error (up)', unit: 'g' },
  correctedErrorDown: { label: 'Corrected error (down)', unit: 'g' },
  judgedErrorUp: { label: 'Judged error (up)', unit: 'g' },
  judgedErrorDown: { label: 'Judged error (down)', unit: 'g' },
  errorBasis: { label: 'Error basis', unit: '' },
  rowPass: { label: 'Row pass', unit: '' },
  mpe: { label: 'MPE', unit: 'g' },
  mpeInE: { label: 'MPE (in e)', unit: 'e' },
  mpeInERange: { label: 'MPE band (in e)', unit: 'e' },
  nI: { label: 'nᵢ', unit: '' },
  verdict: { label: 'Row verdict', unit: '' },
  pass: { label: 'Within MPE', unit: '' },
  p: { label: 'P', unit: 'g' },
  overallPass: { label: 'Overall pass', unit: '' },
};

function derivedLabel(key: string): { label: string; unit: string } {
  return DERIVED_LABELS[key] ?? { label: key, unit: '' };
}

/** Computed rows live under `rows`, `trials` or `measurements` depending on form kind. */
function computedRows(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== 'object') return [];
  const res = result as Record<string, unknown>;
  for (const key of ['rows', 'trials', 'measurements']) {
    if (Array.isArray(res[key])) return res[key] as Array<Record<string, unknown>>;
  }
  return [];
}

/** Run-level scalar metrics worth a row in CALCULATED RESULTS (existing values only). */
function runMetrics(result: unknown): Array<[string, unknown, string]> {
  if (!result || typeof result !== 'object') return [];
  const res = result as Record<string, unknown>;
  const pick = (key: string, label: string, unit = ''): [string, unknown, string] | null => {
    const v = res[key];
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return null;
    return [label, v, unit];
  };
  const out: Array<[string, unknown, string]> = [];
  for (const entry of [
    pick('worstError', 'Worst absolute error', 'g'),
    pick('range', 'Range (max − min)', 'g'),
    pick('mpe', 'MPE', 'g'),
    pick('mpeInE', 'MPE (in e)', 'e'),
    pick('pMax', 'P max', 'g'),
    pick('pMin', 'P min', 'g'),
    pick('load', 'Test load', 'g'),
    pick('rowsEntered', 'Rows recorded', ''),
    pick('rowsTotal', 'Rows total', ''),
  ]) {
    if (entry) out.push(entry);
  }
  if (Array.isArray(res.failingRows) && (res.failingRows as unknown[]).length > 0) {
    out.push(['Rows outside MPE', (res.failingRows as unknown[]).join(', '), '']);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function buildCoverSheet(workbook: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = [{ width: 28 }, { width: 60 }];
  const title = sheet.addRow(['NAWI type-examination report']);
  styleTitleRow(sheet, title, 2);
  sheet.addRow([]);
  const p = model.project;
  const mfr = model.manufacturer as Record<string, unknown>;
  kv(sheet, 'Report number', p.report_no);
  kv(sheet, 'Task number', p.task_no);
  kv(sheet, 'DANAK number', p.danak_no);
  kv(sheet, 'Standard', p.standard_version);
  kv(sheet, 'Manufacturer', mfr.name);
  kv(sheet, 'Examination period', [p.examination_start_date, p.examination_end_date].filter(Boolean).map((d) => shortDate(String(d))).join(' to ') || '—');
  kv(sheet, 'Status', p.status);
  kv(sheet, 'Generated at', model.generatedAt);
  kv(sheet, 'Generated by', model.generatedBy);
  kv(sheet, 'Overall verdict', String(model.rollup.verdict).toUpperCase());
  sheet.addRow([]);
  sectionTitle(sheet, 'INSTRUMENTS', 2);
  for (const section of model.models) {
    const m = section.model;
    kv(sheet, 'Model', `${section.familyName ?? ''} · ${String(m.model_name)}`.replace(/^ · /, ''));
    kv(sheet, '  Max / Min / e / d', `${m.max_capacity} / ${m.min_capacity} / ${m.e_value} / ${m.d_value} g (n = ${m.n_intervals}, class ${m.accuracy_class})`);
    kv(sheet, '  Serial number', (m as Record<string, unknown>).serial_no ?? '—');
  }
  sheet.addRow([]);
  sectionTitle(sheet, 'TESTS IN THIS WORKBOOK', 2);
  const header = sheet.addRow(['Worksheet', 'Overall verdict']);
  styleHeaderRow(header);
  for (const section of model.models) {
    for (const run of section.runs) {
      const name = run.testType?.displayName ?? run.run.test_type_code;
      const row = sheet.addRow([name, String(run.verdict).toUpperCase()]);
      styleDataRow(row);
    }
  }
}

async function buildTestSheet(
  workbook: ExcelJS.Workbook,
  model: ReportModel,
  section: ReportModel['models'][number],
  run: EvaluatedRun,
  usedNames: Set<string>,
): Promise<void> {
  const displayName = run.testType?.displayName ?? run.run.test_type_code;
  const sheet = workbook.addWorksheet(sheetNameFor(displayName, usedNames));
  const r = run.run;

  // -- TEST DETAILS ---------------------------------------------------------
  sheet.columns = [{ width: 26 }, { width: 30 }, { width: 16 }];
  let title = sheet.addRow([`TEST — ${displayName}`]);
  styleTitleRow(sheet, title, 3);
  sheet.addRow([]);
  kv(sheet, 'Test name', displayName);
  kv(sheet, 'Test code', r.test_type_code);
  kv(sheet, 'Report sheet ref', run.testType?.reportSheetRef ?? '—');
  kv(sheet, 'Instrument / model', String(section.model.model_name));
  kv(sheet, 'Family', section.familyName);
  kv(sheet, 'Report number', model.project.report_no);
  kv(sheet, 'Task number', model.project.task_no);
  kv(sheet, 'Manufacturer', (model.manufacturer as Record<string, unknown>).name);
  kv(sheet, 'Standard', model.project.standard_version);
  kv(sheet, 'Technician', r.operator_name);
  kv(sheet, 'Date performed', r.date_performed ? shortDate(r.date_performed) : '—');
  kv(sheet, 'Time performed', r.time_performed);
  kv(sheet, 'Temperature (°C)', r.temperature_c ?? r.chamber_temp_c ?? r.room_temp_c);
  kv(sheet, 'Humidity (%)', r.humidity_pct);
  kv(sheet, 'Pressure (hPa)', r.barometric_hpa);
  kv(sheet, 'Test load (g)', r.test_load);
  sheet.addRow([]);

  // -- ENTERED VALUES / OBSERVATIONS (every stored value, nothing invented) --
  sectionTitle(sheet, 'ENTERED VALUES / OBSERVATIONS', 3);
  const observations = await getObservations(r.id);
  const activeCols = OBS_COLUMNS.filter((c) =>
    observations.some((o) => o[c.key] !== null && o[c.key] !== undefined && String(o[c.key]).trim() !== ''),
  );
  // Sequence + load are identifying even when other columns are empty.
  if (!activeCols.some((c) => c.key === 'sequence_no')) {
    activeCols.unshift(OBS_COLUMNS[0]!);
  }
  if (observations.length === 0) {
    sheet.addRow(['No observations recorded for this test.']);
  } else {
    const headerRow = sheet.addRow(activeCols.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)));
    styleHeaderRow(headerRow);
    for (const o of observations) {
      const row = sheet.addRow(activeCols.map((c) => fmt(o[c.key]) ?? ''));
      styleDataRow(row);
    }
    sheet.views = [{ state: 'frozen', ySplit: sheet.lastRow!.number - observations.length }];
  }
  sheet.addRow([]);

  // -- CALCULATED RESULTS (existing derived values only) --------------------
  sectionTitle(sheet, 'CALCULATED RESULTS', 3);
  const metrics = runMetrics(run.result);
  if (metrics.length === 0) {
    sheet.addRow(['No calculated results available for this test.']);
  } else {
    const headerRow = sheet.addRow(['Calculated parameter', 'Value', 'Unit']);
    styleHeaderRow(headerRow);
    for (const [label, value, unit] of metrics) {
      const row = sheet.addRow([label, fmt(value) ?? '', unit]);
      styleDataRow(row);
    }
  }
  const rows = computedRows(run.result);
  const derivedKeys = [...new Set(rows.flatMap((o) => Object.keys(o).filter((k) => !ENTERED_RESULT_KEYS.has(k) && o[k] !== null && o[k] !== undefined)))];
  if (rows.length > 0 && derivedKeys.length > 0) {
    sheet.addRow([]);
    const headerRow = sheet.addRow(['Seq.', ...derivedKeys.map((k) => {
      const { label, unit } = derivedLabel(k);
      return unit ? `${label} (${unit})` : label;
    })]);
    styleHeaderRow(headerRow);
    // Widen the sheet for per-row tables.
    while (sheet.columnCount < derivedKeys.length + 1) {
      sheet.getColumn(sheet.columnCount + 1).width = 18;
    }
    for (const o of rows) {
      const seq = (o.sequenceNo as number | undefined) ?? '';
      const row = sheet.addRow([seq, ...derivedKeys.map((k) => fmt(o[k]) ?? '')]);
      styleDataRow(row);
    }
  }
  sheet.addRow([]);

  // -- RESULT (existing verdict, never recomputed here) ----------------------
  sectionTitle(sheet, 'RESULT', 3);
  const verdictRow = sheet.addRow(['Verdict', String(run.verdict).toUpperCase()]);
  verdictRow.getCell(1).font = HEADER_FONT;
  verdictRow.getCell(2).font = { bold: true, size: 12 };
  styleDataRow(verdictRow);
  sheet.addRow([]);

  // -- REMARK (technician's own words, verbatim) ------------------------------
  sectionTitle(sheet, 'REMARK', 3);
  const remark = (r.remarks ?? '').trim();
  sheet.addRow(['Technician remark:', remark || 'No remark']);
  sheet.addRow([]);

  // -- PHOTOGRAPHIC EVIDENCE (captions only — images are never embedded) ------
  sectionTitle(sheet, 'PHOTOGRAPHIC EVIDENCE (NOT EMBEDDED)', 3);
  if (run.attachments.length === 0) {
    sheet.addRow(['No evidence photos attached to this test.']);
  } else {
    const headerRow = sheet.addRow(['File', 'Caption / remark']);
    styleHeaderRow(headerRow);
    for (const a of run.attachments) {
      const row = sheet.addRow([a.original_name ?? a.file_path, a.caption ?? 'No remark']);
      styleDataRow(row);
    }
  }

  // Columns 1–3 keep the widths set at the top of the sheet; per-row
  // calculated tables widen their own extra columns where they are built.
}

// ---------------------------------------------------------------------------
// Renderer (same contract as the HTML/DOCX renderers)
// ---------------------------------------------------------------------------

class XlsxRenderer {
  readonly format = 'xlsx' as const;

  async render(model: ReportModel): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = model.generatedBy;
    workbook.title = `Test Report ${model.project.report_no}`;
    workbook.subject = `Type examination test report ${model.project.report_no} (${model.project.standard_version} / OIML R76)`;
    workbook.created = new Date();

    buildCoverSheet(workbook, model);

    const usedNames = new Set<string>(['Report']);
    for (const section of model.models) {
      for (const run of section.runs) {
        // eslint-disable-next-line no-await-in-loop
        await buildTestSheet(workbook, model, section, run, usedNames);
      }
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

export const xlsxRenderer = new XlsxRenderer();
