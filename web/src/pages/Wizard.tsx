import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Field, FormError, Input, Select, Stepper } from "../components/forms";

const STEPS = ["Examination", "Instrument", "Reference weights"];

interface Draft {
  manufacturer_name: string;
  manufacturer_address: string;
  contact_person: string;
  task_no: string;
  report_no: string;
  danak_no: string;
  standard_version: string;
  examination_start_date: string;
  examination_end_date: string;
  family_name: string;
  model: Record<string, string>;
  referenceWeights: number[];
}

function todayKey(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function initialDraft(standard: string): Draft {
  const today = todayKey();
  return {
    manufacturer_name: "",
    manufacturer_address: "",
    contact_person: "",
    task_no: "",
    report_no: "",
    danak_no: "",
    standard_version: standard,
    examination_start_date: today,
    examination_end_date: "",
    family_name: "",
    model: {
      model_name: "",
      max_capacity: "",
      min_capacity: "",
      e_value: "",
      d_value: "",
      accuracy_class: "II",
      fractional_factor_pi: "1",
      pan_shape: "rectangular_4corner",
      load_cell_type: "",
      load_cell_manufacturer: "",
      serial_no: "",
      mpd_span_stability: "0.25",
    },
    referenceWeights: [],
  };
}

export function Wizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromModelId = searchParams.get("from_model");
  const [standards, setStandards] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const prefilledRef = useRef(false);

  useEffect(() => {
    let live = true;
    api
      .get<{ standards: string[] }>("/standards")
      .then((data) => {
        if (!live) return;
        const list = data.standards ?? [];
        setStandards(list);
        setDraft(initialDraft(list[0] ?? ""));
      })
      .catch(() => {
        if (live) setDraft(initialDraft(""));
      });
    return () => {
      live = false;
    };
  }, []);

  // Deep link from the Instruments registry: prefill the instrument spec so a
  // resubmission or variant starts from recorded values instead of a blank
  // form. Examination-level fields (task, report, manufacturer) are always
  // per-examination and stay blank; name/serial identify the new unit.
  useEffect(() => {
    if (!fromModelId || !draft || prefilledRef.current) return;
    prefilledRef.current = true;
    let live = true;
    api
      .get<{ model: Record<string, any> }>(`/models/${fromModelId}`)
      .then((data) => {
        if (!live) return;
        const m = data.model ?? {};
        setDraft((d) => {
          if (!d) return d;
          const model = { ...d.model };
          for (const key of [
            "max_capacity",
            "min_capacity",
            "e_value",
            "d_value",
            "accuracy_class",
            "fractional_factor_pi",
            "pan_shape",
            "load_cell_type",
            "load_cell_manufacturer",
          ]) {
            if (m[key] !== null && m[key] !== undefined) model[key] = String(m[key]);
          }
          return { ...d, model };
        });
        setPrefillNote(
          `Instrument spec prefilled from ${m.model_name ?? "registry"}. Only the examination details and the new unit's name/serial need entering.`
        );
      })
      .catch(() => {
        if (live) setPrefillNote("Could not load the instrument spec — starting blank.");
      });
    return () => {
      live = false;
    };
  }, [fromModelId, draft]);

  if (!draft) return <p className="text-sm text-muted-foreground">Loading master data…</p>;

  const patch = (key: keyof Draft, value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const patchModel = (key: string, value: string) =>
    setDraft((d) => (d ? { ...d, model: { ...d.model, [key]: value } } : d));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">New type examination</h1>
        <Link to="/projects" className="ml-auto">
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
        </Link>
      </div>
      <Stepper steps={STEPS} active={step} />
      {prefillNote && (
        <p className="mb-4 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
          {prefillNote}
        </p>
      )}
      {step === 0 && (
        <StepProject draft={draft} standards={standards} patch={patch} next={() => setStep(1)} />
      )}
      {step === 1 && (
        <StepModel
          draft={draft}
          patchModel={patchModel}
          back={() => setStep(0)}
          next={(weights) => {
            setDraft((d) => (d ? { ...d, referenceWeights: weights } : d));
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <StepWeights
          draft={draft}
          setWeights={(weights) => setDraft((d) => (d ? { ...d, referenceWeights: weights } : d))}
          back={() => setStep(1)}
          done={(id) => navigate(`/projects/${id}`)}
        />
      )}
    </div>
  );
}

function StepProject({
  draft,
  standards,
  patch,
  next,
}: {
  draft: Draft;
  standards: string[];
  patch: (key: keyof Draft, value: string) => void;
  next: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const Continue = () => {
    const missing: Array<[string, string]> = [
      ["manufacturer_name", "Manufacturer"],
      ["task_no", "Task number"],
      ["report_no", "Report number"],
      ["family_name", "Instrument family"],
    ].filter(([key]) => !String(draft[key as keyof Draft]).trim());
    if (missing.length > 0) {
      setError(`Still needed: ${missing.map(([, label]) => label).join(", ")}.`);
      return;
    }
    if (
      draft.examination_start_date &&
      draft.examination_end_date &&
      draft.examination_start_date > draft.examination_end_date
    ) {
      setError("Examination start date must be on or before examination end date.");
      return;
    }
    setError(null);
    next();
  };
  const text = (key: keyof Draft, placeholder?: string) => (
    <Input
      value={String(draft[key] ?? "")}
      placeholder={placeholder}
      onChange={(e) => patch(key, e.target.value)}
    />
  );
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Examination</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="Task number">{text("task_no", "A530947")}</Field>
            <Field label="Report number">{text("report_no", "DANAK-1911302")}</Field>
            <Field label="DANAK / notified body no.">{text("danak_no", "Optional")}</Field>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Select
              label="Standard"
              hint="Selects which checklist clauses and test sheets apply. Listed from the seeded master data."
              value={draft.standard_version}
              onChange={(v) => patch("standard_version", v)}
              options={standards.map((s) => [s, s] as [string, string])}
            />
            <Field label="Examination start">
              <Input
                type="date"
                value={draft.examination_start_date}
                onChange={(e) => patch("examination_start_date", e.target.value)}
              />
            </Field>
            <Field label="Examination end">
              <Input
                type="date"
                value={draft.examination_end_date}
                onChange={(e) => patch("examination_end_date", e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Manufacturer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ManufacturerPicker
            onPick={(m) => {
              patch("manufacturer_name", m.name ?? "");
              patch("manufacturer_address", m.address ?? "");
              patch("contact_person", m.contact_person ?? "");
            }}
          />
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="Name">{text("manufacturer_name", "Taiwan Scale Mfg. Co. Ltd.")}</Field>
            <Field label="Contact person">{text("contact_person", "Optional")}</Field>
          </div>
          <Field label="Address">{text("manufacturer_address", "Optional")}</Field>
          <Field
            label="Instrument family"
            hint="The family groups the models examined together under one report."
          >
            {text("family_name", "NHB series")}
          </Field>
        </CardContent>
      </Card>
      <FormError message={error} />
      <div className="flex justify-end">
        <Button variant="accent" onClick={Continue}>
          Continue to instrument
        </Button>
      </div>
    </div>
  );
}

/**
 * Manufacturer picker: fetch from the Manage → Manufacturers directory instead
 * of retyping. Fills name, address, and contact; the examination still creates
 * (or finds) the record by name on submit.
 */
function ManufacturerPicker({
  onPick,
}: {
  onPick: (m: { name?: string | null; address?: string | null; contact_person?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setNote(null);
    try {
      const data = (await api.get("/manufacturers")) as { manufacturers: any[] };
      const q = query.trim().toLowerCase();
      const list = (data.manufacturers ?? []).filter(
        (m: any) =>
          !q ||
          [m.name, m.contact_person, m.email].filter(Boolean).some((f: string) =>
            String(f).toLowerCase().includes(q)
          )
      );
      setResults(list);
      if (list.length > 0) setSelected(String(list[0].id));
      if (list.length === 0) setNote("No manufacturers match — or add one under Manage.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const use = () => {
    const m = results.find((r: any) => String(r.id) === selected);
    if (m) {
      onPick(m);
      setNote(`Filled from ${m.name}.`);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => { setOpen(true); void search(); }}>
          Pick from directory
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search the directory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
        />
        <Button variant="outline" size="sm" onClick={() => void search()} disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            aria-label="Pick a manufacturer from the directory"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 flex-1 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            {results.map((r: any) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
                {r.contact_person ? ` · ${r.contact_person}` : ""}
              </option>
            ))}
          </select>
          <Button variant="accent" size="sm" onClick={use} disabled={!selected}>
            Use this
          </Button>
        </div>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function StepModel({
  draft,
  patchModel,
  back,
  next,
}: {
  draft: Draft;
  patchModel: (key: string, value: string) => void;
  back: () => void;
  next: (weights: number[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = draft.model;

  const max = Number(m.max_capacity);
  const e = Number(m.e_value);
  const nValid = Number.isFinite(max) && Number.isFinite(e) && max > 0 && e > 0;
  const n = nValid ? Math.round(max / e) : null;

  const Continue = async () => {
    const problems: string[] = [];
    if (!String(m.model_name).trim()) problems.push("Model name");
    if (!(Number(m.max_capacity) > 0)) problems.push("Max");
    if (!(Number(m.e_value) > 0)) problems.push("e");
    if (!(Number(m.min_capacity) >= 0)) problems.push("Min");
    if (Number(m.min_capacity) >= Number(m.max_capacity)) problems.push("Min must be below Max");
    if (problems.length > 0) {
      setError(`Check: ${problems.join(", ")}.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const data = (await api.post("/reference-weights/suggest", {
        max_capacity: Number(m.max_capacity),
        min_capacity: Number(m.min_capacity),
        e_value: Number(m.e_value),
        d_value: m.d_value === "" ? undefined : Number(m.d_value),
        accuracy_class: m.accuracy_class,
        fractional_factor_pi: Number(m.fractional_factor_pi) || 1,
        mpd_span_stability: Number(m.mpd_span_stability) || 0.25,
      })) as { referenceWeights: number[] };
      next(data.referenceWeights ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate weights.");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Input value={m[key] ?? ""} onChange={(ev) => patchModel(key, ev.target.value)} {...props} />
  );

  return (
    <div className="flex flex-col gap-4">
      <SpecReuse patchModel={patchModel} />
      <Card>
        <CardHeader>
          <CardTitle>Instrument model</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="Model name">{text("model_name", { placeholder: "NHB150" })}</Field>
            <Field label="Serial number">{text("serial_no", { placeholder: "Optional" })}</Field>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="Max (g)">{text("max_capacity", { type: "number", step: "any", placeholder: "150" })}</Field>
            <Field label="Min (g)">{text("min_capacity", { type: "number", step: "any", placeholder: "0.4" })}</Field>
            <Field label="e — verification interval (g)">{text("e_value", { type: "number", step: "any", placeholder: "0.02" })}</Field>
            <Field label="d — actual interval (g)" hint="Leave blank when d = e.">
              {text("d_value", { type: "number", step: "any", placeholder: "Defaults to e" })}
            </Field>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Select
              label="Accuracy class"
              value={m.accuracy_class}
              onChange={(v) => patchModel("accuracy_class", v)}
              options={[["I", "Class I"], ["II", "Class II"], ["III", "Class III"], ["IIII", "Class IIII"]]}
            />
            <Select
              label="Load receptor"
              hint="Sets the eccentricity loading positions."
              value={m.pan_shape}
              onChange={(v) => patchModel("pan_shape", v)}
              options={[["rectangular_4corner", "Rectangular — 4 corners"], ["triangular_3point", "Triangular — 3 points"]]}
            />
          </div>
          <div className="rounded-md border bg-muted/50 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              n = Max / e (preview — the server writes the stored value)
            </span>
            <div className="tnum text-xl font-bold">
              {n === null ? "–" : n.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {n === null
                ? "Enter Max and e."
                : m.accuracy_class === "II" && n < 5000
                  ? "Class II normally requires n ≥ 5000. Check e."
                  : `${max} / ${e} = ${n} verification intervals`}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Load cell (optional)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row">
          <Field label="Type">{text("load_cell_type", { placeholder: "Single point" })}</Field>
          <Field label="Manufacturer">{text("load_cell_manufacturer", { placeholder: "Optional" })}</Field>
        </CardContent>
      </Card>
      <FormError message={error} />
      <div className="flex justify-between">
        <Button variant="outline" onClick={back}>
          Back
        </Button>
        <Button variant="accent" onClick={Continue} disabled={busy}>
          {busy ? "Generating weights…" : "Continue to weights"}
        </Button>
      </div>
    </div>
  );
}
/**
 * Spec reuse: copy Max/Min/e/d, class, receptor and load-cell details from a
 * previously examined instrument. The new model keeps its own name and serial;
 * reference weights regenerate from the copied spec on Continue.
 */
function SpecReuse({ patchModel }: { patchModel: (key: string, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setNote(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (query.trim()) params.set("search", query.trim());
      const data = (await api.get(`/models?${params}`)) as { models: any[] };
      setResults(data.models ?? []);
      if (data.models?.length > 0) setSelected(String(data.models[0].id));
      if ((data.models ?? []).length === 0) setNote("No instruments match.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const reuse = async () => {
    if (!selected) return;
    setBusy(true);
    setNote(null);
    try {
      const data = (await api.get(`/models/${selected}`)) as { model: Record<string, any> };
      const m = data.model ?? {};
      for (const key of [
        "max_capacity",
        "min_capacity",
        "e_value",
        "d_value",
        "accuracy_class",
        "fractional_factor_pi",
        "pan_shape",
        "load_cell_type",
        "load_cell_manufacturer",
      ]) {
        if (m[key] !== null && m[key] !== undefined) patchModel(key, String(m[key]));
      }
      setNote(
        `Spec copied from ${m.model_name ?? "instrument"}. Give the new model its own name and serial number.`
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not copy the spec.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-5">
        <div>
          <Button variant="outline" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide spec reuse" : "Reuse an existing instrument's spec"}
          </Button>
        </div>
        {open && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Model, family, task no., manufacturer…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void search();
                }}
              />
              <Button variant="outline" size="sm" onClick={() => void search()} disabled={busy}>
                {busy ? "Searching…" : "Search"}
              </Button>
            </div>
            {results.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  aria-label="Pick an instrument to copy the spec from"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-9 flex-1 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
                >
                  {results.map((r: any) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.model_name} · Max {r.max_capacity} · e {r.e_value} · {r.task_no}
                    </option>
                  ))}
                </select>
                <Button variant="accent" size="sm" onClick={() => void reuse()} disabled={busy || !selected}>
                  Copy spec
                </Button>
              </div>
            )}
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepWeights({
  draft,
  setWeights,
  back,
  done,
}: {
  draft: Draft;
  setWeights: (w: number[]) => void;
  back: () => void;
  done: (id: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const weights = draft.referenceWeights;

  const Create = async () => {
    const list = weights.filter((v) => Number(v) > 0).sort((a, b) => a - b);
    if (list.length === 0) {
      setError("At least one reference weight is required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const m = draft.model;
      const created = (await api.post("/projects", {
        manufacturer_name: draft.manufacturer_name,
        manufacturer_address: draft.manufacturer_address || undefined,
        contact_person: draft.contact_person || undefined,
        task_no: draft.task_no,
        report_no: draft.report_no,
        danak_no: draft.danak_no || undefined,
        standard_version: draft.standard_version,
        examination_start_date: draft.examination_start_date || undefined,
        examination_end_date: draft.examination_end_date || undefined,
        family_name: draft.family_name,
        models: [
          {
            ...m,
            max_capacity: Number(m.max_capacity),
            min_capacity: Number(m.min_capacity),
            e_value: Number(m.e_value),
            d_value: m.d_value === "" ? undefined : Number(m.d_value),
            fractional_factor_pi: Number(m.fractional_factor_pi) || 1,
            mpd_span_stability: Number(m.mpd_span_stability) || 0.25,
            referenceWeights: list,
          },
        ],
      })) as { id: number };
      done(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the examination.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Reference weights</CardTitle>
          <CardDescription>
            Generated from Max, Min and e as the standard fractions of Max used for the weighing
            performance tests. Adjust to the weights actually available in the laboratory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">No.</TableHead>
                <TableHead>Nominal load (g)</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {weights.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground">
                    No weights in the set.
                  </TableCell>
                </TableRow>
              )}
              {weights.map((value, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="any"
                      aria-label={`Reference weight ${i + 1} in grams`}
                      value={value}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setWeights(weights.map((w, j) => (j === i ? (Number.isFinite(next) ? next : 0) : w)));
                      }}
                      className="tnum"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setWeights(weights.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeights([...weights, Number(draft.model.max_capacity) || 0])}
            >
              Add a weight
            </Button>
            <span className="text-xs text-muted-foreground">{weights.length} in the set</span>
          </div>
        </CardContent>
      </Card>
      <FormError message={error} />
      <div className="flex justify-between">
        <Button variant="outline" onClick={back}>
          Back
        </Button>
        <Button variant="accent" onClick={Create} disabled={busy}>
          {busy ? "Creating…" : "Create examination"}
        </Button>
      </div>
    </div>
  );
}
