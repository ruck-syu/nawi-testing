import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api, ApiError, fileUrl, session } from "../lib/api";
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

type Verdict = "pass" | "fail" | "incomplete" | "not_started";

function verdictVariant(v: Verdict) {
  if (v === "pass") return "pass" as const;
  if (v === "fail") return "fail" as const;
  if (v === "incomplete") return "incomplete" as const;
  return "not_started" as const;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
};

function stageVariant(status: string) {
  if (status === "approved") return "pass" as const;
  if (status === "reviewed") return "incomplete" as const;
  return "info" as const;
}

function Kv({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="divide-y divide-border text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[160px_1fr] gap-2 py-1.5">
          <dt className="font-semibold text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Project() {
  const { id } = useParams();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genFormat, setGenFormat] = useState("pdf");
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [share, setShare] = useState<{ token: string; created_at?: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  async function reload() {
    const [detail, summary, checklist] = await Promise.all([
      api.get(`/projects/${id}`),
      api.get(`/projects/${id}/summary`),
      api.get(`/projects/${id}/checklist`).catch(() => null),
    ]);
    setData({ detail, summary, checklist });
  }

  useEffect(() => {
    let live = true;
    reload()
      .then(() => undefined)
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load the examination.");
      });
    api
      .get<{ share: { token: string; created_at?: string } | null }>(`/projects/${id}/share`)
      .then((res) => {
        if (live) setShare(res.share);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function review(action: "mark_reviewed" | "approve") {
    setReviewing(true);
    try {
      await api.patch(`/projects/${id}/review`, { action });
      setNotice(
        action === "approve"
          ? "Report approved and signed."
          : "Report marked as reviewed.",
      );
      await reload();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Could not update the report stage.");
    } finally {
      setReviewing(false);
    }
  }

  async function createShareLink() {
    setShareBusy(true);
    setShareMsg(null);
    try {
      const res = await api.post<{ share: { token: string; created_at?: string } }>(
        `/projects/${id}/share`,
      );
      setShare(res.share);
      setShareMsg(share ? "Tracking link regenerated. The previous link no longer works." : "Tracking link created.");
    } catch (err) {
      setShareMsg(err instanceof ApiError ? err.message : "Could not create the tracking link.");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShareLink() {
    setShareBusy(true);
    setShareMsg(null);
    try {
      await api.delete(`/projects/${id}/share`);
      setShare(null);
      setShareMsg("Tracking link revoked.");
    } catch (err) {
      setShareMsg(err instanceof ApiError ? err.message : "Could not revoke the tracking link.");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg("Link copied to clipboard.");
    } catch {
      setShareMsg("Copy failed — select the link manually.");
    }
  }

  // Override for the origin baked into tracking links (e.g. set
  // VITE_SHARE_BASE_URL to the Railway URL so links generated while working
  // locally still point manufacturers at production). Defaults to wherever
  // this page was opened from.
  const shareBase =
    ((import.meta as any).env?.VITE_SHARE_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
    `${window.location.origin}${window.location.pathname}`;
  const shareUrl = share ? `${shareBase}#/track/${share.token}` : null;

  useEffect(() => {
    if (!shareUrl || !shareOpen || !qrRef.current) return;
    setQrError(null);
    QRCode.toCanvas(qrRef.current, shareUrl, { width: 200, margin: 1 }).catch(() =>
      setQrError("Could not render the QR code."),
    );
  }, [shareUrl, shareOpen]);

  // Close the tracking dialog with Escape.
  useEffect(() => {
    if (!shareOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShareOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shareOpen]);

  function downloadQr() {
    const canvas = qrRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `tracking-qr-${id ?? "project"}.png`;
    a.click();
  }

  async function generate() {
    setGenerating(true);
    setNotice("Generating the report…");
    try {
      const res = (await api.post(`/projects/${id}/reports`, { format: genFormat })) as {
        report?: { url?: string };
        url?: string;
      };
      const url = fileUrl(res.report?.url ?? res.url);
      setNotice("Report generated.");
      if (url) window.open(url, "_blank", "noopener");
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  if (error) return <p className="text-sm text-reject">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading examination…</p>;

  const { detail, summary, checklist } = data;
  const { project, manufacturer, families, signature, rollup } = detail;
  const isAdmin = session.user?.role === "admin";
  const isTechnician = session.user?.role === "technician";
  const approved = project.status === "approved";
  const models = (families ?? []).flatMap((f: any) =>
    (f.models ?? []).map((m: any) => ({ ...m, familyName: f.family_name }))
  );

  const failing: Array<{ model: string; test: string }> = (summary.models ?? []).flatMap(
    (model: any) =>
      (model.summary ?? [])
        .filter((t: any) => t.verdict === "fail")
        .map((t: any) => ({ model: model.modelName, test: t.displayName ?? t.testTypeCode }))
  );

  const sentence =
    rollup.verdict === "pass"
      ? `All ${rollup.testCount} recorded test${rollup.testCount === 1 ? "" : "s"} are within the maximum permissible errors.`
      : rollup.verdict === "fail"
        ? `${rollup.failCount} test${rollup.failCount === 1 ? "" : "s"} exceeded the maximum permissible error.`
        : rollup.incompleteCount > 0
          ? `${rollup.incompleteCount} test${rollup.incompleteCount === 1 ? "" : "s"} still awaiting measurements.`
          : "No measurements recorded yet.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {project.task_no || `Project ${project.id}`}
        </h1>
        <Badge variant={verdictVariant(rollup.verdict)}>{rollup.verdict}</Badge>
        <Badge variant={stageVariant(project.status)}>{STATUS_LABEL[project.status] ?? project.status}</Badge>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShareMsg(null);
              setShareOpen(true);
            }}
          >
            Tracking link
          </Button>
          {isAdmin && !approved && (
            <Button variant="accent" size="sm" onClick={() => void review("approve")} disabled={reviewing}>
              Approve &amp; sign
            </Button>
          )}
          {isTechnician && !approved && (
            <Button variant="outline" size="sm" onClick={() => void review("mark_reviewed")} disabled={reviewing}>
              Mark as Reviewed
            </Button>
          )}
          <select
            aria-label="Report format"
            value={genFormat}
            onChange={(e) => setGenFormat(e.target.value)}
            className="h-8 rounded-md border border-border bg-input px-2 text-sm shadow-xs"
          >
            <option value="pdf">PDF</option>
            <option value="docx">DOCX (Word)</option>
          </select>
          <Button variant="accent" size="sm" onClick={generate} disabled={generating}>
            {generating ? "Generating…" : "Generate report"}
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        {manufacturer?.name ?? "—"} · report {project.report_no ?? "—"} ·{" "}
        {project.standard_version ?? "—"}
      </p>
      {notice && (
        <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      )}

      <Card>
        <CardContent className="flex items-start gap-3 pt-5">
          <Badge variant={verdictVariant(rollup.verdict)}>{rollup.verdict}</Badge>
          <div>
            <p className="font-semibold">{sentence}</p>
            <p className="tnum text-sm text-muted-foreground">
              {rollup.passCount} pass · {rollup.failCount} fail · {rollup.incompleteCount}{" "}
              incomplete
            </p>
            {failing.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {failing.map((f, i) => (
                  <li key={i}>
                    <strong>{f.model}</strong> — {f.test}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Examination</CardTitle>
          </CardHeader>
          <CardContent>
            <Kv
              rows={[
                ["Task number", project.task_no],
                ["Report number", project.report_no],
                ["DANAK number", project.danak_no],
                ["Standard", project.standard_version],
                [
                  "Examination period",
                  [project.examination_start_date, project.examination_end_date]
                    .filter(Boolean)
                    .map((d: string) => String(d).slice(0, 10))
                    .join(" to ") || "—",
                ],
                ["Status", STATUS_LABEL[project.status] ?? project.status],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Manufacturer</CardTitle>
          </CardHeader>
          <CardContent>
            <Kv
              rows={[
                ["Name", manufacturer?.name],
                ["Address", manufacturer?.address],
                ["Contact", manufacturer?.contact_person],
                ["Email", manufacturer?.email],
                ["Phone", manufacturer?.phone],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {checklist && (
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ProgressBar
              value={checklist.progress?.answered ?? 0}
              total={checklist.progress?.total ?? 0}
            />
            {checklist.failCount > 0 ? (
              <p className="text-sm font-semibold text-reject">
                {checklist.failCount} clause(s) marked as not conforming.
              </p>
            ) : null}
            <div>
              <Link to={`/projects/${id}/checklist`}>
                <Button variant="outline" size="sm">
                  Open checklist
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {models.map((model: any) => {
        const entry = (summary.models ?? []).find((m: any) => m.modelId === model.id);
        const tests = entry?.summary ?? [];
        return (
          <Card key={model.id}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>
                  {model.familyName} · {model.model_name}
                </CardTitle>
                <Link to={`/models/${model.id}`} className="ml-auto">
                  <Button variant="outline" size="sm">
                    Open test sheets
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                Max {model.max_capacity} g · e {model.e_value} g · n {model.n_intervals} · Class{" "}
                {model.accuracy_class} · Receptor{" "}
                {String(model.pan_shape ?? "").replace(/_/g, " ")}
              </p>
              {tests.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No test sheets started for this model yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Verdict</TableHead>
                      <TableHead>Test</TableHead>
                      <TableHead>Sheet</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tests.map((t: any) => (
                      <TableRow key={t.testTypeCode} className={cn(t.verdict === "fail" && "bg-reject-wash/40")}>
                        <TableCell>
                          <Badge variant={verdictVariant(t.verdict)}>{t.verdict}</Badge>
                        </TableCell>
                        <TableCell>
                    <Link
                      to={`/models/${model.id}/tests/${t.testTypeCode}`}
                      className={cn("font-semibold text-primary hover:underline", approved && "pointer-events-none opacity-60")}
                          >
                            {t.displayName ?? t.testTypeCode}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.reportSheetRef ?? "—"}
                        </TableCell>
                        <TableCell className="tnum text-right text-sm text-muted-foreground">
                          {t.rowsTotal ? `${t.rowsEntered ?? 0}/${t.rowsTotal}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.remarks ?? ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}

      {signature && (
        <Card>
          <CardHeader>
            <CardTitle>Signature</CardTitle>
          </CardHeader>
          <CardContent>
            <Kv
              rows={[
                ["Signed by", signature.signed_by_name],
                ["Title", signature.signed_by_title],
                ["Signed at", signature.signed_at],
              ]}
            />
          </CardContent>
        </Card>
      )}

      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShareOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Manufacturer tracking link"
            className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold tracking-tight">Manufacturer tracking link</h2>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                aria-label="Close tracking link dialog"
                className="ml-auto rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
              >
                ×
              </button>
            </div>
            {shareUrl ? (
              <div className="flex flex-col items-center gap-3">
                <code className="w-full break-all rounded-md border border-border bg-muted px-3 py-2 text-xs">
                  {shareUrl}
                </code>
                <canvas ref={qrRef} role="img" aria-label="Tracking link QR code" className="rounded-md border border-border" />
                {qrError ? (
                  <p className="text-xs text-reject">{qrError}</p>
                ) : (
                  <button
                    type="button"
                    onClick={downloadQr}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Download QR PNG
                  </button>
                )}
                {share?.created_at && (
                  <p className="text-xs text-muted-foreground">
                    Created {String(share.created_at).slice(0, 10)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active link. Create one to share with the manufacturer.</p>
            )}
            {shareMsg && <p className="text-sm text-muted-foreground">{shareMsg}</p>}
            <div className="flex flex-wrap gap-2">
              {shareUrl && (
                <Button variant="outline" size="sm" onClick={() => void copyShareLink(shareUrl)} disabled={shareBusy}>
                  Copy link
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={createShareLink} disabled={shareBusy}>
                {shareBusy ? "Working…" : shareUrl ? "Regenerate" : "Create link"}
              </Button>
              {shareUrl && (
                <Button variant="outline" size="sm" onClick={revokeShareLink} disabled={shareBusy}>
                  Revoke
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((100 * value) / total) : 0;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-sm bg-muted">
        <div className="h-full bg-verify transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="tnum mt-1 text-xs text-muted-foreground">
        {value} of {total} assessed
      </p>
    </div>
  );
}
