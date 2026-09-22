import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { cn } from "../lib/utils";
import { Attachments } from "../components/Attachments";
import { WeighingForm } from "../components/tests/Weighing";
import { RepeatabilityForm } from "../components/tests/Repeatability";
import { EccentricityForm } from "../components/tests/Eccentricity";
import { EsdForm } from "../components/tests/Esd";
import { RadiatedForm } from "../components/tests/Radiated";
import { SpanForm } from "../components/tests/Span";
import { EquilibriumForm } from "../components/tests/Equilibrium";
import { ZeroCreepForm } from "../components/tests/ZeroCreep";
import type { SheetFormProps } from "../components/tests/types";

const FORMS: Record<string, React.ComponentType<SheetFormProps>> = {
  weighing_performance: WeighingForm,
  repeatability: RepeatabilityForm,
  eccentricity: EccentricityForm,
  esd: EsdForm,
  radiated: RadiatedForm,
  span_stability: SpanForm,
  equilibrium: EquilibriumForm,
  zero_creep: ZeroCreepForm,
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function verdictVariant(v: string | undefined) {
  if (v === "pass") return "pass" as const;
  if (v === "fail") return "fail" as const;
  if (v === "incomplete") return "incomplete" as const;
  return "not_started" as const;
}

export function Model() {
  const { modelId, code } = useParams();
  const [overview, setOverview] = useState<any | null>(null);
  const [computed, setComputed] = useState<any | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveNote, setSaveNote] = useState<string>("");
  const remarksRef = useRef<HTMLTextAreaElement | null>(null);

  // Overview: model, project, and the rail of test sheets.
  useEffect(() => {
    let live = true;
    setOverview(null);
    setComputed(null);
    api
      .get(`/models/${modelId}/tests`)
      .then((data) => {
        if (live) setOverview(data);
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load test sheets.");
      });
    return () => {
      live = false;
    };
  }, [modelId]);

  // Open (idempotent create) + fetch the active sheet's run.
  // Generation-guarded: rapid sheet/model switches fire overlapping opens, and
  // only the latest may paint — otherwise a slow create for the previous sheet
  // overwrites the current one with a stranger's run id.
  const openGen = useRef(0);
  useEffect(() => {
    if (!overview || !code) return;
    let live = true;
    const my = ++openGen.current;
    const entry = (overview.tests ?? []).find((t: any) => t.code === code);
    if (!entry) {
      setError(`No test type "${code}" applies to this instrument.`);
      return;
    }
    (async () => {
      try {
        let runId = entry.testRunId;
        if (runId == null) {
          const created = (await api.post(`/models/${modelId}/tests/${code}`, {})) as any;
          runId = created.testRun?.run?.id ?? created.testRun?.id ?? created.id;
          entry.testRunId = runId;
        }
        let data;
        try {
          data = (await api.get(`/test-runs/${runId}`)) as any;
        } catch (err) {
          // Stale id (run deleted with its project while this tab stayed open):
          // drop it and open fresh once instead of stranding the sheet on a 404.
          if (err instanceof ApiError && err.status === 404 && entry.testRunId != null) {
            entry.testRunId = null;
            const created = (await api.post(`/models/${modelId}/tests/${code}`, {})) as any;
            runId = created.testRun?.run?.id ?? created.testRun?.id ?? created.id;
            entry.testRunId = runId;
            data = (await api.get(`/test-runs/${runId}`)) as any;
          } else {
            throw err;
          }
        }
        if (live && openGen.current === my) {
          setComputed(data.testRun);
          setSaveState("idle");
        }
      } catch (err) {
        if (live && openGen.current === my)
          setError(err instanceof ApiError ? err.message : `Could not start ${entry.displayName}.`);
      }
    })();
    return () => {
      live = false;
    };
  }, [overview, modelId, code]);

  const save = useCallback(
    async (rows: unknown[] | undefined, extra: Record<string, unknown> = {}) => {
      if (!computed) return computed;
      setSaveState("saving");
      try {
        const res = (await api.put(`/test-runs/${computed.run.id}`, {
          remarks: remarksRef.current?.value,
          rows,
          ...extra,
        })) as any;
        const next = res.testRun ?? computed;
        setComputed(next);
        setSaveState("saved");
        setSaveNote(new Date().toLocaleTimeString());
        setOverview((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            tests: (prev.tests ?? []).map((t: any) =>
              t.code === code ? { ...t, verdict: next.verdict, testRunId: next.run.id } : t
            ),
          };
        });
        return next;
      } catch (err) {
        setSaveState("error");
        setSaveNote(err instanceof ApiError ? err.message : "Save failed.");
        throw err;
      }
    },
    [computed, code]
  );

  /** Refetch after structural changes (row added, readings cleared). */
  const onStructuralChange = useCallback(async () => {
    if (!computed) return;
    const data = (await api.get(`/test-runs/${computed.run.id}`)) as any;
    setComputed(data.testRun);
    setRevision((r) => r + 1);
  }, [computed]);

  if (error) return <p className="text-sm text-reject">{error}</p>;
  if (!overview) return <p className="text-sm text-muted-foreground">Loading test sheets…</p>;

  const { model, projectId, tests } = overview;
  const groups = new Map<string, any[]>();
  for (const t of tests ?? []) {
    const key = t.category ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const rail = (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Test sheets
        </p>
        <Link to={`/models/${modelId}`} className="text-sm font-semibold text-primary hover:underline">
          Instrument overview
        </Link>
      </div>
      {[...groups.entries()].map(([category, entries]) => (
        <div key={category}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {category}
          </p>
          <div className="flex flex-col gap-0.5">
            {entries.map((t: any) => (
              <Link
                key={t.code}
                to={t.formKind ? `/models/${modelId}/tests/${t.code}` : `#`}
                aria-disabled={!t.formKind}
                onClick={(e) => {
                  if (!t.formKind) e.preventDefault();
                }}
                title={
                  t.formKind
                    ? `${t.displayName} — ${t.reportSheetRef ?? ""}`
                    : `${t.displayName} — recorded as a declaration in the report, nothing to measure`
                }
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  t.code === code
                    ? "bg-steel-800 font-semibold text-white"
                    : "hover:bg-muted",
                  !t.formKind && "opacity-50"
                )}
              >
                <VerdictDot verdict={t.verdict} />
                <span className="min-w-0">
                  <span className="block truncate">{t.displayName}</span>
                  <span className={cn("block text-xs", t.code === code ? "text-white/60" : "text-muted-foreground")}>
                    {t.reportSheetRef ?? t.code}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // Instrument overview (no test selected).
  if (!code) {
    const enterable = (tests ?? []).filter((t: any) => t.formKind);
    const started = enterable.filter((t: any) => t.testRunId);
    const declarations = (tests ?? []).length - enterable.length;
    return (
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div>{rail}</div>
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-2xl font-bold tracking-tight">{model.model_name}</h1>
          <Card>
            <CardHeader>
              <CardTitle>Instrument</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              Max {model.max_capacity} g · Min {model.min_capacity} g · e {model.e_value} g · d{" "}
              {model.d_value} g · n {model.n_intervals} · Class {model.accuracy_class}
              <div className="mt-1 text-muted-foreground">
                Receptor {String(model.pan_shape ?? "").replace(/_/g, " ")} · Cell{" "}
                {model.load_cell_type ?? "—"}
              </div>
            </CardContent>
          </Card>
          <Card className="overflow-hidden p-0">
            <CardHeader>
              <CardTitle>Test sheets</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Verdict</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Sheet</TableHead>
                  <TableHead>Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tests ?? []).map((t: any) => (
                  <TableRow key={t.code}>
                    <TableCell>
                      <Badge variant={verdictVariant(t.verdict)}>{t.verdict}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.formKind ? (
                        <Link
                          to={`/models/${modelId}/tests/${t.code}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {t.displayName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t.displayName}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.reportSheetRef ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.category ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="text-sm text-muted-foreground">
            {started.length} of {enterable.length} measurable sheets started. {declarations}{" "}
            further clause{declarations === 1 ? "" : "s"} apply under this standard but have nothing
            to measure, and are recorded as declarations in the report.
          </p>
        </div>
      </div>
    );
  }

  const entry = (tests ?? []).find((t: any) => t.code === code);
  const Form = computed ? FORMS[computed.formKind as string] : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div>{rail}</div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{entry?.displayName ?? code}</h1>
          {computed && <Badge variant={verdictVariant(computed.verdict)}>{computed.verdict}</Badge>}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <SaveStatus state={saveState} note={saveNote} />
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!computed || !window.confirm("Clear every reading on this sheet? The test stays open for re-entry."))
                  return;
                await api.post(`/test-runs/${computed.run.id}/reset`, {});
                window.location.reload();
              }}
            >
              Clear readings
            </Button>
          </span>
        </div>
        <p className="-mt-2 text-sm text-muted-foreground">
          {[entry?.reportSheetRef, entry?.category].filter(Boolean).join(" · ")}
        </p>
        <Card>
          <CardContent className="pt-5 text-sm">
            Sourced from the instrument record and read-only here. Max {model.max_capacity} g ·
            Min {model.min_capacity} g · e {model.e_value} g · d {model.d_value} g · n{" "}
            {model.n_intervals} · Class {model.accuracy_class}
          </CardContent>
        </Card>
        {!computed ? (
          <p className="text-sm text-muted-foreground">Loading {entry?.displayName ?? "test"}…</p>
        ) : Form ? (
          <div key={`${computed.run.id}:${revision}`}>
            <Form
              computed={computed}
              save={save}
              onDirty={() => setSaveState("dirty")}
              onStructuralChange={onStructuralChange}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="pt-5 text-sm text-muted-foreground">
              This clause is recorded as a declaration in the report; it has no measurement table.
            </CardContent>
          </Card>
        )}
        {computed && (
          <>
            <Attachments projectId={projectId} modelId={Number(modelId)} runId={computed.run.id} />
            <Card>
              <CardHeader>
                <CardTitle>Remarks</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <textarea
                  ref={remarksRef}
                  rows={3}
                  defaultValue={computed.run?.remarks ?? ""}
                  placeholder="Conditions, deviations, anything a reader of the report would need to know."
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm shadow-xs"
                />
                <div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api.put(`/test-runs/${computed.run.id}`, {
                        remarks: remarksRef.current?.value ?? "",
                      });
                      setSaveState("saved");
                      setSaveNote(new Date().toLocaleTimeString());
                    }}
                  >
                    Save remarks
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function VerdictDot({ verdict }: { verdict: string }) {
  const color =
    verdict === "pass"
      ? "bg-verify"
      : verdict === "fail"
        ? "bg-reject"
        : verdict === "incomplete"
          ? "bg-pending"
          : "bg-muted-foreground/40";
  return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color)} aria-hidden="true" />;
}

function SaveStatus({ state, note }: { state: SaveState; note: string }) {
  const text =
    state === "saving"
      ? "Saving…"
      : state === "dirty"
        ? "Unsaved changes"
        : state === "saved"
          ? `Saved ${note}`
          : state === "error"
            ? `Save failed: ${note}`
            : "";
  if (!text) return null;
  return (
    <span className={cn("font-semibold", state === "error" ? "text-reject" : "")}>{text}</span>
  );
}
