import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SearchX, TriangleAlert } from "lucide-react";
import { api, ApiError, fileUrl } from "../lib/api";
import { DateFilters, dateKey, inDateRange, type DateSort } from "../components/DateFilters";
import { Button } from "../components/ui/button";
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

interface Report {
  id: number;
  project_id: number;
  report_no?: string;
  task_no?: string;
  manufacturer_name?: string;
  format?: string;
  file_path?: string;
  url?: string;
  overall_verdict?: string;
  generated_at?: string;
  generated_by?: string;
  pass_count?: number;
  fail_count?: number;
}

function verdictVariant(v: string | undefined) {
  if (v === "pass") return "pass" as const;
  if (v === "fail") return "fail" as const;
  if (v === "incomplete") return "incomplete" as const;
  return "not_started" as const;
}

function formatWhen(value?: string) {
  if (!value) return "—";
  const parsed = new Date(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Print an already-generated HTML report through a hidden iframe, keeping this screen. */
function printReport(url: string) {
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden;";
  frame.addEventListener("load", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank", "noopener");
    }
    setTimeout(() => frame.remove(), 60000);
  });
  document.body.append(frame);
}

export function Reports() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [verdict, setVerdict] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateSort, setDateSort] = useState<DateSort>("desc");
  const [generating, setGenerating] = useState(false);
  const [generateFor, setGenerateFor] = useState("");
  const [genFormat, setGenFormat] = useState("pdf");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.get<{ reports: Report[] }>("/reports"), api.get("/projects")])
      .then(([reportData, projectData]: any[]) => {
        if (!live) return;
        setReports(reportData.reports ?? []);
        const list = projectData.projects ?? [];
        setProjects(list);
        if (list.length > 0 && !generateFor) setGenerateFor(String(list[0].id));
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load reports.");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!reports) return [];
    const needle = query.trim().toLowerCase();
    const filtered = reports.filter((r) => {
      if (projectId && String(r.project_id) !== projectId) return false;
      if (verdict && r.overall_verdict !== verdict) return false;
      if (!inDateRange(r.generated_at, dateFrom, dateTo)) return false;
      if (!needle) return true;
      return [r.report_no, r.task_no, r.manufacturer_name, r.generated_by]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    const dir = dateSort === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const ka = dateKey(a.generated_at);
      const kb = dateKey(b.generated_at);
      if (!ka && !kb) return 0;
      if (!ka) return 1;
      if (!kb) return -1;
      if (ka === kb) return (b.id - a.id) * dir;
      return ka < kb ? -dir : dir;
    });
  }, [reports, query, projectId, verdict, dateFrom, dateTo, dateSort]);

  async function generate() {
    if (!generateFor) return;
    setGenerating(true);
    try {
      const data = (await api.post(`/projects/${generateFor}/reports`, { format: genFormat })) as {
        report?: Report;
        message?: string;
      };
      const report = (data.report ?? data) as Report;
      setNotice(data.message ?? "Report generated.");
      const project = projects.find((p: any) => String(p.id) === String(generateFor));
      const url = fileUrl(report.url ?? (report.file_path ? `/reports/${report.file_path}` : null));
      setReports((prev) => [
        {
          ...report,
          task_no: report.task_no ?? project?.task_no ?? null,
          manufacturer_name: report.manufacturer_name ?? project?.manufacturer_name ?? null,
          url,
        },
        ...(prev ?? []),
      ]);
      if (url) window.open(url, "_blank", "noopener");
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </div>
    );
  }
  if (!reports) return <p className="text-sm text-muted-foreground">Loading generated reports…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Report repository</h1>
        <div className="ml-auto flex items-center gap-2">
          <select
            aria-label="Examination to generate a report for"
            value={generateFor}
            onChange={(e) => setGenerateFor(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            {projects.map((p: any) => (
              <option key={p.id} value={String(p.id)}>
                {p.task_no ?? `Project ${p.id}`}
              </option>
            ))}
          </select>
          <select
            aria-label="Report format"
            value={genFormat}
            onChange={(e) => setGenFormat(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            <option value="pdf">PDF</option>
            <option value="docx">DOCX (Word)</option>
          </select>
          <Button variant="accent" size="sm" onClick={generate} disabled={generating || !generateFor}>
            {generating ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        Every generation is kept. Regenerating after a correction adds a row rather than replacing
        one, so an earlier version of a report stays available.
      </p>
      {notice && (
        <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            type="search"
            aria-label="Search generated reports"
            placeholder="Report no., task no., manufacturer, who generated it…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
          />
          <select
            aria-label="Filter by examination"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            <option value="">All examinations</option>
            {projects.map((p: any) => (
              <option key={p.id} value={String(p.id)}>
                {p.task_no ?? `Project ${p.id}`} — {p.manufacturer_name ?? ""}
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
          </select>
          <DateFilters
            from={dateFrom}
            to={dateTo}
            sort={dateSort}
            onFrom={setDateFrom}
            onTo={setDateTo}
            onSort={setDateSort}
            label="Generated"
          />
          <span className="ml-auto text-sm text-muted-foreground">
            {visible.length === reports.length
              ? `${reports.length} generation${reports.length === 1 ? "" : "s"}`
              : `${visible.length} of ${reports.length}`}
          </span>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Verdict</TableHead>
              <TableHead className="w-40">Generated</TableHead>
              <TableHead>Examination</TableHead>
              <TableHead className="text-right">Tests</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <SearchX className="h-4 w-4" aria-hidden="true" />
                    {reports.length === 0
                      ? "No reports generated yet."
                      : "Nothing matches those filters."}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {visible.map((r) => {
              const isLatest =
                reports.findIndex((o) => o.project_id === r.project_id) === reports.indexOf(r);
              const isDownload = ["pdf", "docx"].includes(r.format ?? "html");
              const isDocx = (r.format ?? "html") === "docx";
              return (
                <TableRow key={r.id} className={cn(r.overall_verdict === "fail" && "bg-reject-wash/40")}>
                  <TableCell>
                    <Badge variant={verdictVariant(r.overall_verdict)}>{r.overall_verdict}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{formatWhen(r.generated_at)}</div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {(r.format ?? "html").toUpperCase()}
                      {" · "}
                      {isLatest ? <span className="font-bold text-verify">Current</span> : "Superseded"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/projects/${r.project_id}`} className="font-semibold text-primary hover:underline">
                      {r.task_no ?? `Project ${r.project_id}`}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[r.report_no, r.manufacturer_name].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="tnum whitespace-nowrap text-right text-sm">
                    <span>{r.pass_count ?? 0} pass</span>
                    {!!r.fail_count && (
                      <span className="font-bold text-reject"> · {r.fail_count} fail</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.generated_by ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {r.url ? (
                        <a
                          href={fileUrl(r.url)}
                          target="_blank"
                          rel="noopener"
                          title={
                            isDocx
                              ? "Opens the file in Microsoft Word where it is the registered handler, otherwise downloads it."
                              : undefined
                          }
                        >
                          <Button size="sm">
                            {isDocx ? "Open in MS Word" : isDownload ? "Download" : "Open"}
                          </Button>
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">File missing</span>
                      )}
                      {r.url && !isDownload && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Opens the report and the browser print dialogue, which can save it as a PDF."
                          onClick={() => printReport(fileUrl(r.url as string))}
                        >
                          Print / PDF
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
