import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SearchX, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
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

/**
 * Instrument registry: every model examined across all projects.
 *
 * The point is spec reuse — a resubmission or family variant starts from a
 * recorded spec instead of a blank wizard form — plus cross-project memory
 * (which examination a model came from, how many sheets it has started).
 */
export function Instruments() {
  const [models, setModels] = useState<Instrument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
  }, [query]);

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
            : `${models.length} instrument${models.length === 1 ? "" : "s"} across all examinations. Reuse a spec from the New Examination wizard.`}
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
              <TableHead className="w-28" />
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
              <TableRow key={m.id}>
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
                  <Link to={`/models/${m.id}`}>
                    <Button size="sm">Open sheets</Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
