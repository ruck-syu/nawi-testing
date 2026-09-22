import { useRef, useState } from "react";
import { fmt, fmtSigned, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { NumCell, VerdictCell, ErrorValue } from "../../components/cells";
import { Conditions } from "../../components/Conditions";
import { ErrorCurve } from "../../components/charts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { cn } from "../../lib/utils";
import { useDerivedSync } from "../../lib/rowsync";
import type { SheetFormProps } from "./types";

function upPass(row: any) {
  if (row.errorUp === null || row.errorUp === undefined || !Number.isFinite(row.mpe)) return null;
  return row.rowPass !== false || Math.abs(row.errorUp) <= row.mpe + 1e-9;
}

function downPass(row: any) {
  if (row.errorDown === null || row.errorDown === undefined || !Number.isFinite(row.mpe)) return null;
  return row.rowPass !== false || Math.abs(row.errorDown) <= row.mpe + 1e-9;
}

export function WeighingForm({ computed, save, onDirty }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const e = computed.spec?.e;
  const result = computed.result ?? {};
  const [rows, setRows] = useState<any[]>(() => (result.rows ?? []).map((r: any) => ({ ...r })));
  useDerivedSync(setRows, result.rows, [
    "sequenceNo",
    "loadValue",
    "indicationUp",
    "indicationDown",
    "deltaLUp",
    "deltaLDown",
  ]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const payload = () =>
    rowsRef.current.map((row: any) => ({
      sequenceNo: row.sequenceNo,
      loadValue: row.loadValue,
      indicationUp: row.indicationUp ?? null,
      indicationDown: row.indicationDown ?? null,
      deltaLUp: row.deltaLUp ?? null,
      deltaLDown: row.deltaLDown ?? null,
    }));
  const saver = useAutosaver(() => save(payload()));
  const touch = () => {
    onDirty();
    saver.schedule();
  };
  const set = (index: number, patch: Record<string, unknown>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    touch();
  };

  const code = computed.run?.test_type_code ?? "";
  const conditionFields = ["date", "time", "operator", "temperature", "humidity", "pressure"];
  if (["T1", "T2", "T3", "T4", "DAMP1"].includes(code)) {
    conditionFields.splice(4, 0, "chamber", "room");
  }

  const measured = rows.filter((r) => r.indicationUp !== null && r.indicationUp !== undefined).length;
  const failing: number[] = result.failingRows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Conditions
        run={computed.run ?? {}}
        save={withTableFlush(saver, save, payload)}
        fields={conditionFields}
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Measurements</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => saver.flush()}
            title="Autosave runs half a second after you stop typing; this saves immediately."
          >
            Save now
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            {measured} of {rows.length} loads measured.{" "}
            {result.worstError !== null && result.worstError !== undefined
              ? `Largest error ${fmt(result.worstError, dp)} g`
              : "No readings yet"}
            {result.mpeInERange
              ? `, against a tolerance of ±${result.mpeInERange[0]} e to ±${result.mpeInERange[1]} e across the range.`
              : "."}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead className="text-right">Load L (g)</TableHead>
                <TableHead className="text-right" title="L / e — the verification interval index that selects the MPE band">nᵢ</TableHead>
                <TableHead className="text-right">Ind. ↑ (g)</TableHead>
                <TableHead className="text-right">Ind. ↓ (g)</TableHead>
                <TableHead className="text-right" title="Changeover small weight; E = I + 0.5e − ΔL − L">ΔL ↑ (g)</TableHead>
                <TableHead className="text-right" title="Changeover small weight; E = I + 0.5e − ΔL − L">ΔL ↓ (g)</TableHead>
                <TableHead className="text-right" title="E = I + 0.5e − ΔL − L">E ↑ (g)</TableHead>
                <TableHead className="text-right" title="E = I + 0.5e − ΔL − L">E ↓ (g)</TableHead>
                <TableHead className="text-right" title="Ec = E − E₀">Ec ↑</TableHead>
                <TableHead className="text-right" title="Ec = E − E₀">Ec ↓</TableHead>
                <TableHead className="text-right">MPE</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.sequenceNo} className={cn(row.rowPass === false && "bg-reject-wash/40")}>
                  <TableCell className="text-sm text-muted-foreground">{row.sequenceNo}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{fmt(row.loadValue, dp)}</TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">{fmt(row.nI, 0)}</TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indicationUp}
                      label={`Increasing indication for load ${fmt(row.loadValue, dp)} grams`}
                      onInput={(v) => set(i, { indicationUp: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indicationDown}
                      label={`Decreasing indication for load ${fmt(row.loadValue, dp)} grams`}
                      onInput={(v) => set(i, { indicationDown: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.deltaLUp}
                      label={`Changeover weight for load ${fmt(row.loadValue, dp)} grams, increasing`}
                      onInput={(v) => set(i, { deltaLUp: v })}
                      onFlush={() => saver.flush()}
                      invalid={row.deltaLUp != null && (row.deltaLUp < 0 || (e ? row.deltaLUp > e : false))}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.deltaLDown}
                      label={`Changeover weight for load ${fmt(row.loadValue, dp)} grams, decreasing`}
                      onInput={(v) => set(i, { deltaLDown: v })}
                      onFlush={() => saver.flush()}
                      invalid={row.deltaLDown != null && (row.deltaLDown < 0 || (e ? row.deltaLDown > e : false))}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <ErrorValue error={row.errorUp} pass={upPass(row)} dp={dp} signed={fmtSigned} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ErrorValue error={row.errorDown} pass={downPass(row)} dp={dp} signed={fmtSigned} />
                  </TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">{fmt(row.correctedErrorUp, dp)}</TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">{fmt(row.correctedErrorDown, dp)}</TableCell>
                  <TableCell className="tnum text-right text-sm">
                    ±{fmt(row.mpe, dp)}
                    <div className="text-xs text-muted-foreground">± {Number(row.mpeInE).toFixed(1)} e</div>
                  </TableCell>
                  <TableCell>
                    <VerdictCell pass={row.rowPass} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {failing.length > 0 && (
            <p className="px-5 py-3 text-sm font-semibold text-reject">
              Row{failing.length === 1 ? "" : "s"} {failing.join(", ")} exceed the maximum
              permissible error.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Error curve</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Errors against load, with the MPE staircase shaded. The steps are where nᵢ crosses a
            band boundary in the standard.
          </p>
          <ErrorCurve rows={result.rows ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
