import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SearchX, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Field } from "../components/forms";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

interface Instrument {
  id: number;
  model_name: string;
  serial_no: string | null;
  max_capacity: number;
  min_capacity: number;
  e_value: number;
  d_value: number;
  n_intervals: number;
  accuracy_class: string;
  pan_shape: string | null;
  load_cell_type: string | null;
  load_cell_manufacturer: string | null;
  family_id: number;
  family_name: string;
  project_id: number;
  task_no: string;
  report_no: string;
  standard_version: string;
  project_status: string;
  manufacturer_name: string;
  run_count: number;
}

const EDITABLE_KEYS = [
  "model_name",
  "serial_no",
  "max_capacity",
  "min_capacity",
  "e_value",
  "d_value",
  "accuracy_class",
  "pan_shape",
  "load_cell_type",
  "load_cell_manufacturer",
] as const;

/**
 * Instrument repository: every model examined across all projects, editable in
 * place. Correct a spec here and every sheet under it computes from the new
 * values. Sheets themselves live under their examination, not here.
 */
export function Instruments() {
  const [models, setModels] = useState<Instrument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: "100" });
      if (query.trim()) params.set("search", query.trim());
      api
        .get<{ models: Instrument[] }>(`/models?${params}`)
        .then((data) => {
          if (live) setModels(data.models ?? []);
        })
        .catch((err) => {
          if (live) setError(err instanceof ApiError ? err.message : "Could not load instruments.");
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, refreshKey]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </div>
    );
  }
  if (!models) return <p className="text-sm text-muted-foreground">Loading instruments…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Instruments</h1>
        <p className="text-sm text-muted-foreground">
          {models.length === 0
            ? "No instruments recorded yet."
            : `${models.length} instrument${models.length === 1 ? "" : "s"} across all examinations. Edit a spec in place, or start a new examination from it.`}
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <Input
            type="search"
            aria-label="Search instruments"
            placeholder="Model, family, task no., manufacturer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instrument</TableHead>
              <TableHead>Spec</TableHead>
              <TableHead>Examination</TableHead>
              <TableHead className="text-right">Sheets</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <SearchX className="h-4 w-4" aria-hidden="true" />
                    Nothing matches that search.
                  </div>
                </TableCell>
              </TableRow>
            )}
            {models.map((m) => (
              <Fragment key={m.id}>
                <TableRow>
                  <TableCell>
                    <div className="font-semibold">{m.model_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[m.family_name, m.serial_no ? `S/N ${m.serial_no}` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="tnum">
                      Max {m.max_capacity} g · e {m.e_value} g · n {m.n_intervals}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Class {m.accuracy_class} · {m.manufacturer_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/projects/${m.project_id}`} className="font-semibold text-primary hover:underline">
                      {m.task_no || `Project ${m.project_id}`}
                    </Link>
                    <div className="text-xs text-muted-foreground">{m.project_status}</div>
                  </TableCell>
                  <TableCell className="tnum text-right text-sm text-muted-foreground">
                    {m.run_count}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId((id) => (id === m.id ? null : m.id))}
                      >
                        {editingId === m.id ? "Close" : "Edit"}
                      </Button>
                      <Link to={`/projects/new?from_model=${m.id}`}>
                        <Button size="sm" variant="outline">
                          New exam
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
                {editingId === m.id && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/40">
                      <EditForm
                        instrument={m}
                        onDone={() => {
                          setEditingId(null);
                          setRefreshKey((k) => k + 1);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export function EditForm({
  instrument,
  onDone,
  onCancel,
}: {
  instrument: Instrument;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of EDITABLE_KEYS) {
      const v = instrument[key as keyof Instrument];
      init[key] = v === null || v === undefined ? "" : String(v);
    }
    return init;
  });
  // Full record behind the form: the editor only shows the common spec fields,
  // but the save carries the untouched columns (cell ratings, power, tare
  // types…) back verbatim so editing a name cannot reset them to defaults.
  const [base, setBase] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ model: Record<string, any> }>(`/models/${instrument.id}`)
      .then((data) => {
        if (live) setBase(data.model ?? {});
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load the full record.");
      });
    return () => {
      live = false;
    };
  }, [instrument.id]);

  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!base) {
      setError("Full record still loading — try again in a moment.");
      return;
    }
    if (!form.model_name.trim()) {
      setError("Model name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...base };
      delete body.id;
      delete body.spec;
      delete body.referenceWeights;
      for (const key of EDITABLE_KEYS) body[key] = form[key];
      // Empty optionals go as null so the server keeps them blank, not "0".
      for (const key of ["serial_no", "d_value", "load_cell_type", "load_cell_manufacturer"]) {
        if (String(body[key] ?? "").trim() === "") body[key] = null;
      }
      await api.put(`/models/${instrument.id}`, body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Input value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} {...props} />
  );

  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Model name">{text("model_name")}</Field>
        <Field label="Serial number">{text("serial_no", { placeholder: "Optional" })}</Field>
        <Field label="Accuracy class">
          <select
            aria-label="Accuracy class"
            value={form.accuracy_class}
            onChange={(e) => set("accuracy_class", e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            {["I", "II", "III", "IIII"].map((c) => (
              <option key={c} value={c}>
                Class {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Load receptor">
          <select
            aria-label="Load receptor"
            value={form.pan_shape}
            onChange={(e) => set("pan_shape", e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            <option value="rectangular_4corner">Rectangular — 4 corners</option>
            <option value="triangular_3point">Triangular — 3 points</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Max (g)">{text("max_capacity", { type: "number", step: "any" })}</Field>
        <Field label="Min (g)">{text("min_capacity", { type: "number", step: "any" })}</Field>
        <Field label="e (g)">{text("e_value", { type: "number", step: "any" })}</Field>
        <Field label="d (g)">{text("d_value", { type: "number", step: "any", placeholder: "Defaults to e" })}</Field>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Load cell type">{text("load_cell_type", { placeholder: "Optional" })}</Field>
        <Field label="Load cell manufacturer">{text("load_cell_manufacturer", { placeholder: "Optional" })}</Field>
      </div>
      {error && <p className="text-sm text-reject">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="accent" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
