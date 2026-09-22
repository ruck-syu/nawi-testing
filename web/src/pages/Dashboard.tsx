import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SearchX, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { DateFilters, dateKey, inDateRange, type DateSort } from "../components/DateFilters";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
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

interface Project {
  id: number;
  task_no?: string;
  report_no?: string;
  danak_no?: string;
  manufacturer_name?: string;
  model_names?: string;
  modelNames?: string[];
  status: string;
  verdict?: string;
  passCount?: number;
  failCount?: number;
  incompleteCount?: number;
  examination_start_date?: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In progress",
  completed: "Completed",
  approved: "Approved",
  signed: "Signed",
};

function verdictVariant(v: string | undefined) {
  if (v === "pass") return "pass" as const;
  if (v === "fail") return "fail" as const;
  if (v === "incomplete") return "incomplete" as const;
  return "not_started" as const;
}

export function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateSort, setDateSort] = useState<DateSort>("desc");

  useEffect(() => {
    let live = true;
    api
      .get<{ projects: Project[] }>("/projects")
      .then((data) => {
        if (live) setProjects(data.projects ?? []);
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load examinations.");
      });
    return () => {
      live = false;
    };
  }, []);

  const visible = useMemo(() => {
    if (!projects) return [];
    const needle = query.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (status && p.status !== status) return false;
      if (verdict && (p.verdict ?? "not_started") !== verdict) return false;
      if (!inDateRange(p.examination_start_date, dateFrom, dateTo)) return false;
      if (!needle) return true;
      return [p.task_no, p.report_no, p.danak_no, p.manufacturer_name, p.model_names]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    const dir = dateSort === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Rows without a date sink to the end regardless of direction.
      const ka = dateKey(a.examination_start_date);
      const kb = dateKey(b.examination_start_date);
      if (!ka && !kb) return 0;
      if (!ka) return 1;
      if (!kb) return -1;
      if (ka === kb) return 0;
      return ka < kb ? -dir : dir;
    });
  }, [projects, query, status, verdict, dateFrom, dateTo, dateSort]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </div>
    );
  }

  if (projects === null) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading examinations">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Type examinations</h1>
          <p className="text-sm text-muted-foreground">
            {visible.length === projects.length
              ? `${projects.length} examination${projects.length === 1 ? "" : "s"}`
              : `${visible.length} of ${projects.length}`}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            type="search"
            aria-label="Search examinations"
            placeholder="Task no., report no., manufacturer, model…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
          />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by verdict"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            <option value="">Any verdict</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="incomplete">Incomplete</option>
            <option value="not_started">Not started</option>
          </select>
          <DateFilters
            from={dateFrom}
            to={dateTo}
            sort={dateSort}
            onFrom={setDateFrom}
            onTo={setDateTo}
            onSort={setDateSort}
            label="Started"
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Verdict</TableHead>
              <TableHead>Task / report no.</TableHead>
              <TableHead>Manufacturer</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tests</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <SearchX className="h-4 w-4" aria-hidden="true" />
                    {projects.length === 0
                      ? "No examinations yet — create the first one."
                      : "Nothing matches those filters."}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {visible.map((p) => (
              <TableRow
                key={p.id}
                className={cn(
                  "cursor-pointer hover:bg-muted/60",
                  p.verdict === "fail" && "bg-reject-wash/40"
                )}
                onClick={(e) => {
                  // Plain left-click anywhere on the row opens the examination.
                  // Modifier-clicks keep native new-tab behavior.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  navigate(`/projects/${p.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/projects/${p.id}`);
                }}
                tabIndex={0}
                aria-label={`Open examination ${p.task_no ?? p.id}`}
              >
                <TableCell>
                  <Badge variant={verdictVariant(p.verdict)}>{p.verdict ?? "not started"}</Badge>
                </TableCell>
                <TableCell>
                  <Link
                    to={`/projects/${p.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {p.task_no ?? `Project ${p.id}`}
                  </Link>
                  <div className="text-xs text-muted-foreground">{p.report_no}</div>
                </TableCell>
                <TableCell>{p.manufacturer_name ?? "—"}</TableCell>
                <TableCell className="max-w-48 truncate">
                  {p.modelNames?.length ? p.modelNames.join(", ") : p.model_names || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {STATUS_LABEL[p.status] ?? p.status}
                </TableCell>
                <TableCell className="tnum whitespace-nowrap text-right text-sm">
                  <span>{p.passCount ?? 0} pass</span>
                  {!!p.failCount && (
                    <span className="font-bold text-reject"> · {p.failCount} fail</span>
                  )}
                  {!!p.incompleteCount && (
                    <span className="text-muted-foreground"> · {p.incompleteCount} open</span>
                  )}
                </TableCell>
                <TableCell className="tnum whitespace-nowrap text-sm text-muted-foreground">
                  {(p.examination_start_date ?? "").slice(0, 10) || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
