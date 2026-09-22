import { useRef, useState } from "react";
import { fmt, fmtSigned, precisionOf } from "../../lib/format";
import { useAutosaver, withTableFlush } from "../../lib/autosave";
import { useDerivedSync } from "../../lib/rowsync";
import { NumCell, VerdictCell, ErrorValue } from "../../components/cells";
import { Conditions } from "../../components/Conditions";
import { PanDiagram } from "../../components/charts";
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

export function EccentricityForm({ computed, save, onDirty }: SheetFormProps) {
  const dp = precisionOf(computed.spec ?? {});
  const result = computed.result ?? {};
  const [rows, setRows] = useState<any[]>(() => (result.rows ?? []).map((r: any) => ({ ...r })));
  useDerivedSync(setRows, result.rows, [
    "sequenceNo",
    "positionCode",
    "positionLabel",
    "loadValue",
    "loadZero",
    "indication",
    "indicationZero",
  ]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const payload = () =>
    rowsRef.current.map((row: any) => ({
      sequenceNo: row.sequenceNo,
      positionCode: row.positionCode,
      positionLabel: row.positionLabel,
      loadValue: row.loadValue,
      loadZero: row.loadZero ?? 0,
      indication: row.indication ?? null,
      indicationZero: row.indicationZero ?? null,
    }));
  const saver = useAutosaver(() => save(payload()));
  const touch = () => {
    onDirty();
    saver.schedule();
  };

  const measured = rows.filter((r) => r.indication !== null && r.indication !== undefined).length;
  const failing = rows.filter((r) => r.rowPass === false);
  const receptor = String(result.panShape ?? "").replace(/_/g, " ");
  // Diagram reads local indications (instant) with server verdicts (judged): the dot for a
  // position just typed fills immediately instead of waiting a save cycle.
  const serverBySeq = new Map((result.rows ?? []).map((r: any) => [r.sequenceNo, r]));
  const diagramRows = rows.map((r) => ({
    positionCode: r.positionCode,
    indication: r.indication,
    rowPass: (serverBySeq.get(r.sequenceNo) as any)?.rowPass ?? r.rowPass,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Conditions
        run={computed.run ?? {}}
        save={withTableFlush(saver, save, payload)}
        fields={["date", "time", "operator", "temperature", "pressure"]}
        note={`Load receptor: ${receptor}. The test load and the zero reading are recorded per position.`}
      />
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Positions</CardTitle>
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
            {measured} of {rows.length} positions measured on a {receptor} receptor.
          </p>
          <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[1fr_220px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Position</TableHead>
                  <TableHead className="text-right">Load L (g)</TableHead>
                  <TableHead className="text-right">Indication I (g)</TableHead>
                  <TableHead className="text-right" title="E = I + 0.5e − L">Error E (g)</TableHead>
                  <TableHead className="text-right" title="Ec = E − E₀">Corrected Ec</TableHead>
                  <TableHead className="text-right">MPE</TableHead>
                  <TableHead>Verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={row.sequenceNo} className={cn(row.rowPass === false && "bg-reject-wash/40")}>
                    <TableCell>
                      <span className="tnum inline-flex h-6 w-6 items-center justify-center rounded-sm bg-steel-800 text-xs font-bold text-white">
                        {row.positionCode}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{row.positionLabel || row.positionCode}</TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{fmt(row.loadValue, dp)}</TableCell>
                    <TableCell>
                      <NumCell
                        value={row.indication}
                        label={`Indication with the load at ${row.positionLabel || row.positionCode}`}
                        onInput={(v) => {
                          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, indication: v } : r)));
                          touch();
                        }}
                        onFlush={() => saver.flush()}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <ErrorValue error={row.error} pass={row.rowPass} dp={dp} signed={fmtSigned} />
                    </TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">{fmt(row.correctedError, dp)}</TableCell>
                    <TableCell className="tnum text-right text-sm">±{fmt(row.mpe, dp)}</TableCell>
                    <TableCell>
                      <VerdictCell pass={row.rowPass} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PanDiagram positions={result.positions ?? []} rows={diagramRows} />
          </div>
          {failing.length > 0 && (
            <p className="px-5 pb-4 text-sm font-semibold text-reject">
              {failing.length} position{failing.length === 1 ? "" : "s"} outside tolerance.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
