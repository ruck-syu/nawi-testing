import { useRef, useState } from "react";
import { fmt, fmtSigned, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { useDerivedSync } from "../../lib/rowsync";
import { NumCell, TextCell } from "../../components/cells";
import { Conditions } from "../../components/Conditions";
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
import type { SheetFormProps } from "./types";

export function SpanForm({ computed, save, onDirty }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const result = computed.result ?? {};
  const [rows, setRows] = useState<any[]>(() => (result.rows ?? []).map((r: any) => ({ ...r })));
  useDerivedSync(setRows, result.rows, [
    "sequenceNo",
    "condition",
    "measuredAt",
    "loadValue",
    "indication",
    "indicationZero",
  ]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const payload = () =>
    rowsRef.current.map((row: any) => ({
      sequenceNo: row.sequenceNo,
      condition: row.condition ?? "",
      measuredAt: row.measuredAt ?? null,
      loadValue: row.loadValue ?? 0,
      indication: row.indication ?? null,
      indicationZero: row.indicationZero ?? null,
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

  const usable = rows.filter((r) => r.correctedError !== null && r.correctedError !== undefined);

  return (
    <div className="flex flex-col gap-4">
      <Conditions
        run={computed.run ?? {}}
        save={withTableFlush(saver, save, payload)}
        fields={["date", "operator"]}
        note="The dates that matter are per measurement, in the table below — this test spans the whole examination rather than a single session."
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Measurements over time</CardTitle>
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
            {usable.length} of {rows.length} measurements complete. A measurement counts only once
            both its indication and its zero reading are entered.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="w-36">Measured at</TableHead>
                <TableHead className="text-right">Load (g)</TableHead>
                <TableHead className="text-right">Ind. (g)</TableHead>
                <TableHead className="text-right" title="The indication with the receptor empty, at the same moment">At zero (g)</TableHead>
                <TableHead className="text-right" title="Ec = E − E₀, the quantity the drift is judged on">Corrected Ec (g)</TableHead>
                <TableHead className="text-right">Error E (g)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.sequenceNo}>
                  <TableCell className="text-sm text-muted-foreground">{row.sequenceNo}</TableCell>
                  <TableCell>
                    <TextCell
                      value={row.condition}
                      label={`Condition for measurement ${row.sequenceNo}`}
                      placeholder="After 8 h at 40 °C"
                      onInput={(v) => set(i, { condition: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="date"
                      aria-label={`Date of measurement ${row.sequenceNo}`}
                      defaultValue={(row.measuredAt ?? "").slice(0, 10)}
                      onChange={(e) => set(i, { measuredAt: e.target.value || null })}
                      className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm shadow-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.loadValue}
                      label={`Load for measurement ${row.sequenceNo}`}
                      onInput={(v) => set(i, { loadValue: v ?? 0 })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indication}
                      label={`Indication for measurement ${row.sequenceNo}`}
                      onInput={(v) => set(i, { indication: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indicationZero}
                      label={`Zero indication for measurement ${row.sequenceNo}`}
                      onInput={(v) => set(i, { indicationZero: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">{fmtSigned(row.correctedError, dp)}</TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">{fmtSigned(row.error, dp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3">
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Range of corrected error</div>
              <div className="tnum text-lg font-bold">{fmt(result.range, dp)} g</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Tolerance (mpd)</div>
              <div className="tnum text-lg font-bold">{fmt(result.mpd, dp)} g</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Result</div>
              <div className="text-lg font-bold">{result.verdict === "pass" ? "Pass" : result.verdict === "fail" ? "Fail" : "—"}</div>
            </div>
          </div>
          <p className="px-5 pb-4 text-sm text-muted-foreground">{result.label ?? ""}</p>
        </CardContent>
      </Card>
    </div>
  );
}
