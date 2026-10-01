/**
 * DOCX report renderer — the editable annex.
 *
 * Implements `IReportRenderer<Buffer>` (see `report.ts`) using the `docx` library:
 * pure TypeScript, no native binaries, no daemon. Consumes the same `ReportModel` as
 * the HTML renderer, so the Word file can never disagree with the print report — it
 * only re-presents it in editable form.
 *
 * Deliberate differences from the HTML renderer:
 * - No inline SVG charts. The error curve becomes a deviation summary table and the
 *   pan diagram becomes a native 3x3 position grid (per agy review) — the numbers are
 *   identical, only the figure type changes.
 * - Photos embed from the uploads originals (raw buffers, aspect-preserved) rather
 *   than data URIs; files over 4 MB, missing, or in formats Word handles poorly are
 *   replaced with an "Image unavailable" note, mirroring the HTML fallback.
 * - Text is raw Unicode: the `docx` library escapes XML itself, so nothing here is
 *   HTML-escaped (doing so would print literal `&amp;` in Word).
 *
 * One-way export only: the system database stays authoritative, edits in Word never
 * flow back. Not wired into `generateReport` yet — that is the next slice.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { parseJson } from '../db/index.ts';
import { config } from '../config.ts';
import { decimalsFor, eccentricityPositions, formatFixed, type PanShape } from '../domain.ts';
import type { AttachmentRow, EvaluatedRun } from './evaluation.ts';
import type {
  ChecklistModelRow,
  ModelSection,
  ReportModel,
  ReportVerification,
  SignatureModel,
} from './reportModel.ts';
import type { IReportRenderer, RenderOptions } from './report.ts';
import {
  REPORT_BASE_FONT,
  REPORT_BASE_SIZE_HALF_POINTS,
  REPORT_PAGE,
  verdictLabel,
} from './reportStyle.ts';

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

/** Placeholder for values never entered — raw text, never HTML. */
const EMPTY = '—';

function fmt(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return formatFixed(value, decimals);
}

function fmtSigned(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const text = formatFixed(Math.abs(value), decimals);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${text}`;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return EMPTY;
  const s = String(value);
  return s === '' ? EMPTY : s;
}

function verdictCell(verdict: string | null | undefined, widthTwips?: number): TableCell {
  // Plain bold word, no shading: the OIML form records PASS / FAIL as words.
  return new TableCell({
    width: widthTwips == null ? undefined : { size: widthTwips, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: verdictLabel(verdict),
            font: REPORT_BASE_FONT,
            size: REPORT_BASE_SIZE_HALF_POINTS,
            bold: true,
          }),
        ],
      }),
    ],
  });
}

/**
 * Standalone one-cell banner for the cover "Overall result" block.
 *
 * A full-width bordered cell with centred bold large type — the monochrome
 * equivalent of a verdict stamp. No tint: Word reflows are the reader's copy,
 * not a dashboard.
 */
function verdictBanner(verdict: string | null | undefined): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: CONTENT_TWIPS, type: WidthType.DXA },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: verdictLabel(verdict),
                    font: REPORT_BASE_FONT,
                    bold: true,
                    size: 36, // 18pt — prominent but restrained
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** The yes/no flag blobs as a readable list, mirroring the HTML `flagList`. */
function flagText(flags: Record<string, unknown>): string {
  const entries = Object.entries(flags).filter(([, v]) => v !== false && v !== null && v !== '');
  if (entries.length === 0) return EMPTY;
  return entries
    .map(([key, value]) => {
      const name = key.replace(/_/g, ' ');
      return value === true ? name : `${name}: ${String(value)}`;
    })
    .join(', ');
}

/** A block-level document element: text or table. Section builders return these. */
type DocxElement = Paragraph | Table;

function p(
  content: string,
  opts: { bold?: boolean; size?: number; italic?: boolean; color?: string; font?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {},
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    children: [
      new TextRun({
        text: content,
        font: opts.font ?? REPORT_BASE_FONT,
        size: opts.size ?? REPORT_BASE_SIZE_HALF_POINTS,
        bold: opts.bold,
        italics: opts.italic,
        color: opts.color,
      }),
    ],
  });
}

function heading(level: (typeof HeadingLevel)[keyof typeof HeadingLevel], content: string): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun({ text: content, font: REPORT_BASE_FONT })] });
}

function cell(
  content: string,
  opts: { bold?: boolean; header?: boolean; widthTwips?: number; color?: string; size?: number; font?: string } = {},
): TableCell {
  return new TableCell({
    shading: opts.header ? { fill: 'F3F4F6' } : undefined,
    width: opts.widthTwips == null ? undefined : { size: opts.widthTwips, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: content,
            font: opts.font ?? REPORT_BASE_FONT,
            size: opts.size ?? REPORT_BASE_SIZE_HALF_POINTS,
            bold: opts.bold ?? opts.header ?? false,
            color: opts.color,
          }),
        ],
      }),
    ],
  });
}

/** Usable text width on the contract page, for proportional column widths. */
const CONTENT_TWIPS =
  REPORT_PAGE.widthTwips - REPORT_PAGE.marginLeftTwips - REPORT_PAGE.marginRightTwips;

/** Two-column label/value table (the `.kv` tables in HTML). Rows never split across pages. */
function kvTable(rows: Array<[string, string]>): Table {
  const labelTwips = Math.round(CONTENT_TWIPS * 0.38);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          cantSplit: true,
          children: [cell(label, { bold: true, widthTwips: labelTwips }), cell(value)],
        }),
    ),
  });
}

/** Headed data table with a shaded, repeating header row (mirrors the print CSS). */
function dataTable(
  headers: string[],
  rows: Array<Array<string | TableCell>>,
  widthsTwips: Array<number | null> = [],
): Table {
  const at = (i: number): { widthTwips?: number } => {
    const w = widthsTwips[i];
    return w == null ? {} : { widthTwips: w };
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((h, i) => cell(h, { header: true, ...at(i) })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: r.map((v, i) => (typeof v === 'string' ? cell(v, at(i)) : v)),
          }),
      ),
    ],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

/**
 * Breathing room between back-to-back tables. Word stacks adjacent tables with no
 * gap at all, so every place this renderer puts two tables in a row needs one of
 * these between them — otherwise the borders touch and read as a single table.
 */
function gap(): Paragraph {
  return new Paragraph({ spacing: { after: 160 } });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_WIDTH_PX = 560;

type PhotoKind = 'png' | 'jpg' | 'gif';

function photoKind(mime: string | null, filePath: string): PhotoKind | null {
  // An explicit MIME type decides on its own: a container extension must not resurrect
  // a format Word handles poorly (e.g. webp served from a .png-named file).
  if (mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/gif') return 'gif';
    return null;
  }
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'gif') return 'gif';
  return null;
}

/** PNG IHDR dimensions (bytes 16-24, big-endian) or JPEG SOF frame size, else null. */
function probeDimensions(data: Buffer, kind: PhotoKind): { width: number; height: number } | null {
  try {
    if (kind === 'png' && data.length >= 24) {
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    } else if (kind === 'jpg') {
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) break;
        const marker = data[offset + 1];
        const length = data.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
          return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    /* fall through to default sizing */
  }
  return null;
}

export function photoParagraphs(attachments: AttachmentRow[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const a of attachments) {
    const absolute = path.isAbsolute(a.file_path)
      ? a.file_path
      : path.join(config.uploadsDir, a.file_path);
    const kind = photoKind(a.mime_type, a.file_path);
    let data: Buffer | null = null;
    try {
      if (kind && fs.existsSync(absolute) && fs.statSync(absolute).size < MAX_PHOTO_BYTES) {
        data = fs.readFileSync(absolute);
      }
    } catch {
      data = null;
    }
    const caption = a.caption ?? a.original_name ?? 'Test photograph';
    if (!data || !kind) {
      out.push(p(`Image unavailable: ${a.original_name ?? 'unknown file'}`, { italic: true }));
      continue;
    }
    const dims = probeDimensions(data, kind) ?? { width: 600, height: 400 };
    const scale = Math.min(1, MAX_PHOTO_WIDTH_PX / dims.width);
    out.push(
      new Paragraph({
        children: [
          new ImageRun({
            data,
            transformation: {
              width: Math.round(dims.width * scale),
              height: Math.round(dims.height * scale),
            },
            type: kind,
          }),
        ],
      }),
      p(caption, { italic: true, size: 18 }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-test-shape tables (data-complete, chart-free)
// ---------------------------------------------------------------------------

function weighingSection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as {
    rows: Array<Record<string, number | null | boolean | string>>;
    worstError: number | null;
    failingRows: number[];
    rowsEntered: number;
    rowsTotal: number;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const corrected = evaluated.testType?.code === 'ECC';
  const showDelta = r.rows.some((row) => row.deltaLUp != null || row.deltaLDown != null);
  const headers = ['Load L (g)', 'Ind. up (g)', 'Ind. down (g)'];
  if (showDelta) headers.push('ΔL up (g)', 'ΔL down (g)');
  headers.push('n(i)', 'E up (g)', 'E down (g)');
  if (corrected) headers.push('E(c) (g)');
  headers.push('MPE (g)', 'MPE', 'Result');
  const rows = r.rows.map((row) => {
    const cells: Array<string | TableCell> = [
      fmt(row.loadValue as number, dp),
      fmt(row.indicationUp as number | null, dp),
      fmt(row.indicationDown as number | null, dp),
    ];
    if (showDelta) {
      cells.push(fmt(row.deltaLUp as number | null, dp), fmt(row.deltaLDown as number | null, dp));
    }
    cells.push(
      fmt(row.nI as number, 0),
      fmtSigned(row.errorUp as number | null, dp),
      fmtSigned(row.errorDown as number | null, dp),
    );
    if (corrected) cells.push(fmtSigned(row.correctedErrorUp as number | null, dp));
    cells.push(
      `±${fmt(row.mpe as number, dp)}`,
      `${(row.mpeInE as number).toFixed(1)} e`,
      verdictCell(row.verdict as string),
    );
    return cells;
  });
  // Tabular fallback for the SVG error curve: the judged error per load against MPE.
  const deviations = r.rows.map((row) => {
    const up = (row.judgedErrorUp ?? row.errorUp) as number | null;
    const down = (row.judgedErrorDown ?? row.errorDown) as number | null;
    return [
      fmt(row.loadValue as number, dp),
      fmtSigned(up, dp),
      fmtSigned(down, dp),
      `±${fmt(row.mpe as number, dp)}`,
      verdictCell(row.verdict as string),
    ];
  });
  // Column widths follow the header count: the ΔL pair and the corrected-error
  // column come and go, so proportions are assigned by position, not hardcoded.
  const proportions = [0.13, 0.1, 0.1];
  if (showDelta) proportions.push(0.09, 0.09);
  proportions.push(0.08, 0.1, 0.1);
  if (corrected) proportions.push(0.09);
  proportions.push(0.1, 0.07, 0.12);
  const total = proportions.reduce((a, b) => a + b, 0);
  const mainWidths = proportions.map((p) => Math.round((CONTENT_TWIPS * p) / total));
  const devWidths = [0.22, 0.2, 0.2, 0.2, 0.18].map((p) => Math.round(CONTENT_TWIPS * p));

  return [
    p(`Error E = I + 1/2e${showDelta ? ' − ΔL' : ''} − L  |  n(i) = L / e — a row passes only if both loading directions are within MPE.`, {
      italic: true,
      size: 18,
    }),
    dataTable(headers, rows, mainWidths),
    p(
      `${r.rowsEntered} of ${r.rowsTotal} rows recorded. Largest absolute error ${fmt(r.worstError, dp)} g. ` +
        (r.failingRows.length > 0 ? `Rows outside MPE: ${r.failingRows.join(', ')}.` : 'All rows within MPE.'),
    ),
    heading(HeadingLevel.HEADING_3, 'Error against load (tabular)'),
    dataTable(['Load (g)', 'E up (g)', 'E down (g)', 'MPE (g)', 'Result'], deviations, devWidths),
  ];
}

function repeatabilitySection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as {
    trials: Array<{ sequenceNo: number; indication: number | null; p: number | null }>;
    indicationAtZero: number;
    pMax: number | null;
    pMin: number | null;
    range: number | null;
    mpe: number;
    mpeInE: number;
    label: string;
    load: number;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const widths = [0.12, 0.28, 0.3, 0.3].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    p(`P = I − I0  |  ${r.label}`, { italic: true, size: 18 }),
    dataTable(
      ['No.', 'Load (g)', 'Indication I (g)', 'P = I − I0 (g)'],
      r.trials.map((t) => [
        String(t.sequenceNo),
        fmt(r.load, dp),
        fmt(t.indication, dp),
        fmt(t.p, dp),
      ]),
      widths,
    ),
    gap(),
    kvTable([
      ['Zero / tare reading I0', `${formatFixed(r.indicationAtZero, dp)} g`],
      ['max(P)', r.pMax === null ? EMPTY : `${formatFixed(r.pMax, dp)} g`],
      ['min(P)', r.pMin === null ? EMPTY : `${formatFixed(r.pMin, dp)} g`],
      ['Range max(P) − min(P)', r.range === null ? EMPTY : `${formatFixed(r.range, dp)} g`],
      ['Tolerance (MPE at test load)', `${formatFixed(r.mpe, dp)} g (${r.mpeInE.toFixed(1)} e)`],
    ]),
  ];
}

/** Native 3x3 position grid: codes placed by domain geometry, verdicts in brackets. */
function panGrid(shape: string, rows: Array<Record<string, unknown>>): Table {
  const verdictByCode = new Map(rows.map((r) => [String(r.positionCode), String(r.verdict)]));
  const grid: string[][] = [
    [EMPTY, EMPTY, EMPTY],
    [EMPTY, EMPTY, EMPTY],
    [EMPTY, EMPTY, EMPTY],
  ];
  for (const position of eccentricityPositions(shape as PanShape)) {
    const col = position.x < 1 / 3 ? 0 : position.x < 2 / 3 ? 1 : 2;
    const rowIdx = position.y < 1 / 3 ? 0 : position.y < 2 / 3 ? 1 : 2;
    const verdict = verdictByCode.get(position.code);
    grid[rowIdx][col] =
      verdict === undefined ? position.code : `${position.code} (${verdictLabel(verdict)})`;
  }
  const colWidth = Math.round(CONTENT_TWIPS / 3);
  return dataTable(
    ['Left', 'Centre', 'Right'],
    grid,
    [colWidth, colWidth, CONTENT_TWIPS - 2 * colWidth],
  );
}

function eccentricitySection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as {
    rows: Array<Record<string, unknown>>;
    worstError: number | null;
    panShape: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const widths = [0.1, 0.28, 0.16, 0.16, 0.15, 0.15].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    p('Judged on corrected error E(c) = E − E(centre): position sensitivity, not absolute accuracy.', {
      italic: true,
      size: 18,
    }),
    panGrid(r.panShape, r.rows),
    gap(),
    dataTable(
      ['Pos.', 'Position', 'Ind. (g)', 'E(c) (g)', 'MPE (g)', 'Result'],
      r.rows.map((o) => [
        String(o.positionCode ?? ''),
        String(o.positionLabel ?? ''),
        fmt(o.indication as number | null, dp),
        fmtSigned(o.correctedError as number | null, dp),
        `±${fmt(o.mpe as number, dp)}`,
        verdictCell(o.verdict as string),
      ]),
      widths,
    ),
    p(`Largest absolute corrected error ${fmt(r.worstError, dp)} g.`),
  ];
}

function esdSection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as { rows: Array<Record<string, unknown>>; worstError: number | null };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const widths = [0.08, 0.08, 0.1, 0.1, 0.11, 0.11, 0.11, 0.11, 0.09, 0.11].map((p) =>
    Math.round(CONTENT_TWIPS * p),
  );
  return [
    p('Judged on the change in indication ΔI = I(after) − I(before). A change beyond MPE is a significant fault.', {
      italic: true,
      size: 18,
    }),
    dataTable(
      ['No.', 'kV', 'Mode', 'Polarity', 'Load (g)', 'Before (g)', 'After (g)', 'ΔI (g)', 'MPE (g)', 'Result'],
      r.rows.map((o) => [
        String(o.sequenceNo ?? ''),
        fmt(o.testVoltageKv as number, 1),
        String(o.applicationMode ?? ''),
        String(o.polarity ?? ''),
        fmt(o.loadValue as number, dp),
        fmt(o.indicationBefore as number | null, dp),
        fmt(o.indicationAfter as number | null, dp),
        fmtSigned(o.error as number | null, dp),
        `±${fmt(o.mpe as number, dp)}`,
        verdictCell(o.verdict as string),
      ]),
      widths,
    ),
    p(`Largest absolute change in indication ${fmt(r.worstError, dp)} g.`),
  ];
}

function radiatedSection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as { rows: Array<Record<string, unknown>>; worstError: number | null };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const widths = [0.08, 0.12, 0.1, 0.11, 0.11, 0.11, 0.11, 0.09, 0.12].map((p) =>
    Math.round(CONTENT_TWIPS * p),
  );
  return [
    p('Judged on the change in indication ΔI = I(after) − I(before) at each frequency step. A change beyond MPE is a significant fault.', {
      italic: true,
      size: 18,
    }),
    dataTable(
      ['No.', 'Freq. (MHz)', 'Field (V/m)', 'Load (g)', 'Before (g)', 'After (g)', 'ΔI (g)', 'MPE (g)', 'Result'],
      r.rows.map((o) => [
        String(o.sequenceNo ?? ''),
        fmt(o.frequencyMhz as number | null, 0),
        fmt(o.fieldStrengthVM as number | null, 1),
        fmt(o.loadValue as number, dp),
        fmt(o.indicationBefore as number | null, dp),
        fmt(o.indicationAfter as number | null, dp),
        fmtSigned(o.error as number | null, dp),
        `±${fmt(o.mpe as number, dp)}`,
        verdictCell(o.verdict as string),
      ]),
      widths,
    ),
    p(`Largest absolute change in indication ${fmt(r.worstError, dp)} g.`),
  ];
}

function spanSection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as {
    rows: Array<Record<string, unknown>>;
    range: number | null;
    mpd: number;
    label: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const widths = [0.08, 0.2, 0.18, 0.14, 0.14, 0.13, 0.13].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    p(`${r.label} — the tolerance is an absolute value on the instrument model, not a multiple of e.`, {
      italic: true,
      size: 18,
    }),
    dataTable(
      ['No.', 'Condition', 'Date', 'Load (g)', 'Ind. (g)', 'E (g)', 'E(c) (g)'],
      r.rows.map((o) => [
        String(o.sequenceNo ?? ''),
        String(o.condition ?? ''),
        String(o.measuredAt ?? ''),
        fmt(o.loadValue as number, dp),
        fmt(o.indication as number | null, dp),
        fmtSigned(o.error as number | null, dp),
        fmtSigned(o.correctedError as number | null, dp),
      ]),
      widths,
    ),
    gap(),
    kvTable([
      ['Range of corrected error', r.range === null ? EMPTY : `${formatFixed(r.range, dp)} g`],
      ['Tolerance (mpd)', `${formatFixed(r.mpd, dp)} g`],
    ]),
  ];
}

function equilibriumSection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as {
    trials: Array<{ sequenceNo: number; indication: number | null; deviation: number | null }>;
    load: number;
    spread: number | null;
    tolerance: number;
    toleranceInE: number;
    label: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const widths = [0.12, 0.28, 0.3, 0.3].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    p(`Judged on the spread of the set, not on any single reading  |  ${r.label}`, { italic: true, size: 18 }),
    dataTable(
      ['No.', 'Load (g)', 'Indication I (g)', 'Deviation from mean (g)'],
      r.trials.map((t) => [
        String(t.sequenceNo),
        fmt(r.load, dp),
        fmt(t.indication, dp),
        fmtSigned(t.deviation, dp),
      ]),
      widths,
    ),
    gap(),
    kvTable([
      ['Spread across readings', r.spread === null ? EMPTY : `${formatFixed(r.spread, dp)} g`],
      ['Tolerance', `${formatFixed(r.tolerance, dp)} g (${r.toleranceInE.toFixed(1)} e)`],
    ]),
  ];
}

function zeroCreepSection(evaluated: EvaluatedRun): DocxElement[] {
  const r = evaluated.result as {
    rows: Array<{ sequenceNo: number; condition: string; measuredAt: string | null; loadValue: number; indication: number | null }>;
    zeroResidual: number | null;
    zeroTolerance: number;
    zeroPass: boolean;
    creepRange: number | null;
    creepTolerance: number;
    creepPass: boolean;
    zeroLabel: string;
    creepLabel: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const zeroRow = (o: (typeof r.rows)[number]): boolean =>
    o.loadValue === 0 || /^zero\b/i.test(String(o.condition ?? '').trim());
  const widths = [0.08, 0.22, 0.22, 0.16, 0.16, 0.16].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    p(`${r.zeroLabel}  |  ${r.creepLabel}`, { italic: true, size: 18 }),
    dataTable(
      ['No.', 'Step', 'Date', 'Load (g)', 'Indication (g)', 'Phase'],
      r.rows.map((o) => [
        String(o.sequenceNo),
        String(o.condition ?? ''),
        String(o.measuredAt ?? ''),
        fmt(o.loadValue, dp),
        fmt(o.indication, dp),
        zeroRow(o) ? 'Zero return' : 'Creep',
      ]),
      widths,
    ),
    gap(),
    kvTable([
      ['Zero residual (unloaded)', r.zeroResidual === null ? EMPTY : `${formatFixed(r.zeroResidual, dp)} g`],
      ['Zero tolerance', `${formatFixed(r.zeroTolerance, dp)} g`],
      ['Zero check', r.zeroPass ? 'PASS' : 'FAIL'],
      ['Creep range across hold', r.creepRange === null ? EMPTY : `${formatFixed(r.creepRange, dp)} g`],
      ['Creep tolerance', `${formatFixed(r.creepTolerance, dp)} g`],
      ['Creep check', r.creepPass ? 'PASS' : 'FAIL'],
    ]),
  ];
}

function testBody(evaluated: EvaluatedRun): DocxElement[] {
  switch (evaluated.formKind) {
    case 'weighing_performance':
      return weighingSection(evaluated);
    case 'repeatability':
      return repeatabilitySection(evaluated);
    case 'eccentricity':
      return eccentricitySection(evaluated);
    case 'esd':
      return esdSection(evaluated);
    case 'radiated':
      return radiatedSection(evaluated);
    case 'span_stability':
      return spanSection(evaluated);
    case 'equilibrium':
      return equilibriumSection(evaluated);
    case 'zero_creep':
      return zeroCreepSection(evaluated);
    default:
      return [
        p(
          'This test is defined in the applicable standard but has no data-entry form in this build, so no measurements are recorded.',
          { italic: true },
        ),
      ];
  }
}

// ---------------------------------------------------------------------------
// Document sections
// ---------------------------------------------------------------------------

function coverSection(model: ReportModel): DocxElement[] {
  const { project, manufacturer, rollup } = model;
  const m = manufacturer as Record<string, { toString(): string } | null | undefined>;
  const str = (v: unknown): string => (v === null || v === undefined ? EMPTY : String(v));
  const period = [project.examination_start_date, project.examination_end_date].filter(Boolean).join(' to ');
  const instWidths = [0.18, 0.22, 0.12, 0.12, 0.12, 0.1, 0.14].map((p) =>
    Math.round(CONTENT_TWIPS * p),
  );
  return [
    // Official masthead: sized hierarchy (16pt / 11pt / 11pt / 13pt), centred,
    // with a horizontal rule below the laboratory line mirroring the HTML header.
    p('GOVERNMENT OF INDIA', { bold: true, size: 32, align: AlignmentType.CENTER }),
    p('MINISTRY OF CONSUMER AFFAIRS, FOOD & PUBLIC DISTRIBUTION', { bold: true, size: 22, align: AlignmentType.CENTER }),
    p('DEPARTMENT OF CONSUMER AFFAIRS', { bold: true, size: 22, align: AlignmentType.CENTER }),
    p('LEGAL METROLOGY LABORATORY', { bold: true, size: 26, align: AlignmentType.CENTER }),
    new Paragraph({ thematicBreak: true }),
    p('OIML R 76-2 · Type Examination Test Report', { size: 20 }),
    heading(HeadingLevel.HEADING_1, 'Non-Automatic Weighing Instrument'),
    p(`Conducted in accordance with ${project.standard_version} / OIML R76.`),
    heading(HeadingLevel.HEADING_2, '1  Report identification'),
    kvTable([
      ['Report number', project.report_no],
      ['Application / Task number', project.task_no],
      ['DANAK number', text(project.danak_no)],
      ['Applicable standard', project.standard_version],
      ['Examination period', period === '' ? EMPTY : period],
      ['Project status', project.status],
    ]),
    heading(HeadingLevel.HEADING_2, '2  General information concerning the type'),
    kvTable([
      ['Name', str(m.name)],
      ['Address', str(m.address)],
      ['Contact person', str(m.contact_person)],
      ['E-mail', str(m.email)],
      ['Telephone', str(m.phone)],
    ]),
    heading(HeadingLevel.HEADING_2, 'Instruments covered (type designation)'),
    dataTable(
      ['Family', 'Model', 'Max', 'e', 'n', 'Class', 'Result'],
      rollup.models.map((entry) => {
        const family = model.models.find((s) => s.model.id === entry.model.id)?.familyName;
        return [
          family ?? EMPTY,
          entry.model.model_name,
          `${entry.model.max_capacity} g`,
          `${entry.model.e_value} g`,
          String(entry.model.n_intervals),
          entry.model.accuracy_class,
          verdictCell(entry.verdict),
        ];
      }),
      instWidths,
    ),
    p('Instrument class: ☐ Self-indicating   ☐ Semi-self-indicating   ☐ Non-self-indicating', {
      size: 18,
    }),
    heading(HeadingLevel.HEADING_2, 'Overall result'),
    verdictBanner(rollup.verdict),
    p(`${rollup.passCount} of ${rollup.testCount} tests passed · ${rollup.failCount} failed · ${rollup.incompleteCount} incomplete.`),
    p(
      `Generated ${model.generatedAt} by ${model.generatedBy}. All errors, tolerances and verdicts in this report are computed from the recorded measurements at generation time.`,
      { italic: true, size: 18 },
    ),
  ];
}

function checklistSection(checklist: ChecklistModelRow[], standardVersion: string): DocxElement[] {
  if (checklist.length === 0) return [];
  const out: Paragraph[] = [
    pageBreak(),
    heading(HeadingLevel.HEADING_1, 'Checklist of Descriptive Markings and Devices'),
    p(`Clause references are to ${standardVersion}.`, { italic: true, size: 18 }),
  ];
  const widths = [0.11, 0.47, 0.07, 0.07, 0.07, 0.21].map((p) => Math.round(CONTENT_TWIPS * p));
  let lastCategory: string | null = null;
  let group: ChecklistModelRow[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    out.push(heading(HeadingLevel.HEADING_2, group[0].category ?? 'Other'));
    out.push(
      dataTable(
        ['Clause', 'Requirement / Examination', 'Yes', 'No', 'N/A', 'Remarks'],
        group.map((r) => {
          const status = r.status ?? 'na';
          return [
            r.clause_no,
            r.description,
            status === 'pass' ? 'X' : '',
            status === 'fail' ? 'X' : '',
            status !== 'pass' && status !== 'fail' ? 'X' : '',
            r.remarks ?? '',
          ];
        }),
        widths,
      ),
    );
    group = [];
  };
  for (const row of checklist) {
    if (row.category !== lastCategory) {
      flush();
      lastCategory = row.category;
    }
    group.push(row);
  }
  flush();
  return out;
}

function modelInfoSection(section: ModelSection): DocxElement[] {
  const m = section.model;
  const dpED = decimalsFor(m.e_value as number, m.d_value as number);
  const rangeWidths = [0.14, 0.17, 0.17, 0.17, 0.17, 0.18].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    heading(HeadingLevel.HEADING_2, `Metrological Characteristics — ${m.model_name}`),
    dataTable(
      ['Range', 'Min', 'Max', 'e', 'd', 'n = Max / e'],
      [[
        '1',
        `${fmt(m.min_capacity as number, dpED)} g`,
        `${fmt(m.max_capacity as number, dpED)} g`,
        `${fmt(m.e_value as number, dpED)} g`,
        `${fmt(m.d_value as number, dpED)} g`,
        fmt(m.n_intervals as number, 0),
      ]],
      rangeWidths,
    ),
    gap(),
    kvTable([
      ['Accuracy class', m.accuracy_class],
      ['Fractional factor, pi', text(m.fractional_factor_pi)],
      ['Span stability tolerance, mpd', `${text(m.mpd_span_stability)} g`],
      ['Serial number', text(m.serial_no)],
    ]),
    heading(HeadingLevel.HEADING_3, 'Rated operating conditions'),
    kvTable([
      ['Temperature range', `${m.operating_temp_min ?? '?'} to ${m.operating_temp_max ?? '?'} °C`],
      ['AC supply', m.power_ac_nominal_v === null ? EMPTY : `${m.power_ac_nominal_v} V (${m.power_ac_min_v}–${m.power_ac_max_v} V)`],
      ['DC supply', m.power_dc_nominal_v === null ? EMPTY : `${m.power_dc_nominal_v} V (${m.power_dc_min_v}–${m.power_dc_max_v} V)`],
      ['Load receptor', String(m.pan_shape).replace(/_/g, ' ')],
    ]),
  ];
}

function constructionSection(section: ModelSection): DocxElement[] {
  const m = section.model;
  const zero = parseJson<Record<string, unknown>>(m.zero_setting_types as string, {});
  const tare = parseJson<Record<string, unknown>>(m.tare_types as string, {});
  return [
    heading(HeadingLevel.HEADING_2, `Construction Examination — ${m.model_name}`),
    heading(HeadingLevel.HEADING_3, 'Load cell'),
    kvTable([
      ['Type', text(m.load_cell_type)],
      ['Manufacturer', text(m.load_cell_manufacturer)],
      ['Capacity', text(m.load_cell_capacity)],
      ['Rated output', m.load_cell_rated_output_mvv === null ? EMPTY : `${m.load_cell_rated_output_mvv} mV/V`],
      ['Min. input impedance', m.load_cell_min_impedance_ohm === null ? EMPTY : `${m.load_cell_min_impedance_ohm} Ω`],
    ]),
    heading(HeadingLevel.HEADING_3, 'Zero-setting and tare devices'),
    kvTable([
      ['Zero-setting devices', flagText(zero)],
      ['Tare devices', flagText(tare)],
      ['Maximum tare effect', m.max_tare_pct === null ? EMPTY : `${m.max_tare_pct} % of Max`],
    ]),
    ...(section.modelPhotos.length > 0
      ? [
          heading(HeadingLevel.HEADING_3, 'Instrument and markings'),
          ...photoParagraphs(section.modelPhotos),
        ]
      : []),
  ];
}

function summarySection(section: ModelSection, standardVersion: string): DocxElement[] {
  const performed = section.summary.filter((e) => e.implemented && e.testRunId !== null);
  const widths = [0.6, 0.14, 0.26].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    heading(HeadingLevel.HEADING_2, `Summary of Type Evaluation — ${section.model.model_name}`),
    p('Rolled up from the recorded measurements. Nothing in this table is entered by hand.', {
      italic: true,
      size: 18,
    }),
    dataTable(
      ['Test / Examination', 'Result', 'Remarks'],
      section.summary.map((e) => {
        const done = e.implemented && e.testRunId !== null;
        const result =
          !e.implemented || e.testRunId === null
            ? 'N/A'
            : e.verdict === 'pass'
              ? 'PASS'
              : e.verdict === 'fail'
                ? 'FAIL'
                : 'INCOMPLETE';
        const remarks = !done
          ? 'Not performed'
          : e.rowsEntered === null
            ? ''
            : `${e.rowsEntered}/${e.rowsTotal} rows recorded`;
        return [`${e.reportSheetRef}  ${e.displayName}`, result, remarks];
      }),
      widths,
    ),
    p(
      `${performed.length} test${performed.length === 1 ? '' : 's'} performed of ${section.summary.length} defined for ${standardVersion}. ` +
        'Tests marked N/A are within the scope of the standard but were not recorded in this examination.',
    ),
  ];
}

function equipmentSection(section: ModelSection): DocxElement[] {
  const conditions = section.runs
    .filter((r) => r.run.date_performed || r.run.temperature_c !== null)
    .map((r) => [
      r.testType?.reportSheetRef ?? '',
      r.testType?.displayName ?? '',
      `${r.run.date_performed ?? ''} ${r.run.time_performed ?? ''}`.trim(),
      r.run.temperature_c === null ? EMPTY : `${r.run.temperature_c} °C`,
      r.run.humidity_pct === null ? EMPTY : `${r.run.humidity_pct} %`,
      r.run.operator_name ?? '',
    ]);
  const condWidths = [0.11, 0.31, 0.2, 0.11, 0.11, 0.16].map((p) => Math.round(CONTENT_TWIPS * p));
  const equipWidths = [0.07, 0.39, 0.24, 0.3].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    heading(HeadingLevel.HEADING_2, `Test Equipment — ${section.model.model_name}`),
    section.referenceWeights.length > 0
      ? dataTable(
          ['No.', 'Equipment', 'Manufacturer / Type', 'Identification / Traceability'],
          section.referenceWeights.map((v, i) => [
            String(i + 1),
            `Reference weight, ${v} g`,
            'Class E2/F1',
            'Calibration certificates held on file',
          ]),
          equipWidths,
        )
      : p('No equipment recorded.', { italic: true }),
    heading(HeadingLevel.HEADING_3, 'Environmental conditions per test'),
    conditions.length > 0
      ? dataTable(['Sheet', 'Test', 'Date / time', 'Temp.', 'RH', 'Operator'], conditions, condWidths)
      : p('No conditions recorded.', { italic: true }),
    p('Reference weights traceable to national standards. Calibration certificates are held on file with this examination record.'),
  ];
}

/** Checkbox evaluation line. Unicode boxes print in HTML; Word falls back to [X]/[ ]. */
function evalParagraph(verdict: string | null | undefined): Paragraph {
  const pass = verdict === 'pass' ? '☑' : '☐';
  const fail = verdict === 'fail' ? '☑' : '☐';
  return p(`Result:  ${pass} PASS   ${fail} FAIL`, { bold: true });
}

function testRunSection(section: ModelSection, evaluated: EvaluatedRun): DocxElement[] {
  const m = section.model;
  const run = evaluated.run;
  const family = section.familyName;
  const condWidths = [0.4, 0.2, 0.2, 0.2].map((p) => Math.round(CONTENT_TWIPS * p));
  const cond = (v: unknown, unit = ''): string => {
    if (v === null || v === undefined || v === '') return EMPTY;
    return `${String(v)}${unit ? ` ${unit}` : ''}`;
  };
  return [
    heading(
      HeadingLevel.HEADING_2,
      `${evaluated.testType?.reportSheetRef ?? ''}  ${evaluated.testType?.displayName ?? run.test_type_code}`,
    ),
    heading(HeadingLevel.HEADING_3, 'Test identification'),
    kvTable([
      ['Instrument', m.model_name],
      ['Type / Family', family ?? m.model_name],
      ['Serial No.', text(m.serial_no)],
      ['Range', `Max ${m.max_capacity} g / Min ${m.min_capacity} g, e = ${m.e_value} g`],
      ['Test date', `${run.date_performed ?? ''} ${run.time_performed ?? ''}`.trim() || EMPTY],
      ['Operator', text(run.operator_name)],
    ]),
    heading(HeadingLevel.HEADING_3, 'Test conditions'),
    dataTable(
      ['Condition', 'At start', 'At max', 'At end'],
      [
        ['Temp.', cond(run.temperature_c, '°C'), cond(run.chamber_temp_c, '°C'), cond(run.room_temp_c, '°C')],
        ['Rel. h.', cond(run.humidity_pct, '%'), EMPTY, EMPTY],
        ['Time', cond(run.time_performed), EMPTY, EMPTY],
        ['Bar. pres.', cond(run.barometric_hpa, 'hPa'), EMPTY, EMPTY],
      ],
      condWidths,
    ),
    ...(evaluated.testType?.description ? [p(evaluated.testType.description, { italic: true, size: 18 })] : []),
    heading(HeadingLevel.HEADING_3, 'Test results'),
    ...testBody(evaluated),
    heading(HeadingLevel.HEADING_3, 'Evaluation'),
    evalParagraph(evaluated.verdict),
    heading(HeadingLevel.HEADING_3, 'Remarks'),
    ...(run.remarks ? [p(run.remarks)] : [p('_'.repeat(72)), p('_'.repeat(72))]),
    ...(evaluated.attachments.length > 0
      ? [heading(HeadingLevel.HEADING_3, 'Photographic evidence'), ...photoParagraphs(evaluated.attachments)]
      : []),
  ];
}

function modelSection(section: ModelSection, standardVersion: string): DocxElement[] {
  // One form per page, mirroring the HTML sheets: the two renderers number and
  // break at the same points, so the DOCX paginates like the print/PDF output.
  // (Word still reflows text with its own metrics, so a form that overflows one
  // page in either renderer continues on the next — the guarantee is same breaks,
  // not identical page counts under overflow.)
  return [
    pageBreak(),
    ...summarySection(section, standardVersion),
    pageBreak(),
    ...modelInfoSection(section),
    pageBreak(),
    ...equipmentSection(section),
    ...section.runs.flatMap((evaluated) => [pageBreak(), ...testRunSection(section, evaluated)]),
    pageBreak(),
    ...constructionSection(section),
  ];
}

/**
 * One signature block: open vertical space, a ruled line to sign on, then the
 * printed name, title and date below — mirroring the HTML signature grid.
 */
function signatureCell(name: string, title: string, date: string, imagePath?: string | null): TableCell {
  const small = (content: string, bold = false): Paragraph =>
    new Paragraph({
      children: [
        new TextRun({ text: content, font: REPORT_BASE_FONT, size: 18, bold: bold || undefined }),
      ],
    });
  // Uploaded signature, aspect-preserved inside a fixed-height slot. The slot is
  // identical (exact 900-twips line) with or without an image, so the ruled lines
  // — and the names beneath them — sit level across both signature blocks no
  // matter what shape the uploaded image is. Same fallback rules as photos.
  // The image paragraph doubles as the slot: one exact-height paragraph that
  // holds the image when there is one and stays empty otherwise.
  let slot = new Paragraph({
    spacing: { line: 900, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: '' })],
  });
  if (imagePath) {
    const absolute = path.isAbsolute(imagePath) ? imagePath : path.join(config.uploadsDir, imagePath);
    const kind = photoKind(null, imagePath);
    try {
      if (kind && fs.existsSync(absolute) && fs.statSync(absolute).size < MAX_PHOTO_BYTES) {
        const data = fs.readFileSync(absolute);
        const dims = probeDimensions(data, kind) ?? { width: 300, height: 100 };
        const scale = Math.min(1, 220 / dims.width, 60 / dims.height);
        slot = new Paragraph({
          spacing: { line: 900, lineRule: LineRuleType.EXACT },
          children: [
            new ImageRun({
              data,
              transformation: {
                width: Math.round(dims.width * scale),
                height: Math.round(dims.height * scale),
              },
              type: kind,
            }),
          ],
        });
      }
    } catch {
      /* ignored: the ruled line below still stands */
    }
  }
  return new TableCell({
    width: { size: CONTENT_TWIPS, type: WidthType.DXA },
    children: [
      // Room for a wet signature above the rule.
      new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: '' })] }),
      slot,
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } },
        spacing: { after: 80 },
        children: [new TextRun({ text: '' })],
      }),
      small(name, true),
      small(title),
      ...(date ? [small(date)] : []),
    ],
  });
}

/**
 * Verification block: a bordered two-cell table pairing the QR code with the
 * issuing authority and integrity details — mirroring the HTML `.verify` block.
 * Rendered only for approved projects, where `model.verification` exists.
 */
function verificationTable(verification: ReportVerification): Table {
  const line = (content: string, opts: { bold?: boolean; size?: number } = {}): Paragraph =>
    new Paragraph({
      children: [
        new TextRun({
          text: content,
          font: REPORT_BASE_FONT,
          size: opts.size ?? REPORT_BASE_SIZE_HALF_POINTS,
          bold: opts.bold || undefined,
        }),
      ],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 2600, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [
                  new ImageRun({
                    data: verification.qrBuffer,
                    transformation: { width: 150, height: 150 },
                    type: 'png',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            children: [
              line('Scan QR on phone to verify report integrity', { bold: true }),
              line('OR open the link below in your browser'),
              line(verification.verifyUrl, { size: 18 }),
              line('Government of India — Legal Metrology Division'),
            ],
          }),
        ],
      }),
    ],
  });
}

function conclusionSection(
  model: ReportModel,
  signature: SignatureModel | null,
): DocxElement[] {
  const { project, rollup } = model;
  const plural = rollup.models.length !== 1;
  const notice =
    rollup.verdict === 'fail'
      ? `One or more tests fell outside the maximum permissible error. The instrument does not meet the requirements of ${project.standard_version} as tested.`
      : rollup.verdict === 'incomplete'
        ? 'Some tests within the scope of this examination have not been completed. This report is not a final statement of conformity.'
        : null;
  const widths = [0.5, 0.25, 0.25].map((p) => Math.round(CONTENT_TWIPS * p));
  return [
    pageBreak(),
    heading(HeadingLevel.HEADING_1, 'Conclusion'),
    p(
      `The instrument${plural ? 's' : ''} described in this report ${plural ? 'were' : 'was'} examined against ${project.standard_version}. ` +
        `${rollup.passCount} of ${rollup.testCount} recorded tests met the requirements of the standard` +
        (rollup.failCount > 0 ? `, and ${rollup.failCount} did not` : '') +
        (rollup.incompleteCount > 0 ? `; ${rollup.incompleteCount} remain incomplete` : '') +
        '.',
    ),
    p(`Overall result: ${verdictLabel(rollup.verdict)}`, { bold: true }),
    ...(notice ? [p(notice, { italic: true })] : []),
    dataTable(
      ['Model', 'Tests passed', 'Result'],
      rollup.models.map((m) => {
        const performed = m.summary.filter((e) => e.implemented && e.testRunId !== null);
        return [
          m.model.model_name,
          `${performed.filter((e) => e.verdict === 'pass').length} / ${performed.length}`,
          verdictCell(m.verdict),
        ];
      }),
      widths,
    ),
    gap(),
    heading(HeadingLevel.HEADING_3, 'Signature'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            signatureCell(
              signature?.signed_by_name ?? '',
              signature?.signed_by_title ?? 'Responsible for the examination',
              signature?.signed_at ?? '',
              signature?.signature_image_path ?? null,
            ),
          ],
        }),
      ],
    }),
    ...(model.verification ? [gap(), verificationTable(model.verification)] : []),
    p(
      `Report ${project.report_no} · generated ${model.generatedAt} · ${rollup.testCount} tests evaluated. ` +
        `This document was produced from the recorded measurements; the pass/fail decisions were computed from ${project.standard_version} rather than entered by an operator.`,
      { italic: true, size: 18 },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class DocxRenderer implements IReportRenderer<Buffer> {
  readonly format = 'docx' as const;

  async render(model: ReportModel, _options: RenderOptions = {}): Promise<Buffer> {
    const children: DocxElement[] = [
      ...coverSection(model),
      ...model.models.flatMap((section) => modelSection(section, model.project.standard_version)),
      ...checklistSection(model.checklist, model.project.standard_version),
      ...conclusionSection(model, model.signature),
    ];
    const reportHeader = new Header({
      children: [
        new Paragraph({
          alignment: 1 /* CENTER */,
          children: [
            new TextRun({ text: `OIML R 76-2 · Report ${model.project.report_no} · ${model.project.task_no} · ${model.project.standard_version}`, size: 18 }),
          ],
        }),
      ],
    });
    const reportFooter = new Footer({
      children: [
        new Paragraph({
          alignment: 1 /* CENTER */,
          children: [
            new TextRun({ text: 'Report page ', size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
            new TextRun({ text: ' of ', size: 18 }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 }),
            new TextRun({ text: ` · generated ${model.generatedAt}`, size: 18 }),
          ],
        }),
      ],
    });
    const doc = new Document({
      creator: model.generatedBy,
      title: `Test Report ${model.project.report_no}`,
      description: `Type examination test report ${model.project.report_no} (${model.project.standard_version} / OIML R76). Editable annex; the system database stays authoritative.`,
      defaultTabStop: 720,
      styles: {
        default: {
          document: {
            run: { font: REPORT_BASE_FONT, size: REPORT_BASE_SIZE_HALF_POINTS },
            paragraph: { spacing: { after: 80 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: REPORT_PAGE.widthTwips, height: REPORT_PAGE.heightTwips },
              margin: {
                top: REPORT_PAGE.marginTopTwips,
                right: REPORT_PAGE.marginRightTwips,
                bottom: REPORT_PAGE.marginBottomTwips,
                left: REPORT_PAGE.marginLeftTwips,
                header: 480,
                footer: 480,
              },
            },
          },
          headers: { default: reportHeader },
          footers: { default: reportFooter },
          children,
        },
      ],
    });
    return Packer.toBuffer(doc);
  }
}

export const docxRenderer = new DocxRenderer();
