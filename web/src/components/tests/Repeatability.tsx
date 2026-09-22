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

export function RepeatabilityForm({ computed, save, onDirty, onStructuralChange }: SheetFormProps) {
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
    // Sync the ref immediately: flush() reads it, and must not wait for the re-render.
    // Rows keep stable _uid keys so a renumber after deletion never hands a removed
    // row's DOM node (and its typed text) to its successor.
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
  const set = (index: number, indication: number | null) => {
    setTrials((prev) => prev.map((t, i) => (i === index ? { ...t, indication } : t)));
    touch();
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
        fields={["date", "time", "operator", "testLoad", "indicationZero", "temperature", "pressure"]}
        note="Every trial uses the same load, so it is recorded here rather than per row. Changing it re-evaluates the whole set."
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Trials</CardTitle>
          <Button
            size="sm"
            onClick={async () => {
              await saver.flush();
              await api.post(`/test-runs/${computed.run.id}/rows`, { loadValue: load, indication: null });
              await onStructuralChange();
            }}
          >
            Add a trial
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            {entered.length} of {trials.length} trials recorded at {fmt(load, dp)} g.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Trial</TableHead>
                <TableHead className="text-right">Indication I (g)</TableHead>
                <TableHead className="text-right" title="I − mean of the entered trials">Deviation from mean</TableHead>
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
                      label={`Indication for trial ${trial.sequenceNo}`}
                      onInput={(v) => set(i, v)}
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
                        title="Remove this trial"
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Range" value={`${fmt(result.range, dp)} g`} emphasis />
            <Stat label="Permitted (MPE)" value={`${fmt(result.mpe, dp)} g`} />
            <Stat label="Result" value={result.overallPass ? "Pass" : result.verdict === "incomplete" ? "—" : "Fail"} />
            <Stat label="Rule" value={result.label ?? ""} />
          </div>
          {Number.isFinite(result.range) && Number.isFinite(result.mpe) ? (
            <p className="mt-3 text-sm">
              {result.overallPass
                ? `The spread of ${fmt(result.range, dp)} g is within the ${fmt(result.mpe, dp)} g permitted at this load.`
                : `The spread of ${fmt(result.range, dp)} g exceeds the ${fmt(result.mpe, dp)} g permitted at this load.`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Enter every trial to judge the repeatability.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tnum font-bold ${emphasis ? "text-lg" : "text-sm"}`}>{value}</div>
    </div>
  );
}
