import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiBase } from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";

interface TrackData {
  manufacturerName: string;
  taskNo: string;
  reportNo: string;
  danakNo: string | null;
  standardVersion: string;
  status: string;
  examinationStartDate: string | null;
  examinationEndDate: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  updatedAt: string;
  completedSheets: number;
  totalSheets: number;
  signature: { signedByName: string; signedByTitle: string | null; signedAt: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "In testing",
  reviewed: "Reviewed",
  approved: "Approved",
};

function stageVariant(status: string) {
  if (status === "approved") return "pass" as const;
  if (status === "reviewed") return "incomplete" as const;
  return "info" as const;
}

function shortDate(value: string | null) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

export function Track() {
  const { token } = useParams();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Plain fetch on purpose: this page is public and must never read or
    // disturb the technician/admin login session.
    fetch(`${apiBase}/api/public/share/${encodeURIComponent(token ?? "")}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid");
        return (await res.json()) as TrackData;
      })
      .then((json) => {
        if (live) setData(json);
      })
      .catch(() => {
        if (live) setError("This tracking link is invalid or has been revoked. Please contact the laboratory.");
      });
    return () => {
      live = false;
    };
  }, [token]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-3 p-6">
        <h1 className="text-xl font-bold tracking-tight">Examination status</h1>
        <p className="rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading examination status…</p>
      </div>
    );
  }

  const approved = data.status === "approved";
  const stages = ["draft", "reviewed", "approved"] as const;
  const stageIndex = Math.max(0, stages.indexOf(data.status as (typeof stages)[number]));
  const progressPct =
    data.totalSheets > 0 ? Math.round((100 * data.completedSheets) / data.totalSheets) : 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Type-examination status
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{data.taskNo}</h1>
          <p className="text-sm text-muted-foreground">
            {data.manufacturerName} · report {data.reportNo}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge variant={stageVariant(data.status)}>{STATUS_LABEL[data.status] ?? data.status}</Badge>
        </div>
      </header>

      {approved && (
        <p className="rounded-md border border-verify/40 bg-verify/10 px-4 py-3 text-sm font-semibold text-verify" role="status">
          Verified authentic — this examination was approved and signed by the laboratory
          {data.signature ? ` (${data.signature.signedByName})` : ""}. The official report is
          issued separately by the ministry.
        </p>
      )}

      <Card aria-label="Examination timeline">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
            {stages.map((stage, i) => (
              <li key={stage} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold",
                    i <= stageIndex
                      ? "border-verify bg-verify text-white"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                  aria-current={i === stageIndex ? "step" : undefined}
                >
                  {i + 1}
                </span>
                <span className={cn("text-sm", i <= stageIndex ? "font-semibold" : "text-muted-foreground")}>
                  {STATUS_LABEL[stage]}
                </span>
                {i < stages.length - 1 && <span className="mx-2 hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />}
              </li>
            ))}
          </ol>
          <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Testing started</dt>
              <dd>{shortDate(data.examinationStartDate)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Testing ended</dt>
              <dd>{shortDate(data.examinationEndDate)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Last update</dt>
              <dd>{shortDate(data.updatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Approved on</dt>
              <dd>{shortDate(data.approvedAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Testing progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-2 overflow-hidden rounded-sm bg-muted">
            <div className="h-full bg-verify transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="tnum mt-2 text-sm text-muted-foreground">
            {data.completedSheets} of {data.totalSheets} test sheets completed
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Standard {data.standardVersion}</p>
        </CardContent>
      </Card>

      {data.signature && (
        <Card>
          <CardHeader>
            <CardTitle>Approval</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-muted-foreground">Signed by</dt>
                <dd>{data.signature.signedByName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-muted-foreground">Title</dt>
                <dd>{data.signature.signedByTitle ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-muted-foreground">Signed at</dt>
                <dd>{shortDate(data.signature.signedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        Status only — the official report is provided separately by the ministry.
      </footer>
    </div>
  );
}
