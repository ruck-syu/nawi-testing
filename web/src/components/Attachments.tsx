import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, ApiError, fileUrl } from "../lib/api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

interface Attachment {
  id: number;
  caption?: string | null;
  original_name?: string | null;
  file_path?: string;
  url?: string;
}

interface MobileSession {
  token: string;
  expiresAt: string;
  uploadCount: number;
  expired?: boolean;
}

/** Photographic evidence pinned to a test run. Uploads take seconds, so this panel lives
 * outside the re-rendered sheet region and manages its own state. */
export function Attachments({
  projectId,
  modelId,
  runId,
}: {
  projectId: number;
  modelId: number;
  runId: number;
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- "Upload from Mobile" (additive): QR session state. Desktop upload above is untouched. ---
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSession, setMobileSession] = useState<MobileSession | null>(null);
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [mobileReceived, setMobileReceived] = useState(false);
  const [baselineCount, setBaselineCount] = useState<number | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  async function reload() {
    try {
      const data = (await api.get(
        `/projects/${projectId}/attachments?testRunId=${runId}`
      )) as { attachments: Attachment[] };
      setItems(data.attachments ?? []);
      return data.attachments ?? [];
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load attachments.");
      return null;
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, runId]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file, file.name);
      form.append("test_run_id", String(runId));
      form.append("model_id", String(modelId));
      if (caption.trim()) form.append("caption", caption.trim());
      await api.upload(`/projects/${projectId}/attachments`, form);
      setCaption("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.delete(`/attachments/${id}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  // --- Mobile QR session helpers (additive; existing upload flow untouched) ---

  const mobileUrl = mobileSession
    ? `${window.location.origin}${window.location.pathname}#/m/${mobileSession.token}`
    : null;

  async function startMobileSession() {
    setMobileBusy(true);
    setMobileError(null);
    setMobileReceived(false);
    try {
      const res = (await api.post(`/projects/${projectId}/mobile-upload-sessions`, {
        test_run_id: runId,
      })) as { session: MobileSession };
      setMobileSession(res.session);
      setBaselineCount(items?.length ?? 0);
      setMobileOpen(true);
    } catch (err) {
      setMobileError(err instanceof ApiError ? err.message : "Could not start the mobile session.");
    } finally {
      setMobileBusy(false);
    }
  }

  async function endMobileSession() {
    if (!mobileSession) {
      setMobileOpen(false);
      return;
    }
    setMobileBusy(true);
    try {
      await api.post(
        `/projects/${projectId}/mobile-upload-sessions/${mobileSession.token}/revoke`,
        {}
      );
    } catch {
      /* closing the panel matters more than a revoke failure; the TTL expires it anyway */
    } finally {
      setMobileBusy(false);
      setMobileSession(null);
      setMobileOpen(false);
    }
  }

  // Render the QR code whenever the dialog and URL are ready (same pattern as Project tracking link).
  useEffect(() => {
    if (!mobileOpen || !mobileUrl || !qrRef.current) return;
    setQrError(null);
    QRCode.toCanvas(qrRef.current, mobileUrl, { width: 220, margin: 1 }).catch(() =>
      setQrError("Could not render the QR code — copy the link instead.")
    );
  }, [mobileOpen, mobileUrl]);

  // While a mobile session is open, poll for newly arrived photos so the
  // desktop shows a clear success status without a manual refresh.
  useEffect(() => {
    if (!mobileOpen || !mobileSession) return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const [attachments, status] = await Promise.all([
          api.get(`/projects/${projectId}/attachments?testRunId=${runId}`) as Promise<{
            attachments: Attachment[];
          }>,
          api.get(
            `/projects/${projectId}/mobile-upload-sessions?testRunId=${runId}`
          ) as Promise<{ sessions: MobileSession[] }>,
        ]);
        if (!live) return;
        setItems(attachments.attachments ?? []);
        const current = (status.sessions ?? []).find((s) => s.token === mobileSession.token);
        if (current) setMobileSession(current);
        const base = baselineCount ?? 0;
        if ((attachments.attachments ?? []).length > base) {
          setMobileReceived(true);
          setBaselineCount((attachments.attachments ?? []).length);
        }
        if (current?.expired) {
          setMobileError("This mobile session has expired. Start a new one for more photos.");
        }
      } catch {
        /* polling is best-effort; the list refresh on next interaction still works */
      }
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileOpen, mobileSession?.token, projectId, runId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Photographic evidence</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-reject">{error}</p>}
        {items === null ? (
          <p className="text-sm text-muted-foreground">Loading attachments…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No photographs yet. Photographs taken here travel with the generated report.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-md border">
                <a href={fileUrl(a.url ?? (a.file_path ? `/uploads/${a.file_path}` : null))} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fileUrl(a.url ?? (a.file_path ? `/uploads/${a.file_path}` : null))}
                    alt={a.caption ?? a.original_name ?? "Test photograph"}
                    className="aspect-video w-full object-cover"
                    loading="lazy"
                  />
                </a>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {a.caption ?? a.original_name ?? "Photograph"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => remove(a.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="text"
            aria-label="Photo caption"
            placeholder="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="sm:max-w-xs"
          />
          <label className="inline-flex">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <span
              className={`inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground shadow-xs hover:brightness-95 ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              {busy ? "Uploading…" : "Attach photo"}
            </span>
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={mobileBusy}
            onClick={() => {
              if (mobileSession) setMobileOpen(true);
              else void startMobileSession();
            }}
          >
            {mobileSession ? "Show mobile QR" : mobileBusy ? "Starting…" : "Upload from Mobile"}
          </Button>
        </div>

        {mobileError && <p className="text-sm text-reject">{mobileError}</p>}
        {mobileReceived && (
          <p
            className="rounded-md border border-verify/40 bg-verify/10 px-3 py-2 text-sm font-semibold text-verify"
            role="status"
          >
            Mobile photo received — it is listed above
            {mobileSession ? ` (${mobileSession.uploadCount} uploaded this session)` : ""}.
          </p>
        )}

        {mobileOpen && mobileSession && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setMobileOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Upload from mobile"
              className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold tracking-tight">Upload from Mobile</h2>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close mobile upload dialog"
                  className="ml-auto rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Scan with your phone camera, take the photo, and it appears on this test sheet
                automatically. You can send multiple photos.
              </p>
              {mobileUrl && (
                <div className="flex flex-col items-center gap-2">
                  <canvas
                    ref={qrRef}
                    role="img"
                    aria-label="Mobile upload QR code"
                    className="rounded-md border border-border"
                  />
                  {qrError ? (
                    <p className="text-xs text-reject">{qrError}</p>
                  ) : (
                    <code className="w-full break-all rounded-md border border-border bg-muted px-3 py-2 text-xs">
                      {mobileUrl}
                    </code>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (mobileUrl) void navigator.clipboard.writeText(mobileUrl).catch(() => undefined);
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Copy mobile link
                  </button>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                <p>
                  Status:{" "}
                  {mobileSession.expired ? (
                    <span className="font-semibold text-reject">expired</span>
                  ) : (
                    <span className="font-semibold text-verify">
                      waiting for photos… ({mobileSession.uploadCount} received)
                    </span>
                  )}
                </p>
                <p>Expires {new Date(mobileSession.expiresAt).toLocaleString()}.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setMobileOpen(false)}>
                  Keep open
                </Button>
                <Button variant="outline" size="sm" onClick={() => void endMobileSession()} disabled={mobileBusy}>
                  {mobileBusy ? "Closing…" : "End mobile session"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
