import { decimalsFor, formatFixed } from "../../../packages/domain/src/numeric";

/** Em-dash for values never entered — blanks are visibly deliberate. */
export const EMPTY = "—";

export function fmt(value: number | null | undefined, dp: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return formatFixed(value, dp);
}

export function fmtSigned(value: number | null | undefined, dp: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const text = formatFixed(Math.abs(value), dp);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${text}`;
}

export function precisionOf(spec: { e?: number; d?: number }): number {
  return decimalsFor(Number(spec?.e), Number(spec?.d ?? spec?.e));
}
