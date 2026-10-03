import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { api, ApiError, fileUrl, session } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

interface ProfileUser {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  has_signature: boolean;
  signature_url: string | null;
}

export function Profile() {
  const [me, setMe] = useState<ProfileUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Database copy of the signature: survives wiped upload directories.
  const [sigImage, setSigImage] = useState<string | null>(null);

  const isAdmin = (session.user?.role ?? "") === "admin";

  useEffect(() => {
    let live = true;
    api
      .get<{ user: ProfileUser }>("/users/me")
      .then((data) => {
        if (!live) return;
        setMe(data.user);
        setName(data.user.name);
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load profile.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    api
      .get<{ image: string | null }>("/users/me/signature")
      .then((data) => {
        if (live) setSigImage(data.image);
      })
      .catch(() => {
        /* the file-URL fallback below still stands */
      });
    return () => {
      live = false;
    };
  }, [isAdmin]);

  function refreshSession(user: ProfileUser) {
    // The masthead reads the stored session, so keep it in step with renames.
    if (session.token) {
      session.save(session.token, { email: user.email, name: user.name, role: user.role });
    }
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name must not be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await api.patch<{ user: ProfileUser }>("/users/me", { name: trimmed });
      setMe(data.user);
      refreshSession(data.user);
      setNotice("Name updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update name.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadSignature(file: File) {
    if (file.type !== "image/png") {
      setError("Signature must be a PNG file.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("signature", file, file.name);
      const data = await api.upload<{ user: ProfileUser }>("/users/me/signature", form);
      setMe(data.user);
      const img = await api.get<{ image: string | null }>("/users/me/signature");
      setSigImage(img.image);
      setNotice("Signature uploaded. It will print on reports you sign from now on.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload signature.");
    } finally {
      setUploading(false);
    }
  }

  async function removeSignature() {
    if (!window.confirm("Remove your signature? Reports you sign will show the ruled line only.")) {
      return;
    }
    setError(null);
    try {
      const data = await api.delete<{ user: ProfileUser }>("/users/me/signature");
      setMe(data.user);
      setSigImage(null);
      setNotice("Signature removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove signature.");
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-3 py-2 text-sm text-reject">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            {me ? `${me.email} · ${me.role}` : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <label htmlFor="profile-name" className="mb-1 block text-sm font-medium">
              Display name
            </label>
            <div className="flex gap-2">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
              <Button size="sm" onClick={saveName} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              This is the name printed on reports you sign.
            </p>
          </div>

          {isAdmin && (
          <div>
            <p className="mb-1 text-sm font-medium">Signature</p>
            {me?.signature_url || sigImage ? (
              <div className="flex items-center gap-4">
                <img
                  src={sigImage ?? fileUrl(me!.signature_url!)}
                  alt="Your uploaded signature"
                  className="max-h-20 max-w-56 border bg-white px-2 py-1"
                />
                <Button variant="outline" size="sm" onClick={removeSignature}>
                  Remove
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No signature uploaded. Reports you sign will show the ruled line only.
              </p>
            )}
            <SignatureDropzone
              uploading={uploading}
              hasCurrent={!!me?.signature_url}
              onFile={(file) => void uploadSignature(file)}
            />
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SignatureDropzone({
  uploading,
  hasCurrent,
  onFile,
}: {
  uploading: boolean;
  hasCurrent: boolean;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const take = (file: File | undefined | null) => {
    if (file) onFile(file);
  };

  return (
    <div className="mt-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a PNG signature here, or browse to choose one"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/40"
        }`}
      >
        <p className="text-sm font-medium">
          {uploading ? "Uploading…" : "Drop a PNG here"}
        </p>
        <p className="text-xs text-muted-foreground">
          Under 2 MB{hasCurrent ? " — replaces the current signature" : ""}.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            take(file);
          }}
        />
      </div>
    </div>
  );
}
