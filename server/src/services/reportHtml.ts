/**
 * HTML report renderer.
 *
 * Implements `IReportRenderer` (see `report.ts`) for the print-styled, paginated HTML
 * document in the DELTA workbook section order: cover, checklist, then per model a
 * title page, summary of results, instrument information, equipment list, photos, and
 * one section per test — ending with the signature block.
 *
 * This module does no database access: every value comes from the `ReportModel`
 * (see `reportModel.ts`), which itself only re-presents `evaluation.ts` verdicts.
 * The CSS is written for paper (`@page` A4, repeating table headers), so the
 * browser's Save-as-PDF and headless Puppeteer produce the identical layout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseJson } from '../db/index.ts';
import { config } from '../config.ts';
import {
  decimalsFor,
  eccentricityPositions,
  formatFixed,
  type PanShape,
  type Verdict,
} from '../domain.ts';
import type {
  AttachmentRow,
  EvaluatedRun,
  ModelRow,
  ProjectRollup,
  SummaryEntry,
} from './evaluation.ts';
import type { ChecklistModelRow, ReportModel, SignatureModel } from './reportModel.ts';
import type { IReportRenderer, RenderOptions } from './report.ts';
import { verdictLabel } from './reportStyle.ts';

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** Escape text for HTML. Applied to every interpolated value, including database text. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An em-dash for values that were never entered, so blanks are visibly deliberate. */
const EMPTY = '&mdash;';

function fmt(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return esc(formatFixed(value, decimals));
}

/** Signed presentation, because the sign of an error is the whole point of the column. */
function fmtSigned(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const text = formatFixed(Math.abs(value), decimals);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return esc(`${sign}${text}`);
}

/**
 * Formal verdict word: bold plain text, never a coloured badge. The OIML form records
 * PASS / FAIL / INCOMPLETE / NOT PERFORMED as words; decoration would turn a legal
 * record into a dashboard.
 */
function verdictText(verdict: Verdict | 'not_started' | string | null | undefined): string {
  // The word comes from the shared contract; this renderer adds no decoration.
  return `<strong>${verdictLabel(verdict)}</strong>`;
}

/**
 * Ticked/unticked box pair for the evaluation area of a test form. Unicode ballot
 * boxes print reliably in browsers; the DOCX renderer falls back to [X]/[ ].
 */
function evalBoxes(verdict: string | null | undefined): string {
  const pass = verdict === 'pass' ? '&#9745;' : '&#9744;';
  const fail = verdict === 'fail' ? '&#9745;' : '&#9744;';
  return `<div class="evalbox">Result: &nbsp; ${pass} PASS &nbsp;&nbsp; ${fail} FAIL</div>`;
}

function row(label: string, value: unknown, unit = ''): string {
  const text = value === null || value === undefined || value === '' ? EMPTY : esc(value);
  return `<tr><th>${esc(label)}</th><td>${text}${unit && text !== EMPTY ? ` ${esc(unit)}` : ''}</td></tr>`;
}

/** Render the yes/no flag blobs as a readable list rather than raw JSON. */
function flagList(flags: Record<string, unknown>): string {
  const entries = Object.entries(flags).filter(([, v]) => v !== false && v !== null && v !== '');
  if (entries.length === 0) return EMPTY;
  return entries
    .map(([key, value]) => {
      const name = esc(key.replace(/_/g, ' '));
      return value === true ? name : `${name}: ${esc(value)}`;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

const STYLES = `
:root { color-scheme: light; --ink:#000; --muted:#333; --line:#000; --headbg:#f0f0f0; }
* { box-sizing: border-box; }
html { background:#e5e7eb; }
body { margin:0; font-family: "Helvetica Neue", Arial, sans-serif; font-size:9pt; line-height:1.35; color:var(--ink); }

/* Each sheet is one OIML form page: bordered on screen, plain paginated output on paper. */
.sheet { background:#fff; width:210mm; min-height:297mm; padding:14mm 14mm 16mm; margin:6mm auto; border:.75pt solid var(--ink); position:relative; }
.sheet + .sheet { page-break-before: always; }

h1 { font-size:15pt; margin:0 0 3mm; }
h2 { font-size:11pt; margin:0 0 3mm; padding:1mm 0; border-top:1pt solid var(--ink); border-bottom:1pt solid var(--ink); }
h3 { font-size:9.5pt; margin:4mm 0 1.5mm; text-transform:uppercase; letter-spacing:.4pt; }
p { margin:0 0 2mm; }
.muted { color:var(--muted); }
.small { font-size:7.5pt; }
.center { text-align:center; }
.right { text-align:right; }
.mono { font-variant-numeric: tabular-nums; font-feature-settings:"tnum"; }

.docmeta { position:absolute; top:6mm; left:14mm; right:14mm; display:flex; justify-content:space-between; gap:4mm; font-size:7pt; border-bottom:.75pt solid var(--ink); padding-bottom:1mm; }
.docmeta .pg { white-space:nowrap; }

table { width:100%; border-collapse:collapse; margin:0 0 3mm; }
th, td { border:.5pt solid var(--ink); padding:1mm 1.5mm; text-align:left; vertical-align:top; }
thead th { background:var(--headbg); font-size:8pt; }
thead { display: table-header-group; }   /* repeat headers across page breaks */
tr { page-break-inside: avoid; }
table.kv th { width:38%; background:var(--headbg); font-weight:600; }
table.data td, table.data th { text-align:right; }
table.data td:first-child, table.data th:first-child,
table.data td.text, table.data th.text { text-align:left; }
table.data td.c, table.data th.c { text-align:center; }
td.fail { font-weight:700; text-decoration:underline; }

/* Formal evaluation box: checkboxes, never coloured badges. */
.evalbox { border:.75pt solid var(--ink); padding:2mm 3mm; margin:0 0 3mm; font-weight:700; }
/* Ruled lines for the remarks area, always present even when empty. */
.remarklines { margin:0 0 3mm; }
.remarklines .rl { border-bottom:.5pt solid var(--ink); min-height:5mm; }

.cover-head { border-bottom:2pt solid var(--ink); padding-bottom:3mm; margin-bottom:5mm; }
.resultbox { border:1pt solid var(--ink); padding:3mm; text-align:center; margin:5mm 0; }
.resultbox .big { font-size:16pt; font-weight:700; letter-spacing:1pt; }

.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:0 5mm; }
.photos { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
.photo { border:.5pt solid var(--ink); padding:1.5mm; }
.photo img { width:100%; height:auto; display:block; }
.photo figcaption { font-size:7.5pt; margin-top:1mm; }

/* The error curve. Kept whole: an envelope split across a page break reads as two
   unrelated charts, and the y axis only appears on the first half. */
.chart { margin:3mm 0 0; page-break-inside:avoid; break-inside:avoid; }
.chart svg { display:block; width:100%; max-width:150mm; margin:0 auto; }
.chart figcaption { font-size:7.5pt; margin-top:1mm; text-align:center; }

.notice { border:.75pt solid var(--ink); background:var(--headbg); padding:2mm 3mm; font-size:8pt; margin:0 0 3mm; }
.sig { margin-top:12mm; max-width:95mm; }
.sig .line { border-bottom:.5pt solid var(--ink); height:14mm; }
/* Fixed-height slot so both ruled lines sit level whether or not a signature image exists. */
.sigimg { height:16mm; display:flex; align-items:flex-end; }
.sigimg img { max-width:55mm; max-height:16mm; margin:0 0 1mm; }
.formula { font-size:7.5pt; color:var(--muted); font-style:italic; }

@page { size: A4; margin: 14mm 12mm 16mm; }
@page { @bottom-center { content: "Report page " counter(page) " / " counter(pages); font-size:7.5pt; } }
@media print {
  html, body { background:#fff; }
  /* Browsers drop background colours when printing to save ink. Here the shading on the MPE envelope is the information, so the
     saving would cost the reader the verdict. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width:auto; min-height:0; margin:0; padding:0; border:none; box-shadow:none; }
  .no-print { display:none !important; }
  .docmeta { position:static; margin-bottom:4mm; }
}
.toolbar { position:sticky; top:0; z-index:10; background:#111827; color:#fff; padding:3mm 5mm; display:flex; gap:4mm; align-items:center; font-size:9pt; }
.toolbar button { font:inherit; padding:1.5mm 4mm; border:0; border-radius:1.5mm; background:#fff; color:#111827; font-weight:600; cursor:pointer; }
`;

// ---------------------------------------------------------------------------
// Per-test-shape tables
// ---------------------------------------------------------------------------

function weighingTable(evaluated: EvaluatedRun): string {
  const summary = evaluated.result as {
    rows: Array<Record<string, number | null | boolean | string>>;
    worstError: number | null;
    failingRows: number[];
    rowsEntered: number;
    rowsTotal: number;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);
  const corrected = evaluated.testType?.code === 'ECC';
  // The ΔL columns print only when changeover weights were actually recorded —
  // otherwise the table keeps its direct-reading shape.
  const showDelta = summary.rows.some((r) => r.deltaLUp != null || r.deltaLDown != null);

  const body = summary.rows
    .map((r) => {
      const up = r.errorUp as number | null;
      const down = r.errorDown as number | null;
      const mpe = r.mpe as number;
      const bad = (v: number | null) => (v !== null && Math.abs(v) > mpe + 1e-9 ? ' class="fail"' : '');
      return `<tr>
        <td class="text mono">${fmt(r.loadValue as number, dp)}</td>
        <td class="mono">${fmt(r.indicationUp as number | null, dp)}</td>
        <td class="mono">${fmt(r.indicationDown as number | null, dp)}</td>
        ${showDelta ? `<td class="mono">${fmt(r.deltaLUp as number | null, dp)}</td>
        <td class="mono">${fmt(r.deltaLDown as number | null, dp)}</td>` : ''}
        <td class="mono">${fmt(r.nI as number, 0)}</td>
        <td class="mono"${bad(up)}>${fmtSigned(up, dp)}</td>
        <td class="mono"${bad(down)}>${fmtSigned(down, dp)}</td>
        ${corrected ? `<td class="mono">${fmtSigned(r.correctedErrorUp as number | null, dp)}</td>` : ''}
        <td class="mono">&plusmn;${fmt(mpe, dp)}</td>
        <td class="mono">${(r.mpeInE as number).toFixed(1)} e</td>
        <td>${verdictText(r.verdict as Verdict)}</td>
      </tr>`;
    })
    .join('\n');

  return `
    <p class="formula">Error E = I + &frac12;e ${showDelta ? '&minus; &Delta;L ' : ''}&minus; L &nbsp;&nbsp;|&nbsp;&nbsp; n<sub>i</sub> = L / e &nbsp;&nbsp;|&nbsp;&nbsp; a row passes only if both loading directions are within MPE</p>
    <table class="data">
      <thead>
        <tr>
          <th class="text">Load L (g)</th><th>Ind. &uarr; (g)</th><th>Ind. &darr; (g)</th>
          ${showDelta ? '<th>&Delta;L &uarr; (g)</th><th>&Delta;L &darr; (g)</th>' : ''}
          <th>n<sub>i</sub></th><th>E &uarr; (g)</th><th>E &darr; (g)</th>
          ${corrected ? '<th>E<sub>c</sub> (g)</th>' : ''}
          <th>MPE (g)</th><th>MPE</th><th>Result</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    <p class="small muted">${summary.rowsEntered} of ${summary.rowsTotal} rows recorded.
      Largest absolute error ${fmt(summary.worstError, dp)} g.
      ${summary.failingRows.length > 0 ? `Rows outside MPE: ${summary.failingRows.join(', ')}.` : 'All rows within MPE.'}</p>
    ${errorCurve(summary.rows, dp)}`;
}

/**
 * Error curve against the MPE envelope, as static SVG.
 *
 * The table above already carries every number, so this is not there to convey data that is
 * missing — it is there because a reader cannot see from a column of figures whether the errors
 * are drifting steadily toward the tolerance or sitting comfortably in the middle of it, and
 * that shape is the thing an examiner actually judges.
 *
 * The envelope is drawn as the step function it is. MPE changes at the band boundaries in the
 * standard, so interpolating between loads would draw a smooth taper that does not exist and
 * would put the boundary in the wrong place — precisely where the interesting readings sit.
 *
 * Static SVG rather than a charting library: the report has to render years from now from a
 * single file, and a script tag that fetches a library renders an empty box the moment the
 * document is opened offline.
 */
function errorCurve(rows: Array<Record<string, number | null | boolean | string>>, dp: number): string {
  const points = rows
    .map((r) => ({
      load: r.loadValue as number,
      mpe: r.mpe as number,
      // `rowPass === false`, not `!rowPass`: a row with no reading yet is neither pass nor
      // fail, and colouring it red would report a failure the instrument never had.
      fail: r.rowPass === false,
      // The judged error, published by the rule that reached the verdict — raw or corrected
      // depending on the test. Inferring it here ("corrected if present") plots the wrong
      // quantity for every test judged on raw error, and puts the marker inside the tolerance
      // band on a row the report has just marked fail.
      up: firstNumber(r.judgedErrorUp),
      down: firstNumber(r.judgedErrorDown),
    }))
    .filter((p) => Number.isFinite(p.load) && Number.isFinite(p.mpe));

  // Nothing to draw from a single point or an untouched sheet — and an empty frame with axes
  // reads as "the errors were zero" rather than "no readings were taken".
  if (points.length < 2 || points.every((p) => p.up === null && p.down === null)) return '';

  const W = 620;
  const H = 210;
  const pad = { top: 12, right: 14, bottom: 30, left: 54 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const loads = points.map((p) => p.load);
  const minLoad = Math.min(0, ...loads);
  const maxLoad = Math.max(...loads);
  const maxMpe = Math.max(...points.map((p) => p.mpe));

  /*
   * The vertical scale is a fixed multiple of MPE — it does not adapt to the readings at all.
   *
   * Fitting the axis to the data is the obvious choice and it is wrong twice over. A grossly
   * failing reading, which is what a transposed digit or the wrong test weight produces,
   * rescales the axis around itself: the tolerance band collapses to a sliver and every other
   * reading flattens onto the zero line, so the chart ends up answering "how big was the worst
   * error" — which the table answers exactly — while destroying the one thing only the chart
   * shows. And an adaptive axis makes two charts of the same instrument incomparable, because
   * the same curve drawn twice at different scales looks like two different instruments.
   *
   * Holding the frame at 2.5x MPE costs the vertical space a tight curve would otherwise fill.
   * That is the honest picture: comfortably-within-tolerance should look comfortable, and the
   * envelope stays put when a reading changes, which is what makes a before-and-after pair of
   * reports readable side by side. Readings past the frame are drawn at the edge as triangles
   * rather than clipped, so nothing is silently dropped.
   */
  const span = Math.max(maxMpe * 2.5, 1e-9);
  const offScale = (value: number) => Math.abs(value) > span;

  // Rounded because these are interpolated into markup: unrounded floats print as
  // `54.000000000000006` and bloat the document without moving a pixel.
  const x = (load: number) =>
    round(pad.left + ((load - minLoad) / (maxLoad - minLoad || 1)) * plotW);
  const y = (error: number) =>
    round(pad.top + plotH / 2 - (Math.max(-span, Math.min(span, error)) / span) * (plotH / 2));

  // Envelope as a closed step polygon: along the upper limit left to right, back along the
  // lower. Where MPE changes between two loads, the previous level is carried to the new load
  // first, which puts the corner at the band boundary instead of sloping across it.
  const upper: string[] = [];
  const lower: string[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && prev.mpe !== p.mpe) {
      upper.push(`${x(p.load)},${y(prev.mpe)}`);
      lower.push(`${x(p.load)},${y(-prev.mpe)}`);
    }
    upper.push(`${x(p.load)},${y(p.mpe)}`);
    lower.push(`${x(p.load)},${y(-p.mpe)}`);
  });

  const series = (pick: (p: (typeof points)[number]) => number | null, stroke: string, dash: string) => {
    const drawn = points.filter((p) => pick(p) !== null);
    if (drawn.length < 2) return '';
    return `<polyline fill="none" stroke="${stroke}" stroke-width="1.4" stroke-dasharray="${dash}" ` +
      `points="${drawn.map((p) => `${x(p.load)},${y(pick(p)!)}`).join(' ')}"/>`;
  };

  const dots = points
    .filter((p) => p.up !== null)
    .map((p) => {
      const px = x(p.load);
      const py = y(p.up!);
      const fill = p.fail ? '#b91c1c' : '#111827';
      if (!offScale(p.up!)) {
        return `<circle cx="${px}" cy="${py}" r="${p.fail ? 3.4 : 2.4}" fill="${fill}"/>`;
      }
      // Beyond the frame: a triangle at the edge, apex pointing the way the error went, with its
      // base inside the plot so the marker cannot be mistaken for a clipped line end.
      const dir = p.up! > 0 ? 1 : -1;
      const base = round(py + 6 * dir);
      return `<polygon points="${px},${py} ${round(px - 3.6)},${base} ${round(px + 3.6)},${base}" ` +
        `fill="${fill}"/>`;
    })
    .join('');

  // Only the ends and any failing load are labelled: eleven labels across 150 mm collide.
  const failing = new Set(points.filter((p) => p.fail).map((p) => p.load));
  const ticks = points
    .filter((p, i) => i === 0 || p.load === maxLoad || failing.has(p.load))
    .map((p) =>
      `<text x="${x(p.load)}" y="${pad.top + plotH + 13}" text-anchor="middle" ` +
      `font-size="9" fill="#6b7280">${esc(trim(p.load, dp))}</text>`)
    .join('');

  const hasDown = points.some((p) => p.down !== null);
  const failCount = points.filter((p) => p.fail).length;
  const clipped = points.filter((p) => p.up !== null && offScale(p.up)).length;

  // Named HTML entities are deliberately avoided inside the `<svg>`: the surrounding document is
  // HTML, so a browser resolves them, but an SVG lifted out of the report for a converter or a
  // slide is parsed as XML, where only `&amp;`, `&lt;`, `&gt;`, `&quot;` and `&apos;` are
  // defined. Numeric references work in both.
  return `
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Error against load with the maximum
        permissible error envelope. ${failCount} of ${points.length} loads outside tolerance.">
        <polygon points="${[...upper, ...lower.reverse()].join(' ')}"
          fill="#e0f2fe" stroke="#0284c7" stroke-width="0.8" stroke-dasharray="3 2"/>
        <line x1="${pad.left}" y1="${y(0)}" x2="${W - pad.right}" y2="${y(0)}" stroke="#9ca3af" stroke-width="0.8"/>
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#9ca3af" stroke-width="0.8"/>
        <text x="${pad.left - 5}" y="${y(maxMpe) + 3}" text-anchor="end" font-size="9" fill="#6b7280">+${esc(trim(maxMpe, dp))}</text>
        <text x="${pad.left - 5}" y="${y(0) + 3}" text-anchor="end" font-size="9" fill="#6b7280">0</text>
        <text x="${pad.left - 5}" y="${y(-maxMpe) + 3}" text-anchor="end" font-size="9" fill="#6b7280">&#8722;${esc(trim(maxMpe, dp))}</text>
        ${ticks}
        <text x="${pad.left + plotW / 2}" y="${H - 3}" text-anchor="middle" font-size="9" fill="#6b7280">Load (g)</text>
        ${hasDown ? series((p) => p.down, '#6b7280', '4 2') : ''}
        ${series((p) => p.up, '#111827', 'none')}
        ${dots}
      </svg>
      <figcaption>Error against load, with the MPE envelope shaded.
        Solid: increasing load.${hasDown ? ' Dashed: decreasing load.' : ''}
        The envelope steps where n<sub>i</sub> crosses a band boundary in the standard.${
          clipped > 0
            ? ` ${clipped} reading${clipped === 1 ? '' : 's'} exceeded the plotted range and
                ${clipped === 1 ? 'is' : 'are'} marked at the frame edge; the value is in the table above.`
            : ''
        }</figcaption>
    </figure>`;
}

/** First argument that is a real number, or null — distinguishes "not measured" from zero. */
function firstNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** Two decimals is well under a pixel at these viewBox sizes, and keeps the markup readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A number for an axis label: full precision where it matters, without the trailing zeros.
 *
 * `formatFixed` is right for the table, where a column of aligned decimals is the point. On an
 * axis it produces "150.0000" beside "0.4000", which is four characters of noise in the space
 * a tick label has.
 *
 * Guarded on the decimal point, because stripping trailing zeros from an integer turns 100
 * into 1 — which would be a wrong number on a chart rather than an untidy one.
 */
function trim(value: number, decimals: number): string {
  const text = formatFixed(value, decimals);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function repeatabilityTable(evaluated: EvaluatedRun): string {
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

  return `
    <p class="formula">P = I &minus; I<sub>0</sub> &nbsp;&nbsp;|&nbsp;&nbsp; ${esc(r.label)}</p>
    <table class="data">
      <thead><tr><th class="text">No.</th><th>Load (g)</th><th>Indication I (g)</th><th>P = I &minus; I<sub>0</sub> (g)</th></tr></thead>
      <tbody>${r.trials
        .map(
          (t) => `<tr><td class="text mono">${t.sequenceNo}</td><td class="mono">${fmt(r.load, dp)}</td>
            <td class="mono">${fmt(t.indication, dp)}</td><td class="mono">${fmt(t.p, dp)}</td></tr>`,
        )
        .join('\n')}</tbody>
    </table>
    <table class="kv">
      ${row('Zero / tare reading I₀', `${formatFixed(r.indicationAtZero, dp)} g`)}
      ${row('max(P)', r.pMax === null ? null : `${formatFixed(r.pMax, dp)} g`)}
      ${row('min(P)', r.pMin === null ? null : `${formatFixed(r.pMin, dp)} g`)}
      ${row('Range max(P) − min(P)', r.range === null ? null : `${formatFixed(r.range, dp)} g`)}
      ${row('Tolerance (MPE at test load)', `${formatFixed(r.mpe, dp)} g (${r.mpeInE.toFixed(1)} e)`)}
    </table>`;
}

function eccentricityTable(evaluated: EvaluatedRun): string {
  const r = evaluated.result as {
    rows: Array<Record<string, unknown>>;
    worstError: number | null;
    panShape: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);

  return `
    <p class="formula">Judged on corrected error E<sub>c</sub> = E &minus; E<sub>centre</sub>, because the test measures position sensitivity rather than absolute accuracy.</p>
    <div class="grid2">
      <div>${panDiagram(r.panShape, r.rows)}</div>
      <div>
        <table class="data">
          <thead><tr><th class="text">Pos.</th><th class="text">Position</th><th>Ind. (g)</th><th>E<sub>c</sub> (g)</th><th>MPE (g)</th><th>Result</th></tr></thead>
          <tbody>${r.rows
            .map(
              (o) => `<tr>
                <td class="text mono">${esc(o.positionCode)}</td>
                <td class="text">${esc(o.positionLabel)}</td>
                <td class="mono">${fmt(o.indication as number | null, dp)}</td>
                <td class="mono"${o.verdict === 'fail' ? ' class="fail"' : ''}>${fmtSigned(o.correctedError as number | null, dp)}</td>
                <td class="mono">&plusmn;${fmt(o.mpe as number, dp)}</td>
                <td>${verdictText(o.verdict as Verdict)}</td>
              </tr>`,
            )
            .join('\n')}</tbody>
        </table>
        <p class="small muted">Largest absolute corrected error ${fmt(r.worstError, dp)} g.</p>
      </div>
    </div>`;
}

/**
 * Loading-position diagram, drawn as inline SVG.
 *
 * Inline rather than an image file so the report is one self-contained document that can
 * be emailed or archived without losing its figures.
 *
 * The positions themselves come from the domain package, so this figure and the on-screen
 * diagram cannot disagree about which corner a code refers to.
 */
function panDiagram(shape: string, rows: Array<Record<string, unknown>>): string {
  const status = new Map(rows.map((r) => [String(r.positionCode), String(r.verdict)]));
  const colour = (code: string) =>
    status.get(code) === 'fail' ? '#b91c1c' : status.get(code) === 'pass' ? '#15803d' : '#9ca3af';

  // Receptor outline, in viewBox units. Fractional coordinates map into this square.
  const origin = 16;
  const extent = 168;

  const positions = eccentricityPositions(shape as PanShape);
  const points = positions
    .map((position) => {
      const cx = origin + position.x * extent;
      const cy = origin + position.y * extent;
      return `<circle cx="${cx}" cy="${cy}" r="13" fill="#fff" stroke="${colour(position.code)}" stroke-width="2"/>
     <text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="${colour(
       position.code,
     )}">${esc(position.code)}</text>`;
    })
    .join('\n');

  return `<svg viewBox="0 0 200 200" width="100%" style="max-width:62mm;border:.5pt solid #d1d5db" role="img"
      aria-label="Load receptor showing the ${positions.length} loading positions">
    <rect x="${origin}" y="${origin}" width="${extent}" height="${extent}" fill="#f9fafb" stroke="#9ca3af" stroke-width="1.5"/>
    <line x1="100" y1="${origin}" x2="100" y2="${origin + extent}" stroke="#e5e7eb"/>
    <line x1="${origin}" y1="100" x2="${origin + extent}" y2="100" stroke="#e5e7eb"/>
    ${points}
  </svg>
  <p class="small muted center">Load receptor, viewed from above</p>`;
}

function esdTable(evaluated: EvaluatedRun): string {  const r = evaluated.result as { rows: Array<Record<string, unknown>>; worstError: number | null };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);

  return `
    <p class="formula">Judged on the change in indication &Delta;I = I<sub>after</sub> &minus; I<sub>before</sub>. A change beyond MPE is a significant fault.</p>
    <table class="data">
      <thead><tr><th class="text">No.</th><th>kV</th><th class="text">Mode</th><th class="text">Polarity</th>
        <th>Load (g)</th><th>Before (g)</th><th>After (g)</th><th>&Delta;I (g)</th><th>MPE (g)</th><th>Result</th></tr></thead>
      <tbody>${r.rows
        .map(
          (o) => `<tr>
            <td class="text mono">${esc(o.sequenceNo)}</td>
            <td class="mono">${fmt(o.testVoltageKv as number, 1)}</td>
            <td class="text">${esc(o.applicationMode)}</td>
            <td class="text">${esc(o.polarity)}</td>
            <td class="mono">${fmt(o.loadValue as number, dp)}</td>
            <td class="mono">${fmt(o.indicationBefore as number | null, dp)}</td>
            <td class="mono">${fmt(o.indicationAfter as number | null, dp)}</td>
            <td class="mono"${o.verdict === 'fail' ? ' class="fail"' : ''}>${fmtSigned(o.error as number | null, dp)}</td>
            <td class="mono">&plusmn;${fmt(o.mpe as number, dp)}</td>
            <td>${verdictText(o.verdict as Verdict)}</td>
          </tr>`,
        )
        .join('\n')}</tbody>
    </table>
    <p class="small muted">Largest absolute change in indication ${fmt(r.worstError, dp)} g.</p>`;
}

function radiatedTable(evaluated: EvaluatedRun): string {
  const r = evaluated.result as { rows: Array<Record<string, unknown>>; worstError: number | null };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);

  return `
    <p class="formula">Judged on the change in indication &Delta;I = I<sub>after</sub> &minus; I<sub>before</sub> at each frequency step. A change beyond MPE is a significant fault.</p>
    <table class="data">
      <thead><tr><th class="text">No.</th><th>Freq. (MHz)</th><th>Field (V/m)</th>
        <th>Load (g)</th><th>Before (g)</th><th>After (g)</th><th>&Delta;I (g)</th><th>MPE (g)</th><th>Result</th></tr></thead>
      <tbody>${r.rows
        .map(
          (o) => `<tr>
            <td class="text mono">${esc(o.sequenceNo)}</td>
            <td class="mono">${fmt(o.frequencyMhz as number | null, 0)}</td>
            <td class="mono">${fmt(o.fieldStrengthVM as number | null, 1)}</td>
            <td class="mono">${fmt(o.loadValue as number, dp)}</td>
            <td class="mono">${fmt(o.indicationBefore as number | null, dp)}</td>
            <td class="mono">${fmt(o.indicationAfter as number | null, dp)}</td>
            <td class="mono"${o.verdict === 'fail' ? ' class="fail"' : ''}>${fmtSigned(o.error as number | null, dp)}</td>
            <td class="mono">&plusmn;${fmt(o.mpe as number, dp)}</td>
            <td>${verdictText(o.verdict as Verdict)}</td>
          </tr>`,
        )
        .join('\n')}</tbody>
    </table>
    <p class="small muted">Largest absolute change in indication ${fmt(r.worstError, dp)} g.</p>`;
}

function spanTable(evaluated: EvaluatedRun): string {
  const r = evaluated.result as {
    rows: Array<Record<string, unknown>>;
    range: number | null;
    mpd: number;
    label: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);

  return `
    <p class="formula">${esc(r.label)} — the tolerance is an absolute value carried on the instrument model, not a multiple of e.</p>
    <table class="data">
      <thead><tr><th class="text">No.</th><th class="text">Condition</th><th class="text">Date</th>
        <th>Load (g)</th><th>Ind. (g)</th><th>E (g)</th><th>E<sub>c</sub> (g)</th></tr></thead>
      <tbody>${r.rows
        .map(
          (o) => `<tr>
            <td class="text mono">${esc(o.sequenceNo)}</td>
            <td class="text">${esc(o.condition)}</td>
            <td class="text">${esc(o.measuredAt)}</td>
            <td class="mono">${fmt(o.loadValue as number, dp)}</td>
            <td class="mono">${fmt(o.indication as number | null, dp)}</td>
            <td class="mono">${fmtSigned(o.error as number | null, dp)}</td>
            <td class="mono">${fmtSigned(o.correctedError as number | null, dp)}</td>
          </tr>`,
        )
        .join('\n')}</tbody>
    </table>
    <table class="kv">
      ${row('Range of corrected error', r.range === null ? null : `${formatFixed(r.range, dp)} g`)}
      ${row('Tolerance (mpd)', `${formatFixed(r.mpd, dp)} g`)}
    </table>`;
}

function equilibriumTable(evaluated: EvaluatedRun): string {
  const r = evaluated.result as {
    trials: Array<{ sequenceNo: number; indication: number | null; deviation: number | null }>;
    load: number;
    spread: number | null;
    tolerance: number;
    toleranceInE: number;
    label: string;
  };
  const dp = decimalsFor(evaluated.spec.e, evaluated.spec.d);

  return `
    <p class="formula">Judged on the spread of the set, not on any single reading &nbsp;&nbsp;|&nbsp;&nbsp; ${esc(r.label)}</p>
    <table class="data">
      <thead><tr><th class="text">No.</th><th>Load (g)</th><th>Indication I (g)</th><th>Deviation from mean (g)</th></tr></thead>
      <tbody>${r.trials
        .map(
          (t) => `<tr><td class="text mono">${t.sequenceNo}</td><td class="mono">${fmt(r.load, dp)}</td>
            <td class="mono">${fmt(t.indication, dp)}</td><td class="mono">${fmtSigned(t.deviation, dp)}</td></tr>`,
        )
        .join('\n')}</tbody>
    </table>
    <table class="kv">
      ${row('Spread across readings', r.spread === null ? null : `${formatFixed(r.spread, dp)} g`)}
      ${row('Tolerance', `${formatFixed(r.tolerance, dp)} g (${r.toleranceInE.toFixed(1)} e)`)}
    </table>`;
}

function zeroCreepTable(evaluated: EvaluatedRun): string {
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
  const zeroRow = (o: (typeof r.rows)[number]) =>
    o.loadValue === 0 || /^zero\b/i.test(String(o.condition ?? '').trim());

  return `
    <p class="formula">${esc(r.zeroLabel)} &nbsp;&nbsp;|&nbsp;&nbsp; ${esc(r.creepLabel)}</p>
    <table class="data">
      <thead><tr><th class="text">No.</th><th class="text">Step</th><th class="text">Date</th>
        <th>Load (g)</th><th>Indication (g)</th><th class="text">Phase</th></tr></thead>
      <tbody>${r.rows
        .map(
          (o) => `<tr>
            <td class="text mono">${esc(o.sequenceNo)}</td>
            <td class="text">${esc(o.condition)}</td>
            <td class="text">${esc(o.measuredAt)}</td>
            <td class="mono">${fmt(o.loadValue, dp)}</td>
            <td class="mono">${fmt(o.indication, dp)}</td>
            <td class="text">${zeroRow(o) ? 'Zero return' : 'Creep'}</td>
          </tr>`,
        )
        .join('\n')}</tbody>
    </table>
    <table class="kv">
      ${row('Zero residual (unloaded)', r.zeroResidual === null ? null : `${formatFixed(r.zeroResidual, dp)} g`)}
      ${row('Zero tolerance', `${formatFixed(r.zeroTolerance, dp)} g`)}
      ${row('Zero check', r.zeroPass ? 'PASS' : 'FAIL')}
      ${row('Creep range across hold', r.creepRange === null ? null : `${formatFixed(r.creepRange, dp)} g`)}
      ${row('Creep tolerance', `${formatFixed(r.creepTolerance, dp)} g`)}
      ${row('Creep check', r.creepPass ? 'PASS' : 'FAIL')}
    </table>`;
}

function testBody(evaluated: EvaluatedRun): string {
  switch (evaluated.formKind) {
    case 'weighing_performance': return weighingTable(evaluated);
    case 'repeatability': return repeatabilityTable(evaluated);
    case 'eccentricity': return eccentricityTable(evaluated);
    case 'esd': return esdTable(evaluated);
    case 'radiated': return radiatedTable(evaluated);
    case 'span_stability': return spanTable(evaluated);
    case 'equilibrium': return equilibriumTable(evaluated);
    case 'zero_creep': return zeroCreepTable(evaluated);
    default:
      return `<p class="notice">This test is defined in the applicable standard but has no data-entry
        form in this build, so no measurements are recorded.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface ProjectContext {
  project: {
    id: number;
    task_no: string;
    report_no: string;
    danak_no: string | null;
    standard_version: string;
    examination_start_date: string | null;
    examination_end_date: string | null;
    status: string;
  };
  manufacturer: Record<string, unknown>;
  generatedAt: string;
  generatedBy: string;
}

/**
 * Compact form header: OIML reference, report identity and the report page number.
 * The page/total are filled by the renderer, which numbers the assembled sheets, so
 * the numbering stays correct no matter how many models or tests a project holds.
 * The `@page` bottom-center rule repeats the same numbering on printed pages.
 */
function docMeta(ctx: ProjectContext, section: string, page: number, pages: number): string {
  return `<div class="docmeta">
    <span>OIML R 76-2 &middot; ${esc(ctx.project.standard_version)}</span>
    <span>Report ${esc(ctx.project.report_no)} &middot; ${esc(section)}</span>
    <span class="pg">Report page ${page} / ${pages}</span>
  </div>`;
}

function coverSheet(ctx: ProjectContext, model: ReportModel, page: number, pages: number): string {
  const m = ctx.manufacturer;
  const rollup = model.rollup;
  const familyById = new Map(model.models.map((s) => [s.model.id, s.familyName]));
  const modelRows = rollup.models.map((entry) => {
    const familyName = familyById.get(entry.model.id) ?? null;
    return `<tr><td>${esc(familyName)}</td><td>${esc(entry.model.model_name)}</td>
      <td class="right mono">${esc(entry.model.max_capacity)} g</td>
      <td class="right mono">${esc(entry.model.e_value)} g</td>
      <td class="right mono">${esc(entry.model.n_intervals)}</td>
      <td>${esc(entry.model.accuracy_class)}</td><td class="c">${verdictText(entry.verdict)}</td></tr>`;
  });
  return `<section class="sheet">
    ${docMeta(ctx, 'Report identification', page, pages)}
    <div class="cover-head">
      <p class="small" style="letter-spacing:1.5pt;text-transform:uppercase;margin:0 0 2mm">OIML R 76-2 &middot; Type Examination Test Report</p>
      <h1>Non-Automatic Weighing Instrument</h1>
      <p class="small">Conducted in accordance with ${esc(ctx.project.standard_version)} / OIML R76</p>
    </div>
      <h3>1 &nbsp; Report identification</h3>
      <table class="kv">
        ${row('Report number', ctx.project.report_no)}
        ${row('Application / Task number', ctx.project.task_no)}
        ${row('DANAK number', ctx.project.danak_no)}
        ${row('Applicable standard', ctx.project.standard_version)}
        ${row('Examination period', [ctx.project.examination_start_date, ctx.project.examination_end_date].filter(Boolean).join(' to '))}
        ${row('Project status', ctx.project.status)}
      </table>

      <h3>2 &nbsp; General information concerning the type</h3>
      <table class="kv">
        ${row('Applicant / Manufacturer name', m.name)}
        ${row('Address', m.address)}
        ${row('Contact person', m.contact_person)}
        ${row('E-mail', m.email)}
        ${row('Telephone', m.phone)}
      </table>
      <table>
        <thead><tr><th>Family</th><th>Type designation</th><th class="right">Max</th><th class="right">e</th><th class="right">n</th><th>Class</th><th class="c">Result</th></tr></thead>
        <tbody>${modelRows.join('')}</tbody>
      </table>
      <p class="small">Instrument class: &#9744; Self-indicating &nbsp; &#9744; Semi-self-indicating &nbsp; &#9744; Non-self-indicating</p>

      <div class="resultbox">
        <p class="small" style="margin:0 0 1mm;letter-spacing:1pt;text-transform:uppercase">Overall result</p>
        <div class="big">${rollup.verdict === 'pass' ? 'PASS' : rollup.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE'}</div>
        <p class="small" style="margin:1mm 0 0">${rollup.passCount} of ${rollup.testCount} tests passed
          &middot; ${rollup.failCount} failed &middot; ${rollup.incompleteCount} incomplete</p>
      </div>
    <p class="small center">Generated ${esc(ctx.generatedAt)} by ${esc(ctx.generatedBy)}.
      All errors, tolerances and verdicts in this report are computed from the recorded measurements at generation time.</p>
  </section>`;
}

function checklistSheet(ctx: ProjectContext, rows: ChecklistModelRow[], page: number, pages: number): string {
  if (rows.length === 0) return '';

  let lastCategory: string | null = null;
  // Formal inspection form: narrow centred Yes / No / N/A columns marked with X.
  // pass answers "Yes", fail answers "No"; anything unanswered or not applicable is N/A.
  const mark = (on: boolean): string => (on ? 'X' : '');
  const body = rows
    .map((r) => {
      const heading =
        r.category !== lastCategory
          ? `<tr><td colspan="6" style="font-weight:700">${esc((lastCategory = r.category) ?? 'Other')}</td></tr>`
          : '';
      const status = r.status ?? 'na';
      const yes = status === 'pass';
      const no = status === 'fail';
      const na = !yes && !no;
      return `${heading}<tr>
        <td class="mono">${esc(r.clause_no)}</td>
        <td>${esc(r.description)}</td>
        <td class="c">${mark(yes)}</td>
        <td class="c">${mark(no)}</td>
        <td class="c">${mark(na)}</td>
        <td>${esc(r.remarks)}</td>
      </tr>`;
    })
    .join('\n');

  return `<section class="sheet">
    ${docMeta(ctx, 'Checklist', page, pages)}
    <h2>Checklist of Descriptive Markings and Devices</h2>
    <p class="small">Clause references are to ${esc(ctx.project.standard_version)}.</p>
    <table>
      <thead><tr><th style="width:11%">Clause</th><th>Requirement / Examination</th><th class="c" style="width:6%">Yes</th><th class="c" style="width:6%">No</th><th class="c" style="width:6%">N/A</th><th style="width:22%">Remarks</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

/**
 * Metrological characteristics as a compact range table. Single-range instruments —
 * everything this build holds — occupy one row; a multi-range instrument reports one
 * row per range so ranges are never combined into an ambiguous table. Component and
 * device detail lives in the construction examination, not here.
 */
function modelInfoSheet(ctx: ProjectContext, model: ModelRow, page: number, pages: number): string {
  return `<section class="sheet">
    ${docMeta(ctx, `${model.model_name} — metrological characteristics`, page, pages)}
    <h2>Metrological Characteristics — ${esc(model.model_name)}</h2>

    <table class="data">
      <thead><tr><th class="text">Range</th><th>Min</th><th>Max</th><th>e</th><th>d</th><th>n = Max / e</th></tr></thead>
      <tbody><tr>
        <td class="text mono">1</td>
        <td class="mono">${fmt(model.min_capacity, decimalsFor(model.e_value, model.d_value))} g</td>
        <td class="mono">${fmt(model.max_capacity, decimalsFor(model.e_value, model.d_value))} g</td>
        <td class="mono">${fmt(model.e_value, decimalsFor(model.e_value, model.e_value))} g</td>
        <td class="mono">${fmt(model.d_value, decimalsFor(model.d_value, model.d_value))} g</td>
        <td class="mono">${fmt(model.n_intervals, 0)}</td>
      </tr></tbody>
    </table>
    <table class="kv">
      ${row('Accuracy class', model.accuracy_class)}
      ${row('Fractional factor, pi', model.fractional_factor_pi)}
      ${row('Span stability tolerance, mpd', model.mpd_span_stability, 'g')}
      ${row('Serial number', model.serial_no)}
    </table>

    <h3>Rated operating conditions</h3>
    <table class="kv">
      ${row('Temperature range', `${model.operating_temp_min ?? '?'} to ${model.operating_temp_max ?? '?'} °C`)}
      ${row('AC supply', model.power_ac_nominal_v === null ? null : `${model.power_ac_nominal_v} V (${model.power_ac_min_v}–${model.power_ac_max_v} V)`)}
      ${row('DC supply', model.power_dc_nominal_v === null ? null : `${model.power_dc_nominal_v} V (${model.power_dc_min_v}–${model.power_dc_max_v} V)`)}
      ${row('Load receptor', String(model.pan_shape).replace(/_/g, ' '))}
    </table>
  </section>`;
}

/**
 * Construction examination: inspection-form section holding component information,
 * device descriptions and photographs. Test-run photographs stay on their own test
 * form under "Photographic evidence"; this section carries the instrument photos.
 */
function constructionSheet(
  ctx: ProjectContext,
  model: ModelRow,
  modelPhotos: AttachmentRow[],
  page: number,
  pages: number,
): string {
  const zero = parseJson<Record<string, unknown>>(model.zero_setting_types as string, {});
  const tare = parseJson<Record<string, unknown>>(model.tare_types as string, {});

  return `<section class="sheet">
    ${docMeta(ctx, `${model.model_name} — construction examination`, page, pages)}
    <h2>Construction Examination — ${esc(model.model_name)}</h2>

    <h3>Load cell</h3>
    <table class="kv">
      ${row('Type', model.load_cell_type)}
      ${row('Manufacturer', model.load_cell_manufacturer)}
      ${row('Capacity', model.load_cell_capacity)}
      ${row('Rated output', model.load_cell_rated_output_mvv, 'mV/V')}
      ${row('Min. input impedance', model.load_cell_min_impedance_ohm, 'Ω')}
    </table>

    <h3>Zero-setting and tare devices</h3>
    <table class="kv">
      <tr><th>Zero-setting devices</th><td>${flagList(zero)}</td></tr>
      <tr><th>Tare devices</th><td>${flagList(tare)}</td></tr>
      ${row('Maximum tare effect', model.max_tare_pct, '% of Max')}
    </table>

    ${photoBlock(modelPhotos, 'Instrument and markings')}
  </section>`;
}

function summarySheet(
  ctx: ProjectContext,
  model: ModelRow,
  entries: SummaryEntry[],
  page: number,
  pages: number,
): string {
  const performed = entries.filter((e) => e.implemented && e.testRunId !== null);

  return `<section class="sheet">
    ${docMeta(ctx, `${model.model_name} — summary of type evaluation`, page, pages)}
    <h2>Summary of Type Evaluation — ${esc(model.model_name)}</h2>
    <p class="small">Rolled up from the recorded measurements. Nothing in this table is entered by hand.</p>
    <table>
      <thead><tr><th>Test / Examination</th><th class="c" style="width:14%">Result</th><th style="width:26%">Remarks</th></tr></thead>
      <tbody>${entries
        .map((e) => {
          const done = e.implemented && e.testRunId !== null;
          const result = !e.implemented || e.testRunId === null ? 'N/A' : e.verdict === 'pass' ? 'PASS' : e.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE';
          const remarks = !done
            ? 'Not performed'
            : e.rowsEntered === null
              ? ''
              : `${e.rowsEntered}/${e.rowsTotal} rows recorded`;
          return `<tr>
            <td>${esc(e.reportSheetRef)} &nbsp; ${esc(e.displayName)}</td>
            <td class="c"><strong>${result}</strong></td>
            <td class="small">${esc(remarks)}</td>
          </tr>`;
        })
        .join('\n')}</tbody>
    </table>
    <p class="small">${performed.length} test${performed.length === 1 ? '' : 's'} performed of
      ${entries.length} defined for ${esc(ctx.project.standard_version)}.
      Tests marked N/A are within the scope of the standard but were not recorded in this examination.</p>
  </section>`;
}

function equipmentSheet(
  ctx: ProjectContext,
  model: ModelRow,
  referenceWeights: number[],
  runs: EvaluatedRun[],
  page: number,
  pages: number,
): string {
  const conditions = runs
    .filter((r) => r.run.date_performed || r.run.temperature_c !== null)
    .map(
      (r) => `<tr>
        <td class="mono">${esc(r.testType?.reportSheetRef)}</td>
        <td>${esc(r.testType?.displayName)}</td>
        <td class="mono">${esc(r.run.date_performed)} ${esc(r.run.time_performed ?? '')}</td>
        <td class="mono right">${r.run.temperature_c === null ? EMPTY : `${r.run.temperature_c} °C`}</td>
        <td class="mono right">${r.run.humidity_pct === null ? EMPTY : `${r.run.humidity_pct} %`}</td>
        <td>${esc(r.run.operator_name)}</td>
      </tr>`,
    )
    .join('\n');

  const weightRows = referenceWeights
    .map(
      (v, i) => `<tr><td class="c mono">${i + 1}</td><td>Reference weight, ${esc(v)} g</td>
        <td>Class E2/F1</td><td>Calibration certificates held on file</td></tr>`,
    )
    .join('\n');

  return `<section class="sheet">
    ${docMeta(ctx, `${model.model_name} — test equipment`, page, pages)}
    <h2>Test Equipment — ${esc(model.model_name)}</h2>
    <table>
      <thead><tr><th class="c" style="width:7%">No.</th><th>Equipment</th>
        <th style="width:24%">Manufacturer / Type</th><th style="width:30%">Identification / Traceability</th></tr></thead>
      <tbody>${weightRows || `<tr><td colspan="4">No equipment recorded.</td></tr>`}</tbody>
    </table>
    <h3>Environmental conditions per test</h3>
    <table>
      <thead><tr><th style="width:11%">Sheet</th><th>Test</th><th style="width:20%">Date / time</th>
        <th class="right" style="width:11%">Temp.</th><th class="right" style="width:11%">RH</th><th style="width:16%">Operator</th></tr></thead>
      <tbody>${conditions || `<tr><td colspan="6">No conditions recorded.</td></tr>`}</tbody>
    </table>
    <p class="small">Reference weights traceable to national standards. Calibration certificates
      are held on file with this examination record.</p>
  </section>`;
}

/**
 * One test as its own OIML form: compact title, identification, conditions in the
 * At-start / At-max / At-end shape, results, checkbox evaluation, ruled remarks.
 *
 * The conditions mapping is honest about what this build records: a single
 * temperature, humidity and timestamp per run, plus chamber/room readings where the
 * test needs them. Barometric pressure is not recorded, so it reads as not measured
 * until the data-entry forms capture it.
 */
function testSheet(
  ctx: ProjectContext,
  model: ModelRow,
  familyName: string | null,
  evaluated: EvaluatedRun,
  page: number,
  pages: number,
): string {
  const run_ = evaluated.run;
  const cond = (v: unknown, unit = ''): string => {
    const text = v === null || v === undefined || v === '' ? EMPTY : esc(v);
    return `<td class="mono right">${text}${unit && text !== EMPTY ? ` ${unit}` : ''}</td>`;
  };
  const remarks = run_.remarks
    ? `<h3>Remarks</h3><p>${esc(run_.remarks)}</p>`
    : `<h3>Remarks</h3><div class="remarklines"><div class="rl"></div><div class="rl"></div></div>`;
  return `<section class="sheet">
    ${docMeta(ctx, `${model.model_name} — ${evaluated.testType?.displayName ?? run_.test_type_code}`, page, pages)}
    <h2>${esc(evaluated.testType?.reportSheetRef ?? '')} &nbsp; ${esc(evaluated.testType?.displayName ?? run_.test_type_code)}</h2>

    <h3>Test identification</h3>
    <table class="kv">
      ${row('Instrument', model.model_name)}
      ${row('Type / Family', familyName ?? model.model_name)}
      ${row('Serial No.', model.serial_no)}
      ${row('Range', `Max ${model.max_capacity} g / Min ${model.min_capacity} g, e = ${model.e_value} g`)}
      ${row('Test date', `${run_.date_performed ?? ''} ${run_.time_performed ?? ''}`.trim())}
      ${row('Operator', run_.operator_name)}
    </table>

    <h3>Test conditions</h3>
    <table class="data">
      <thead><tr><th class="text">Condition</th><th>At start</th><th>At max</th><th>At end</th></tr></thead>
      <tbody>
        <tr><td class="text">Temp.</td>${cond(run_.temperature_c, '°C')}${cond(run_.chamber_temp_c, '°C')}${cond(run_.room_temp_c, '°C')}</tr>
        <tr><td class="text">Rel. h.</td>${cond(run_.humidity_pct, '%')}<td class="mono right">${EMPTY}</td><td class="mono right">${EMPTY}</td></tr>
        <tr><td class="text">Time</td>${cond(run_.time_performed)}<td class="mono right">${EMPTY}</td><td class="mono right">${EMPTY}</td></tr>
        <tr><td class="text">Bar. pres.</td>${cond(run_.barometric_hpa, 'hPa')}<td class="mono right">${EMPTY}</td><td class="mono right">${EMPTY}</td></tr>
      </tbody>
    </table>

    ${evaluated.testType?.description ? `<p class="small">${esc(evaluated.testType.description)}</p>` : ''}

    <h3>Test results</h3>
    ${testBody(evaluated)}

    <h3>Evaluation</h3>
    ${evalBoxes(evaluated.verdict)}

    ${remarks}
    ${photoBlock(evaluated.attachments, 'Photographic evidence')}
  </section>`;
}

/**
 * Embed photos as data URIs.
 *
 * The alternative — linking to the uploads directory — produces a report that renders
 * correctly today and breaks the moment it is moved or emailed. A type-examination record
 * has to stay readable years later, so the bytes travel with the document.
 */
function photoBlock(attachments: AttachmentRow[], heading: string): string {
  if (attachments.length === 0) return '';

  const figures = attachments
    .map((a) => {
      const absolute = path.isAbsolute(a.file_path)
        ? a.file_path
        : path.join(config.uploadsDir, a.file_path);
      let src = '';
      try {
        if (fs.existsSync(absolute) && fs.statSync(absolute).size < 4 * 1024 * 1024) {
          const mime = a.mime_type ?? 'image/jpeg';
          src = `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`;
        }
      } catch {
        src = '';
      }
      const image = src
        ? `<img src="${src}" alt="${esc(a.caption ?? a.original_name ?? 'Test photograph')}">`
        : `<p class="small muted">Image unavailable: ${esc(a.original_name)}</p>`;
      return `<figure class="photo">${image}<figcaption>${esc(a.caption ?? a.original_name)}</figcaption></figure>`;
    })
    .join('\n');

  return `<h3>${esc(heading)}</h3><div class="photos">${figures}</div>`;
}

/**
 * The signatory's uploaded signature, embedded like a photo so it travels with the
 * document. Absent when they never uploaded one — the ruled line below still stands.
 */
function signatureImage(imagePath: string | null | undefined): string {
  if (!imagePath) return '';
  const absolute = path.isAbsolute(imagePath) ? imagePath : path.join(config.uploadsDir, imagePath);
  try {
    if (fs.existsSync(absolute) && fs.statSync(absolute).size < 2 * 1024 * 1024) {
      return `<img src="data:image/png;base64,${fs.readFileSync(absolute).toString('base64')}" alt="Signature">`;
    }
  } catch {
    /* fall through to no image; the ruled line carries the block */
  }
  return '';
}

function signatureSheet(
  ctx: ProjectContext,
  rollup: ProjectRollup,
  signature: SignatureModel | null,
  page: number,
  pages: number,
  printSignature = true,
): string {
  return `<section class="sheet">
    ${docMeta(ctx, 'Conclusion', page, pages)}
    <h2>Conclusion</h2>
    <p>The instrument${rollup.models.length === 1 ? '' : 's'} described in this report ${
      rollup.models.length === 1 ? 'was' : 'were'
    } examined against ${esc(ctx.project.standard_version)}.
      ${rollup.passCount} of ${rollup.testCount} recorded tests met the requirements of the standard${
        rollup.failCount > 0 ? `, and ${rollup.failCount} did not` : ''
      }${rollup.incompleteCount > 0 ? `; ${rollup.incompleteCount} remain incomplete` : ''}.</p>

    <p><strong>Overall result: ${verdictText(rollup.verdict)}</strong></p>

    ${
      rollup.verdict === 'fail'
        ? `<p class="notice">One or more tests fell outside the maximum permissible error. The instrument
             does not meet the requirements of ${esc(ctx.project.standard_version)} as tested.</p>`
        : rollup.verdict === 'incomplete'
          ? `<p class="notice">Some tests within the scope of this examination have not been completed.
               This report is not a final statement of conformity.</p>`
          : ''
    }

    <table>
      <thead><tr><th>Model</th><th class="right">Tests passed</th><th class="c">Result</th></tr></thead>
      <tbody>${rollup.models
        .map((m) => {
          const performed = m.summary.filter((e) => e.implemented && e.testRunId !== null);
          return `<tr><td>${esc(m.model.model_name)}</td>
            <td class="right mono">${performed.filter((e) => e.verdict === 'pass').length} / ${performed.length}</td>
            <td>${verdictText(m.verdict)}</td></tr>`;
        })
        .join('\n')}</tbody>
    </table>

    ${`<div class="sig">
      <div>
        <div class="sigimg">${printSignature ? signatureImage(signature?.signature_image_path) : ''}</div>
        <div class="line"></div>
        <p class="small"><strong>${esc(signature?.signed_by_name ?? '')}</strong><br>
          ${esc(signature?.signed_by_title ?? 'Responsible for the examination')}<br>
          <span class="muted">${esc(signature?.signed_at ?? '')}</span></p>
      </div>
    </div>`}

    <p class="small muted" style="margin-top:12mm">Report ${esc(ctx.project.report_no)} &middot;
      generated ${esc(ctx.generatedAt)} &middot; ${rollup.testCount} tests evaluated.
      This document was produced from the recorded measurements; the pass/fail decisions were computed
      from ${esc(ctx.project.standard_version)} rather than entered by an operator.</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class HtmlRenderer implements IReportRenderer<string> {
  readonly format = 'html' as const;

  render(model: ReportModel, options: RenderOptions = {}): string {
    const ctx: ProjectContext = {
      project: model.project,
      manufacturer: model.manufacturer,
      generatedAt: model.generatedAt,
      generatedBy: model.generatedBy,
    };
    const rollup = model.rollup;

    // Sheets are built untotalled first: the header of every form carries
    // "Report page i / N", so the total has to be known before any sheet renders.
    // Builders take (page, pages) and the assembly numbers them in document order:
    // identification, then per model summary → metrology → equipment → tests →
    // construction, then checklist, then conclusion.
    type Sheet = (page: number, pages: number) => string;
    const sheets: Sheet[] = [];
    sheets.push((page, pages) => coverSheet(ctx, model, page, pages));
    for (const section of model.models) {
      const m = section.model;
      const s = section;
      sheets.push((page, pages) => summarySheet(ctx, m, s.summary, page, pages));
      sheets.push((page, pages) => modelInfoSheet(ctx, m, page, pages));
      sheets.push((page, pages) => equipmentSheet(ctx, m, s.referenceWeights, s.runs, page, pages));
      for (const evaluated of s.runs) {
        const run = evaluated;
        sheets.push((page, pages) => testSheet(ctx, m, s.familyName, run, page, pages));
      }
      sheets.push((page, pages) => constructionSheet(ctx, m, s.modelPhotos, page, pages));
    }
    if (model.checklist.length > 0) {
      sheets.push((page, pages) => checklistSheet(ctx, model.checklist, page, pages));
    }
    const printSignature = options.printSignature ?? true;
    sheets.push((page, pages) => signatureSheet(ctx, rollup, model.signature, page, pages, printSignature));

    const pages = sheets.length;
    const body = sheets.map((sheet, i) => sheet(i + 1, pages)).join('\n');

    const toolbar = options.interactive
      ? `<div class="toolbar no-print">
         <strong>Report ${esc(ctx.project.report_no)}</strong>
         <span>Use your browser's print dialog and choose "Save as PDF" — the layout is already paginated for A4.</span>
         <button onclick="window.print()">Print / Save as PDF</button>
       </div>`
      : '';

    const project = ctx.project;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test Report ${esc(project.report_no)} — ${esc(project.task_no)}</title>
<style>${STYLES}</style>
</head>
<body>
${toolbar}
${body}
</body>
</html>`;
  }
}

export const htmlRenderer = new HtmlRenderer();
