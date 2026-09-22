import { useEffect, useState } from "react";
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

  async function reload() {
    try {
      const data = (await api.get(
        `/projects/${projectId}/attachments?testRunId=${runId}`
      )) as { attachments: Attachment[] };
      setItems(data.attachments ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load attachments.");
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
        </div>
      </CardContent>
    </Card>
  );
}
