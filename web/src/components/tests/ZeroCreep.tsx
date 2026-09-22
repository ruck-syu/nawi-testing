import { useRef, useState } from "react";
import { fmt, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { useDerivedSync } from "../../lib/rowsync";
import { NumCell, TextCell } from "../../components/cells";
import { Conditions } from "../../components/Conditions";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import type { SheetFormProps } from "./types";

const isZeroRow = (row: any) =>
  row.loadValue === 0 || /^zero\b/i.test(String(row.condition ?? "").trim());

export function ZeroCreepForm({ computed, save, onDirty }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const result = computed.result ?? {};
  const [rows, setRows] = useState<any[]>(() => (result.rows ?? []).map((r: any) => ({ ...r })));
  useDerivedSync(setRows, result.rows, [
    "sequenceNo",
    "condition",
    "measuredAt",
    "loadValue",
    "indication",
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

  const entered = rows.filter((r) => r.indication !== null && r.indication !== undefined).length;
  const zeroEntered = rows.filter(
    (r) => isZeroRow(r) && r.indication !== null && r.indication !== undefined
  ).length;
  const creepEntered = rows.filter(
    (r) => !isZeroRow(r) && r.indication !== null && r.indication !== undefined
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <Conditions
        run={computed.run ?? {}}
        save={withTableFlush(saver, save, payload)}
        fields={["date", "time", "operator", "testLoad"]}
        note="The creep load is recorded here; the unloaded zero row carries load 0 in the table. Changing the load re-evaluates the whole sheet."
      />
      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            {entered} of {rows.length} steps recorded. The unloaded row judges the zero return,
            the loaded rows judge the creep.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead>Step</TableHead>
                <TableHead className="w-36">Date</TableHead>
                <TableHead className="text-right">Load (g)</TableHead>
                <TableHead className="text-right">Indication (g)</TableHead>
                <TableHead>Phase</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.sequenceNo}>
                  <TableCell className="text-sm text-muted-foreground">{row.sequenceNo}</TableCell>
                  <TableCell>
                    <TextCell
                      value={row.condition}
                      label={`Step description for row ${row.sequenceNo}`}
                      placeholder="Creep hold, 30 min"
                      onInput={(v) => set(i, { condition: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="date"
                      aria-label={`Date of row ${row.sequenceNo}`}
                      defaultValue={(row.measuredAt ?? "").slice(0, 10)}
                      onChange={(e) => set(i, { measuredAt: e.target.value || null })}
                      className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm shadow-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.loadValue}
                      label={`Load for row ${row.sequenceNo}`}
                      onInput={(v) => set(i, { loadValue: v ?? 0 })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indication}
                      label={`Indication for row ${row.sequenceNo}`}
                      onInput={(v) => set(i, { indication: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {isZeroRow(row) ? "Zero return" : "Creep"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SubResult
            title="Zero return"
            metric="Residual"
            value={result.zeroResidual}
            tolerance={result.zeroTolerance}
            pass={result.zeroPass}
            dp={dp}
            label={result.zeroLabel}
            pending={zeroEntered === 0 ? "Enter the unloaded reading to judge the zero return." : null}
          />
          <SubResult
            title="Creep across the hold"
            metric="Range"
            value={result.creepRange}
            tolerance={result.creepTolerance}
            pass={result.creepPass}
            dp={dp}
            label={result.creepLabel}
            pending={creepEntered < 2 ? "Enter at least two loaded readings to judge the creep." : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SubResult({
  title,
  metric,
  value,
  tolerance,
  pass,
  dp,
  label,
  pending,
}: {
  title: string;
  metric: string;
  value: number | null | undefined;
  tolerance: number | null | undefined;
  pass: boolean | null | undefined;
  dp: number;
  label?: string;
  pending: string | null;
}) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-bold">{title}</h4>
      {label && <p className="mb-2 text-sm text-muted-foreground">{label}</p>}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{metric}</div>
          <div className="tnum text-lg font-bold">{fmt(value, dp)} g</div>
        </div>
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Permitted</div>
          <div className="tnum text-lg font-bold">{fmt(tolerance, dp)} g</div>
        </div>
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Result</div>
          <div className="text-lg font-bold">{pass === null || pass === undefined ? "—" : pass ? "Pass" : "Fail"}</div>
        </div>
      </div>
      {pending && <p className="mt-2 text-sm text-muted-foreground">{pending}</p>}
    </div>
  );
}
