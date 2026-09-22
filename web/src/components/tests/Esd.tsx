import { useRef, useState } from "react";
import { fmt, fmtSigned, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { useDerivedSync } from "../../lib/rowsync";
import { api } from "../../lib/api";
import { NumCell, SelectCell, VerdictCell, ErrorValue } from "../../components/cells";
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

const FALLBACK_MODES: Array<[string, string]> = [
  ["contact", "Contact"],
  ["air", "Air"],
];
const POLARITIES: Array<[string, string]> = [
  ["positive", "Positive"],
  ["negative", "Negative"],
];
const FALLBACK_NOTE =
  "Humidity matters here: electrostatic discharge testing is specified within a " +
  "humidity range because dry air changes the discharge behaviour.";

function cap(word: string) {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

export function EsdForm({ computed, save, onDirty, onStructuralChange }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const result = computed.result ?? {};
  const [rows, setRows] = useState<any[]>(() => (result.rows ?? []).map((r: any) => ({ ...r })));
  useDerivedSync(setRows, result.rows, [
    "sequenceNo",
    "loadValue",
    "testVoltageKv",
    "applicationMode",
    "polarity",
    "indicationBefore",
    "indicationAfter",
  ]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const spec = result.disturbance ?? {};
  const stepNoun: string = spec.stepNoun ?? "discharge";
  const modes: Array<[string, string]> = spec.modes ?? FALLBACK_MODES;
  const note: string = spec.note ?? FALLBACK_NOTE;

  const payload = () =>
    rowsRef.current.map((row: any) => ({
      sequenceNo: row.sequenceNo,
      loadValue: row.loadValue ?? 0,
      testVoltageKv: row.testVoltageKv ?? null,
      applicationMode: row.applicationMode ?? null,
      polarity: row.polarity ?? null,
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
        note={note}
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{cap(stepNoun)} steps</CardTitle>
          <Button
            size="sm"
            onClick={async () => {
              await saver.flush();
              const last = rowsRef.current[rowsRef.current.length - 1] ?? {};
              await api.post(`/test-runs/${computed.run.id}/rows`, {
                loadValue: last.loadValue ?? 0,
                testVoltageKv: last.testVoltageKv ?? spec.levels?.[0]?.[0] ?? 4,
                applicationMode: last.applicationMode ?? modes[0]?.[0] ?? "contact",
                polarity: last.polarity === "positive" ? "negative" : "positive",
              });
              await onStructuralChange();
            }}
          >
            Add a step
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            {measured} of {rows.length} steps recorded. A step passes when the {stepNoun} changes
            the indication by no more than one verification interval.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead className="text-right">Voltage (kV)</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Polarity</TableHead>
                <TableHead className="text-right">Load (g)</TableHead>
                <TableHead className="text-right">Before (g)</TableHead>
                <TableHead className="text-right">After (g)</TableHead>
                <TableHead className="text-right" title={`The change in indication caused by the ${stepNoun}`}>Disturbance</TableHead>
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
                      value={row.testVoltageKv}
                      label={`Test voltage for step ${row.sequenceNo}`}
                      onInput={(v) => set(i, { testVoltageKv: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <SelectCell
                      value={row.applicationMode}
                      label={`Application mode for step ${row.sequenceNo}`}
                      options={modes}
                      onInput={(v) => set(i, { applicationMode: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <SelectCell
                      value={row.polarity}
                      label={`Polarity for step ${row.sequenceNo}`}
                      options={POLARITIES}
                      onInput={(v) => set(i, { polarity: v })}
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
                      label={`Indication before the ${stepNoun}, step ${row.sequenceNo}`}
                      onInput={(v) => set(i, { indicationBefore: v })}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell>
                    <NumCell
                      value={row.indicationAfter}
                      label={`Indication after the ${stepNoun}, step ${row.sequenceNo}`}
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
              : `No ${stepNoun} steps recorded yet.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
