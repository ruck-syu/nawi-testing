import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SearchX, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { DateFilters, type DateSort } from "../components/DateFilters";
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

interface PohAnchor {
  hash: string;
  slot: number;
  signature: string;
}

interface Run {
  id: number;
  testTypeCode: string;
  displayName?: string;
  modelId: number;
  projectId: number;
  verdict: string;
  reportSheetRef?: string;
  category?: string;
  taskNo?: string;
  modelName?: string;
  reportNo?: string;
  manufacturerName?: string;
  operatorName?: string;
  datePerformed?: string;
  updatedAt?: string;
  poh?: PohAnchor | null;
}

function verdictVariant(v: string) {
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

export function TestHistory() {
  const PAGE_SIZE = 50;
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [poh, setPoh] = useState<{ mode: string; cluster: string; anchored: number; verified: boolean } | null>(null);
  const [proof, setProof] = useState<Run | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [verdict, setVerdict] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateSort, setDateSort] = useState<DateSort>("desc");

  useEffect(() => {
    setPage(0);
  }, [query, type, verdict, projectId, dateFrom, dateTo, dateSort]);

  // Project directory changes rarely: fetch once, not per keystroke or page.
  useEffect(() => {
    let live = true;
    api
      .get("/projects")
      .then((projectData: any) => {
        if (live) setProjects(projectData.projects ?? []);
      })
      .catch(() => {
        /* the history table is the point; a missing directory only empties one filter */
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (query.trim()) params.set("search", query.trim());
    if (type) params.set("testType", type);
    if (verdict) params.set("verdict", verdict);
    if (projectId) params.set("projectId", projectId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    params.set("dateSort", dateSort);
    const timer = setTimeout(() => {
      Promise.all([
        api.get<{ testRuns: Run[]; total?: number; poh?: any }>(`/test-runs?${params}`),
      ])
        .then(([runsData]: any[]) => {
          if (!live) return;
          setRuns(runsData.testRuns ?? []);
          setTotal(Number(runsData.total ?? runsData.testRuns?.length ?? 0));
          setPoh(runsData.poh ?? null);
        })
        .catch((err) => {
          if (live) setError(err instanceof ApiError ? err.message : "Could not load history.");
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, type, verdict, projectId, dateFrom, dateTo, dateSort, page]);


  const typeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of runs ?? []) {
      if (r.testTypeCode && !map.has(r.testTypeCode)) map.set(r.testTypeCode, r.displayName || r.testTypeCode);
    }
    return [...map.entries()];
  }, [runs]);

  // Server-filtered page: what arrived is what matches.
  const visible = runs ?? [];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {error}
      </div>
    );
  }
  if (!runs) return <p className="text-sm text-muted-foreground">Loading test run history…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Test history</h1>
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "No test runs recorded yet."
            : `Showing ${visible.length} of ${total} test runs · page ${page + 1} of ${pageCount}`}
        </p>
        {poh && (
          <p className="mt-1 text-xs text-muted-foreground" title="Demonstration anchoring: hashes are computed locally, not sent to Solana. Only final (pass/fail) verdicts anchor.">
            ⛓ Simulated anchoring · Solana {poh.cluster} · {poh.anchored} on this page · {poh.verified ? "verified ✓" : "verification failed"}
          </p>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            type="search"
            aria-label="Search test runs"
            placeholder="Task no., report no., model, operator, test name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
          />
          <select
            aria-label="Filter by test type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          >
            <option value="">All test types</option>
            {typeOptions.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
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
          <DateFilters
            from={dateFrom}
            to={dateTo}
            sort={dateSort}
            onFrom={setDateFrom}
            onTo={setDateTo}
            onSort={setDateSort}
            label="Performed"
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Verdict</TableHead>
              <TableHead>Test &amp; ref</TableHead>
              <TableHead>Instrument &amp; task</TableHead>
                <TableHead>Operator &amp; date</TableHead>
                <TableHead>Proof of history</TableHead>
                <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <SearchX className="h-4 w-4" aria-hidden="true" />
                    {total === 0
                      ? "No test runs recorded yet."
                      : "Nothing matches those filters."}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {visible.map((r, i) => {
              return (
                <TableRow key={`${r.projectId}:${r.modelId}:${r.testTypeCode}:${i}`} className={cn(r.verdict === "fail" && "bg-reject-wash/40")}>
                  <TableCell>
                    <Badge variant={verdictVariant(r.verdict)}>{r.verdict}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{r.displayName || r.testTypeCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {[r.reportSheetRef ? `Sheet ${r.reportSheetRef}` : null, r.category]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-semibold">
                      <Link to={`/projects/${r.projectId}`} className="text-primary hover:underline">
                        {r.taskNo || `Project ${r.projectId}`}
                      </Link>{" "}
                      <span className="font-normal text-muted-foreground">· {r.modelName || "Model"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[r.reportNo, r.manufacturerName].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{r.operatorName || <span className="text-muted-foreground">Unassigned</span>}</div>
                    <div className="text-xs text-muted-foreground">{formatWhen(r.datePerformed || r.updatedAt)}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.poh ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-mono" title={r.poh.hash}>
                          {r.poh.hash.slice(0, 6)}…{r.poh.hash.slice(-4)}
                        </span>
                        <span className="tnum">slot {r.poh.slot.toLocaleString()}</span>
                        <Button size="sm" variant="ghost" onClick={() => setProof(r)}>
                          Open
                        </Button>
                      </div>
                    ) : (
                      <span title="Anchors once the test reaches a final verdict.">Pending</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link to={`/models/${r.modelId}/tests/${r.testTypeCode}`}>
                      <Button size="sm">Open test</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </Button>
          <span className="tnum text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      )}

      {proof?.poh && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setProof(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Proof of history details"
            className="w-full max-w-lg rounded-lg border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-bold">Proof of history</h2>
              <Button size="sm" variant="ghost" onClick={() => setProof(null)}>
                Close
              </Button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {proof.displayName || proof.testTypeCode} · {proof.taskNo} · {proof.modelName} ·{" "}
              <span className="font-semibold">{proof.verdict.toUpperCase()}</span>
            </p>
            <ProofField label="Chain hash" value={proof.poh.hash} />
            <ProofField label="Slot" value={String(proof.poh.slot)} mono={false} />
            <ProofField label="Transaction signature" value={proof.poh.signature} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProofField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2">
        <p className={`flex-1 break-all text-sm ${mono ? "font-mono" : "tnum"}`}>{value}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            );
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
