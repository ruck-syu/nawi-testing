import { useRef, useState } from "react";
import { fmt, fmtSigned, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { useDerivedSync } from "../../lib/rowsync";
import { api } from "../../lib/api";
import { NumCell, VerdictCell, ErrorValue } from "../../components/cells";
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
import { cn } from "../../lib/utils";
import type { SheetFormProps } from "./types";

export function RadiatedForm({ computed, save, onDirty, onStructuralChange }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const result = computed.result ?? {};
  const [rows, setRows] = useState<any[]>(() => (result.rows ?? []).map((r: any) => ({ ...r })));
  useDerivedSync(setRows, result.rows, [
    "sequenceNo",
    "frequencyMhz",
    "fieldStrengthVM",
    "loadValue",
    "indicationBefore",
    "indicationAfter",
  ]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const payload = () =>
    rowsRef.current.map((row: any) => ({
      sequenceNo: row.sequenceNo,
      frequencyMhz: row.frequencyMhz ?? null,
      fieldStrengthVM: row.fieldStrengthVM ?? null,
      loadValue: row.loadValue ?? 0,
      indicationBefore: row.indicationBefore ?? null,
      indicationAfter: row.indicationAfter ?? null,
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

  const measured = rows.filter(
    (r) => r.indicationAfter !== null && r.indicationAfter !== undefined
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <Conditions
        run={computed.run ?? {}}
        save={withTableFlush(saver, save, payload)}
        fields={["date", "time", "operator", "temperature", "humidity", "pressure"]}
        note="80–2000 MHz sweep at 10 V/m with 80% AM. A frequency step fails only on a significant fault: the indication shifting by more than the MPE."
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Frequency steps</CardTitle>
          <Button
            size="sm"
            onClick={async () => {
              await saver.flush();
              const last = rowsRef.current[rowsRef.current.length - 1] ?? {};
              await api.post(`/test-runs/${computed.run.id}/rows`, {
                loadValue: last.loadValue ?? 0,
                frequencyMhz: last.frequencyMhz != null ? last.frequencyMhz * 2 : null,
                fieldStrengthVM: last.fieldStrengthVM ?? 10,
              });
              await onStructuralChange();
            }}
          >
            Add a step
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            {measured} of {rows.length} steps recorded. A step passes when the field changes
            the indication by no more than the MPE at the applied load.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead className="text-right">Frequency (MHz)</TableHead>
                <TableHead className="text-right">Field (V/m)</TableHead>
                <TableHead className="text-right">Load (g)</TableHead>
                <TableHead className="text-right">Before (g)</TableHead>
                <TableHead className="text-right">After (g)</TableHead>
                <TableHead className="text-right" title="The change in indication caused by the exposure">Disturbance</TableHead>
                <TableHead className="text-right">MPE</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.sequenceNo} className={cn(row.rowPass === false && "bg-reject-wash/40")}>
                  <TableCell className="text-sm text-muted-foreground">{row.sequenceNo}</TableCell>
                  <TableCell>
                    <NumCell
                      value={row.frequencyMhz}
                      label={`Exposure frequency for step ${row.sequenceNo}, megahertz`}
                      onInput={(v) => set(i, { frequencyMhz: v })}
                      onFlush={() => saver.flush()}
                      invalid={row.frequencyMhz != null && row.frequencyMhz <= 0}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.fieldStrengthVM}
                      label={`Field strength for step ${row.sequenceNo}, volts per metre`}
                      onInput={(v) => set(i, { fieldStrengthVM: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.loadValue}
                      label={`Load for step ${row.sequenceNo}`}
                      onInput={(v) => set(i, { loadValue: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indicationBefore}
                      label={`Indication before exposure, step ${row.sequenceNo}`}
                      onInput={(v) => set(i, { indicationBefore: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indicationAfter}
                      label={`Indication after exposure, step ${row.sequenceNo}`}
                      onInput={(v) => set(i, { indicationAfter: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <ErrorValue error={row.error} pass={row.rowPass} dp={dp} signed={fmtSigned} />
                  </TableCell>
                  <TableCell className="tnum text-right text-sm">±{fmt(row.mpe, dp)}</TableCell>
                  <TableCell>
                    <VerdictCell pass={row.rowPass} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-5 py-3 text-sm text-muted-foreground">
            {Number.isFinite(result.worstError) && result.worstError !== null
              ? `Largest disturbance observed: ${fmt(result.worstError, dp)} g.`
              : "No frequency steps recorded yet."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
