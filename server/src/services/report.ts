/**
 * Report orchestration.
 *
 * This module owns the renderer contract (`IReportRenderer`), builds the report model
 * once per generation (`buildReportModel`), dispatches to a renderer, and persists the
 * append-only history row. Format-specific presentation lives in the renderers:
 * `reportHtml.ts` (print HTML, also the source for PDF via Puppeteer) and later
 * `reportDocx.ts` (editable Word export).
 *
 * Every number in every output comes from `evaluation.ts`. Renderers re-present the
 * model; they never compute verdicts, so no format can disagree with what the
 * technician saw on screen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { all, get, run } from '../db/index.ts';
import { config } from '../config.ts';
import { notFound } from '../http.ts';
import { buildReportModel, type ReportModel } from './reportModel.ts';
import { htmlRenderer } from './reportHtml.ts';
import { docxRenderer } from './reportDocx.ts';

// ---------------------------------------------------------------------------
// Renderer contract
// ---------------------------------------------------------------------------

/** Formats with a dedicated renderer. `pdf` is not here: it is print HTML run through Puppeteer. */
export type RendererFormat = 'html' | 'docx';

export interface RenderOptions {
  /** Adds an on-screen print toolbar. Omitted for Puppeteer, which prints directly. */
  interactive?: boolean;
  generatedBy?: string;
}

/**
 * One report format. Takes the shared model and returns the finished bytes —
 * an HTML string or a DOCX buffer — so `generateReport` never branches on format
 * internals beyond picking the renderer.
 */
export interface IReportRenderer<T extends string | Buffer = string | Buffer> {
  readonly format: RendererFormat;
  render(model: ReportModel, options?: RenderOptions): T | Promise<T>;
}

/**
 * Render the full HTML report for preview. Thin wrapper kept for the preview route:
 * generation itself goes through `generateReport`, which builds the model once.
 */
export async function renderProjectReport(
  projectId: number,
  options: RenderOptions = {},
): Promise<string> {
  const model = await buildReportModel(projectId, { generatedBy: options.generatedBy });
  return htmlRenderer.render(model, options);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface GeneratedReport {
  id: number;
  format: 'html' | 'pdf' | 'docx';
  file_path: string;
  generated_at: string;
  overall_verdict: string | null;
  test_count: number | null;
  pass_count: number | null;
  fail_count: number | null;
  print_signature: boolean | null;
  url: string;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

/**
 * Render, write to disk, and append a history row.
 *
 * Generation is deliberately append-only: each run produces a new timestamped file and a
 * new row, so an earlier report stays reproducible after the data behind it changes.
 * That is a requirement of the workflow, not a nicety — a signed report must not be
 * silently rewritten.
 */
export async function generateReport(
  projectId: number,
  options: { format?: 'html' | 'pdf' | 'docx'; generatedBy?: string } = {},
): Promise<{ report: GeneratedReport; pdfFallback: boolean }> {
  const format = options.format ?? 'html';
  // The model is built once and shared: persistence reads project/rollup from it and
  // the renderer presents it, so generation can never render different data than it files.
  const model = await buildReportModel(projectId, { generatedBy: options.generatedBy });
  const project = model.project;
  const rollup = model.rollup;

  fs.mkdirSync(config.reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${slug(project.report_no)}_${stamp}`;

  let filePath: string;
  let actualFormat: 'html' | 'pdf' | 'docx' = 'html';
  let pdfFallback = false;

  if (format === 'docx') {
    // The editable annex: only the .docx is written, no HTML sidecar.
    const buffer = await docxRenderer.render(model);
    filePath = path.join(config.reportsDir, `${base}.docx`);
    fs.writeFileSync(filePath, buffer);
    actualFormat = 'docx';
  } else {
    const html = htmlRenderer.render(model, {
      // Always interactive: real PDFs print through Puppeteer's print media, where
      // the toolbar hides itself via .no-print — while the no-Puppeteer fallback is
      // a file the user opens in a browser, where the Print button is the only
      // guidance toward Save-as-PDF.
      interactive: true,
      generatedBy: options.generatedBy,
    });

    const htmlPath = path.join(config.reportsDir, `${base}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');

    filePath = htmlPath;

    if (format === 'pdf') {
      const pdfPath = tryPrintPdf(html, path.join(config.reportsDir, `${base}.pdf`));
      if (pdfPath) {
        filePath = pdfPath;
        actualFormat = 'pdf';
      } else {
        // Puppeteer is an optional dependency. When it is absent the print-styled HTML is
        // the deliverable and the browser's own Save-as-PDF produces the same pagination.
        pdfFallback = true;
      }
    }
  }

  const { lastInsertRowid } = await run(
    `INSERT INTO generated_report
       (project_id, report_no, format, file_path, generated_by,
        overall_verdict, test_count, pass_count, fail_count, print_signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      project.report_no,
      actualFormat,
      path.basename(filePath),
      options.generatedBy ?? null,
      rollup.verdict,
      rollup.testCount,
      rollup.passCount,
      rollup.failCount,
      Boolean(model.signature),
    ],
  );

  return { report: await readReport(lastInsertRowid), pdfFallback };
}

/**
 * Render to PDF with Puppeteer if it happens to be installed.
 *
 * Puppeteer is an optional dependency, so it is resolved at call time rather than
 * imported: a missing package means the print-styled HTML is the deliverable instead.
 * The render itself runs in a short child process because Puppeteer's API is async and
 * this call sits on a synchronous request path. Returns the written path, or null.
 *
 * Two environment knobs, both optional:
 * - PUPPETEER_EXECUTABLE_PATH: drive a system Chrome instead of the downloaded one.
 *   This is the supported path on machines where the Chrome CDN download fails or a
 *   managed Chrome is already installed.
 * - The print uses preferCSSPageSize, so the report's own `@page` rule (A4 with its
 *   margins) governs pagination — without it Puppeteer substitutes default 1 cm margins
 *   and the PDF paginates differently from the HTML the browser prints.
 */
function tryPrintPdf(html: string, outputPath: string): string | null {
  const require = createRequire(import.meta.url);
  try {
    require.resolve('puppeteer');
  } catch {
    return null;
  }

  const tmpHtml = `${outputPath}.tmp.html`;
  const tmpScript = `${outputPath}.tmp.cjs`;

  try {
    fs.writeFileSync(tmpHtml, html, 'utf8');
    fs.writeFileSync(
      tmpScript,
      `const puppeteer = require('puppeteer');
       const fs = require('node:fs');
       (async () => {
         const launchOptions = { args: ['--no-sandbox'] };
         if (process.env.PUPPETEER_EXECUTABLE_PATH) {
           launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
         }
         const browser = await puppeteer.launch(launchOptions);
         try {
           const page = await browser.newPage();
           await page.setContent(fs.readFileSync(process.argv[2], 'utf8'), { waitUntil: 'load' });
           await page.pdf({ path: process.argv[3], format: 'A4', printBackground: true, preferCSSPageSize: true });
         } finally {
           await browser.close();
         }
       })().catch((error) => { console.error(error); process.exit(1); });`,
      'utf8',
    );

    const result = spawnSync(process.execPath, [tmpScript, tmpHtml, outputPath], {
      stdio: 'inherit',
      timeout: 90_000,
    });
    return result.status === 0 && fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  } finally {
    for (const file of [tmpHtml, tmpScript]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best-effort cleanup; a leftover temp file must not fail the report */
      }
    }
  }
}

export async function readReport(id: number) {
  const report = await get<Omit<GeneratedReport, 'url'>>('SELECT * FROM generated_report WHERE id = ?', [
    id,
  ]);
  if (!report) throw notFound(`Generated report ${id} not found`);
  return { ...report, url: `/reports/${report.file_path}` };
}

export async function listReports(projectId?: number) {
  const rows = projectId
    ? await all<Omit<GeneratedReport, 'url'> & { report_no: string }>(
        'SELECT * FROM generated_report WHERE project_id = ? ORDER BY generated_at DESC, id DESC',
        [projectId],
      )
    : await all<Omit<GeneratedReport, 'url'> & { report_no: string }>(
        'SELECT * FROM generated_report ORDER BY generated_at DESC, id DESC',
      );
  return rows.map((r) => ({ ...r, url: `/reports/${r.file_path}` }));
}
