import { formatFixed } from "../../../packages/domain/src/numeric";

/**
 * Error curve with the MPE staircase envelope, as React SVG.
 *
 * A faithful port of client/src/chart.js: fixed 2.5×MPE frame, step (never
 * interpolated) envelope, judged-error series, off-scale triangles, ends-plus-fails
 * axis labelling. Presentation attributes are inline so the chart needs no stylesheet.
 */

interface CurvePoint {
  loadValue: number;
  mpe: number;
  rowPass?: boolean | null;
  judgedErrorUp?: number | null;
  judgedErrorDown?: number | null;
  judgedError?: number | null;
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  for (const v of values) if (Number.isFinite(v)) return v as number;
  return null;
}

function decimalsForAxis(range: number) {
  if (range >= 1) return 2;
  if (range >= 0.1) return 3;
  return 4;
}

const STEEL = "#5b6470";
const INK = "#1b2027";
const GRID = "#dfe2e6";
const ENVELOPE_FILL = "#d8e2ec";
const FAIL = "#b3261e";

export function ErrorCurve({ rows, showDown = true }: { rows: CurvePoint[]; showDown?: boolean }) {
  const points = rows
    .filter((r) => Number.isFinite(r.loadValue) && Number.isFinite(r.mpe))
    .map((r) => ({
      loadValue: r.loadValue,
      mpe: r.mpe,
      rowPass: r.rowPass,
      up: firstFinite(r.judgedErrorUp, r.judgedError),
      down: firstFinite(r.judgedErrorDown),
    }));

  if (points.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">The curve appears once readings are entered.</p>;
  }

  const W = 720;
  const H = 260;
  const pad = { top: 14, right: 16, bottom: 34, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const loads = points.map((r) => r.loadValue);
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(0, ...loads);
  const maxMpe = Math.max(...points.map((r) => r.mpe));
  const maxAbs = Math.max(maxMpe * 2.5, 1e-9);
  const offScale = (v: number) => Math.abs(v) > maxAbs;

  const x = (load: number) => pad.left + ((load - minLoad) / (maxLoad - minLoad || 1)) * plotW;
  const y = (error: number) =>
    pad.top + plotH / 2 - (Math.max(-maxAbs, Math.min(maxAbs, error)) / maxAbs) * (plotH / 2);

  const upper: string[] = [];
  const lower: string[] = [];
  points.forEach((row, i) => {
    const prev = points[i - 1];
    if (prev && prev.mpe !== row.mpe) {
      upper.push(`${x(row.loadValue)},${y(prev.mpe)}`);
      lower.push(`${x(row.loadValue)},${y(-prev.mpe)}`);
    }
    upper.push(`${x(row.loadValue)},${y(row.mpe)}`);
    lower.push(`${x(row.loadValue)},${y(-row.mpe)}`);
  });

  const series = (pick: (p: (typeof points)[number]) => number | null) =>
    points.filter((p) => Number.isFinite(pick(p))).map((p) => `${x(p.loadValue)},${y(pick(p) as number)}`);

  const upLine = series((p) => p.up);
  const hasDown = showDown && points.some((p) => Number.isFinite(p.down));
  const downLine = hasDown ? series((p) => p.down) : [];
  const failingLoads = new Set(points.filter((p) => p.rowPass === false).map((p) => p.loadValue));
  const clipped = points.filter((p) => Number.isFinite(p.up) && offScale(p.up as number)).length;
  const failCount = points.filter((p) => p.rowPass === false).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="inline-block w-5 border-t-2" style={{ borderTopColor: INK }} />
          Increasing load
        </span>
        {hasDown && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block w-5 border-t-2 border-dashed" style={{ borderTopColor: STEEL }} />
            Decreasing load
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <i className="inline-block w-5 border-t-2 border-dashed" style={{ borderTopColor: STEEL }} />
          MPE envelope
        </span>
        {clipped > 0 && (
          <span className="font-semibold" style={{ color: FAIL }}>
            ▲ {clipped} reading{clipped === 1 ? "" : "s"} beyond the plotted range
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Error curve against the maximum permissible error envelope. ${failCount} of ${points.length} loads outside tolerance.`}
      >
        <polygon
          points={[...upper, ...lower.reverse()].join(" ")}
          fill={ENVELOPE_FILL}
          stroke={STEEL}
          strokeWidth={1}
          strokeDasharray="5 3"
        />
        <line x1={pad.left} y1={y(0)} x2={W - pad.right} y2={y(0)} stroke={STEEL} strokeWidth={1} />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotH} stroke={STEEL} strokeWidth={1} />
        {[maxMpe, -maxMpe].map((level) => (
          <text key={level} x={pad.left - 6} y={y(level) + 3} textAnchor="end" fontSize={11} fill={STEEL}>
            {formatFixed(level, decimalsForAxis(maxAbs))}
          </text>
        ))}
        <text x={pad.left - 6} y={y(0) + 3} textAnchor="end" fontSize={11} fill={STEEL}>
          0
        </text>
        {points.map((row, i) => (
          <line
            key={i}
            x1={x(row.loadValue)}
            y1={pad.top}
            x2={x(row.loadValue)}
            y2={pad.top + plotH}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {points.map((row, i) =>
          row.loadValue === maxLoad || i === 0 || failingLoads.has(row.loadValue) ? (
            <text key={`t${i}`} x={x(row.loadValue)} y={pad.top + plotH + 14} textAnchor="middle" fontSize={11} fill={STEEL}>
              {String(row.loadValue)}
            </text>
          ) : null
        )}
        <text x={pad.left + plotW / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={STEEL}>
          Load (g)
        </text>
        {downLine.length >= 2 && (
          <polyline points={downLine.join(" ")} fill="none" stroke={STEEL} strokeWidth={1.5} strokeDasharray="5 3" />
        )}
        {upLine.length >= 2 && (
          <polyline points={upLine.join(" ")} fill="none" stroke={INK} strokeWidth={2} />
        )}
        {points.map((row, i) => {
          if (!Number.isFinite(row.up)) return null;
          const v = row.up as number;
          const failed = row.rowPass === false;
          const color = failed ? FAIL : INK;
          if (!offScale(v)) {
            return <circle key={`d${i}`} cx={x(row.loadValue)} cy={y(v)} r={failed ? 4 : 3} fill={color} />;
          }
          const dir = v > 0 ? 1 : -1;
          const base = y(v) + 7 * dir;
          return (
            <polygon
              key={`d${i}`}
              points={`${x(row.loadValue)},${y(v)} ${x(row.loadValue) - 4.5},${base} ${x(row.loadValue) + 4.5},${base}`}
              fill={color}
            />
          );
        })}
      </svg>
    </div>
  );
}

interface PanPosition {
  code: string;
  label: string;
  x: number;
  y: number;
}

export function PanDiagram({ positions, rows }: { positions: PanPosition[]; rows: Array<{ positionCode: string; indication: number | null; rowPass?: boolean | null }> }) {
  const byCode = new Map(rows.map((r) => [r.positionCode, r]));
  const origin = 8;
  const extent = 84;
  let failures = 0;
  let measured = 0;

  const colorFor = (state: string) =>
    state === "fail" ? FAIL : state === "pass" ? "#0f7a5a" : "#9aa1ab";

  const spots = positions.map((position) => {
    const row = byCode.get(position.code);
    const state =
      !row || !Number.isFinite(row.indication) ? "empty" : row.rowPass === false ? "fail" : "pass";
    if (state === "fail") failures += 1;
    if (state !== "empty") measured += 1;
    const cx = origin + position.x * extent;
    const cy = origin + position.y * extent;
    const color = colorFor(state);
    return (
      <g key={position.code}>
        <circle cx={cx} cy={cy} r={9} fill="#fff" stroke={color} strokeWidth={2}>
          <title>{position.label}</title>
        </circle>
        <text x={cx} y={cy + 3.4} textAnchor="middle" fontSize={10} fontWeight={700} fill={color}>
          {position.code}
        </text>
      </g>
    );
  });

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 100 100"
        role="img"
        className="w-full max-w-56 border"
        aria-label={
          `Load receptor viewed from above, with ${positions.length} test positions. ` +
          (measured === 0
            ? "No positions measured yet."
            : failures > 0
              ? `${failures} position(s) outside tolerance.`
              : "All measured positions within tolerance.")
        }
      >
        <rect x={origin} y={origin} width={extent} height={extent} fill="#f4f5f6" stroke={STEEL} strokeWidth={1} />
        <line x1={50} y1={origin} x2={50} y2={origin + extent} stroke={GRID} strokeWidth={1} />
        <line x1={origin} y1={50} x2={origin + extent} y2={50} stroke={GRID} strokeWidth={1} />
        {spots}
      </svg>
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">
        Load receptor, viewed from above
      </figcaption>
    </figure>
  );
}
