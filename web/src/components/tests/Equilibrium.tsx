import { useRef, useState } from "react";
import { fmt, fmtSigned, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { useDerivedSync } from "../../lib/rowsync";
import { api } from "../../lib/api";
import { NumCell } from "../../components/cells";
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

export function EquilibriumForm({ computed, save, onDirty, onStructuralChange }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const result = computed.result ?? {};
  const load = result.load ?? computed.run?.test_load ?? 0;
  const [trials, setTrials] = useState<any[]>(() =>
    (result.trials ?? []).map((t: any, k: number) => ({ ...t, _uid: k + 1 }))
  );
  useDerivedSync(setTrials, result.trials, ["sequenceNo", "loadValue", "indication"]);
  const uid = useRef(trials.length + 1);
  const rowsRef = useRef(trials);
  rowsRef.current = trials;
  const replaceAll = (next: any[]) => {
    for (const row of next) {
      if (row._uid === undefined) row._uid = uid.current++;
    }
    rowsRef.current = next;
    setTrials(next);
    onDirty();
  };

  const payload = () =>
    rowsRef.current.map((trial: any) => ({
      sequenceNo: trial.sequenceNo,
      loadValue: load,
      indication: trial.indication ?? null,
    }));
  const saver = useAutosaver(() => save(payload()));
  const touch = () => {
    onDirty();
    saver.schedule();
  };

  const entered = trials.filter((t) => t.indication !== null && t.indication !== undefined);
  const mean =
    entered.length > 0
      ? entered.reduce((total: number, t: any) => total + t.indication, 0) / entered.length
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Conditions
        run={computed.run ?? {}}
        save={withTableFlush(saver, save, payload)}
        fields={["date", "time", "operator", "testLoad", "temperature", "pressure"]}
        note="Every reading uses the same load, so it is recorded here rather than per row. Changing it re-evaluates the whole set."
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Readings</CardTitle>
          <Button
            size="sm"
            onClick={async () => {
              await saver.flush();
              await api.post(`/test-runs/${computed.run.id}/rows`, { loadValue: load, indication: null });
              await onStructuralChange();
            }}
          >
            Add a reading
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            {entered.length} of {trials.length} readings recorded at {fmt(load, dp)} g.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Reading</TableHead>
                <TableHead className="text-right">Indication I (g)</TableHead>
                <TableHead className="text-right" title="I − mean of the entered readings">Deviation from mean</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {trials.map((trial, i) => (
                <TableRow key={trial._uid}>
                  <TableCell className="text-sm text-muted-foreground">{trial.sequenceNo}</TableCell>
                  <TableCell>
                    <NumCell
                      value={trial.indication}
                      label={`Indication for reading ${trial.sequenceNo}`}
                      onInput={(v) => {
                        setTrials((prev) => prev.map((t, j) => (j === i ? { ...t, indication: v } : t)));
                        touch();
                      }}
                      onFlush={() => saver.flush()}
                    />
                  </TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">
                    {mean !== null && trial.indication !== null && trial.indication !== undefined
                      ? fmtSigned(trial.indication - mean, dp)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {trials.length > 3 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Remove this reading"
                        onClick={() => {
                          const next = trials.filter((_, j) => j !== i);
                          next.forEach((row, k) => {
                            row.sequenceNo = k + 1;
                          });
                          replaceAll(next);
                          void saver.flush();
                        }}
                      >
                        Remove
                      </Button>
                    )}
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
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Spread of readings</div>
              <div className="tnum text-lg font-bold">{fmt(result.spread, dp)} g</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Permitted spread</div>
              <div className="tnum text-lg font-bold">{fmt(result.tolerance, dp)} g</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Tolerance</div>
              <div className="tnum text-lg font-bold">
                {result.toleranceInE !== null && result.toleranceInE !== undefined
                  ? `${fmtSigned(result.toleranceInE, 1).replace("+", "")} e`
                  : "—"}
              </div>
            </div>
          </div>
          {Number.isFinite(result.spread) && Number.isFinite(result.tolerance) ? (
            <p className="mt-3 text-sm">
              {result.overallPass
                ? `The spread of ${fmt(result.spread, dp)} g is within the ${fmt(result.tolerance, dp)} g permitted.`
                : `The spread of ${fmt(result.spread, dp)} g exceeds the ${fmt(result.tolerance, dp)} g permitted.`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Enter at least two readings to judge the equilibrium.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
