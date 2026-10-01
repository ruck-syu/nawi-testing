import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiBase } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

interface MobileSessionInfo {
  taskNo: string;
  reportNo: string;
  modelName: string;
  testName: string;
  reportSheetRef: string | null;
  expiresAt: string;
  uploadCount: number;
  projectLocked: boolean;
}

/**
 * Public phone page for the "Upload from Mobile" feature.
 *
 * No login, no app shell, no session access: the token in the URL is the only
 * credential, scoped server-side to a single test run. Deliberately minimal:
 * scan → take/select photo → upload → success. Repeatable for multiple photos.
 */
export function MobileUpload() {
  const { token } = useParams();
  const [info, setInfo] = useState<MobileSessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`${apiBase}/api/public/mobile/${encodeURIComponent(token ?? "")}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid");
        return (await res.json()) as MobileSessionInfo;
      })
      .then((json) => {
        if (live) {
          setInfo(json);
          setUploaded(json.uploadCount ?? 0);
        }
      })
      .catch(() => {
        if (live) setError("This upload link is invalid, expired, or has been closed. Please ask the technician to show a fresh QR code.");
      });
    return () => {
      live = false;
    };
  }, [token]);

  async function upload(file: File) {
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("photo", file, file.name);
      const res = await fetch(`${apiBase}/api/public/mobile/${encodeURIComponent(token ?? "")}/photo`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          /* keep the default message */
        }
        throw new Error(message);
      }
      setUploaded((n) => n + 1);
      setNotice("Photo uploaded — it is now visible on the desktop test sheet.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-xl font-bold tracking-tight">Mobile photo upload</h1>
        <p className="rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading upload session…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mobile photo upload · {info.taskNo}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{info.testName}</h1>
        <p className="text-sm text-muted-foreground">
          {info.modelName}
          {info.reportSheetRef ? ` · ${info.reportSheetRef}` : ""}
        </p>
      </header>

      {info.projectLocked ? (
        <p className="rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm text-reject" role="alert">
          This report has been approved and no longer accepts photos.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Take or choose a photo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {notice && (
              <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
                {notice}
              </p>
            )}
            {uploaded > 0 && (
              <p className="text-sm font-semibold text-verify" role="status">
                {uploaded} photo{uploaded === 1 ? "" : "s"} uploaded in this session.
              </p>
            )}
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
              <span
                className={`inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-secondary px-4 py-2 text-base font-semibold text-secondary-foreground shadow-xs hover:brightness-95 ${busy ? "pointer-events-none opacity-50" : ""}`}
              >
                {busy ? "Uploading…" : "Take photo / choose from gallery"}
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              The camera opens directly on most phones. Each photo appears automatically on the
              desktop test sheet. You can upload as many as needed.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Refresh session
            </Button>
          </CardContent>
        </Card>
      )}

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        This link uploads photos to one test only and expires automatically.
      </footer>
    </div>
  );
}
