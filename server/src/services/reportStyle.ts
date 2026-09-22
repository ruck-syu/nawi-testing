/**
 * Shared report style contract — the OIML R76-2:2007 visual language.
 *
 * Both renderers (`reportHtml.ts`, `reportDocx.ts`) obey this module, so the signed
 * print record and the editable annex agree on more than data:
 *
 * 1. Same page: A4 with the same margins (the HTML `@page` rule and the DOCX section
 *    geometry both come from `REPORT_PAGE`).
 * 2. Same verdict vocabulary: `verdictLabel` is the single mapping from verdict to
 *    printed word. Results print as plain words (PASS / FAIL / INCOMPLETE /
 *    NOT PERFORMED); test-form evaluations use ticked/unticked boxes. Renderers
 *    never use coloured badges.
 * 3. Same base typeface and size.
 * 4. Same section order (report identification → general information → metrological
 *    characteristics → test equipment → summary of type evaluation → per-model test
 *    forms → construction examination → checklist → conclusion) and the same
 *    section titles — enforced by review, since order lives in each renderer's
 *    assembly.
 * 5. Same monochrome form styling: thin black borders, compact dense tables,
 *    right-aligned numerics, centred checks, ruled remarks areas.
 *
 * Pixel identity is explicitly out of scope: Word reflows text with its own metrics,
 * so the promise is same model, same order, same words, same page — never same pixels.
 */

/** A4 in twips (1/1440 inch); margins mirror `@page { size: A4; margin: 14mm 12mm 16mm }`. */
export const REPORT_PAGE = {
  widthTwips: 11906,
  heightTwips: 16838,
  marginTopTwips: 794,
  marginRightTwips: 680,
  marginBottomTwips: 907,
  marginLeftTwips: 680,
} as const;

/** Helvetica is not on Windows; Arial is its metric-compatible stand-in. */
export const REPORT_BASE_FONT = 'Arial';

/** 9.5pt body text, in the half-point units Word uses. */
export const REPORT_BASE_SIZE_HALF_POINTS = 19;

/** The one verdict-to-word mapping. Anything else on screen is decoration. */
export function verdictLabel(verdict: string | null | undefined): string {
  switch (verdict) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'incomplete':
      return 'INCOMPLETE';
    default:
      return 'NOT PERFORMED';
  }
}

/** Fill/text pairs retired with the OIML restyle. Kept exported so older
 * generated-document tooling that imports the contract does not break; the
 * renderers no longer shade verdicts. */
export const VERDICT_COLORS: Record<string, { fill: string; text: string }> = {
  pass: { fill: 'F0FDF4', text: '15803D' },
  fail: { fill: 'FEF2F2', text: 'B91C1C' },
  incomplete: { fill: 'FFFBEB', text: 'B45309' },
  not_started: { fill: 'FFFBEB', text: 'B45309' },
};
