import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { api, ApiError, fileUrl, session } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

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
  const [users, setUsers] = useState<ProfileUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isAdmin = (session.user?.role ?? "") === "admin";

  useEffect(() => {
    let live = true;
    api
      .get<{ user: ProfileUser }>("/users/me")
      .then((data) => {
        if (!live) return;
        setMe(data.user);
        setName(data.user.name);
        if (isAdmin) {
          api
            .get<{ users: ProfileUser[] }>("/users")
            .then((list) => {
              if (live) setUsers(list.users ?? []);
            })
            .catch(() => {
              if (live) setUsers([]);
            });
        }
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load profile.");
      });
    return () => {
      live = false;
    };
  }, []);

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
      setNotice("Signature uploaded. It will print on reports you sign from now on.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload signature.");
    } finally {
      setUploading(false);
    }
  }

  async function removeSignature() {
    setError(null);
    try {
      const data = await api.delete<{ user: ProfileUser }>("/users/me/signature");
      setMe(data.user);
      setNotice("Signature removed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove signature.");
    }
  }

  async function updateUser(id: number, patch: Partial<Pick<ProfileUser, "role" | "is_active" | "name">>) {
    setError(null);
    try {
      const data = await api.patch<{ user: ProfileUser }>(`/users/${id}`, patch);
      setUsers((prev) => (prev ?? []).map((u) => (u.id === id ? data.user : u)));
      setNotice("User updated. Role changes apply on their next sign-in.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update user.");
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
            {me?.signature_url ? (
              <div className="flex items-center gap-4">
                <img
                  src={fileUrl(me.signature_url)}
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
            <div className="mt-2">
              <label htmlFor="profile-signature" className="mb-1 block text-xs text-muted-foreground">
                Upload a PNG (under 2 MB){me?.signature_url ? " to replace the current one" : ""}:
              </label>
              <Input
                id="profile-signature"
                type="file"
                accept="image/png"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadSignature(file);
                }}
              />
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>
              Everyone with access. You cannot change your own role or status here — use
              the profile section above for yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!users ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Signature</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const self = me !== null && u.id === me.id;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="text-sm font-medium">{u.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.has_signature ? "Uploaded" : "—"}
                        </TableCell>
                        <TableCell>
                          <select
                            aria-label={`Role for ${u.email}`}
                            className="h-8 rounded-md border border-border bg-input px-2 text-sm"
                            value={u.role}
                            disabled={self}
                            onChange={(e) => void updateUser(u.id, { role: e.target.value as "admin" | "technician" })}
                          >
                            <option value="admin">admin</option>
                            <option value="technician">technician</option>
                          </select>
                        </TableCell>
                        <TableCell>
                          <select
                            aria-label={`Status for ${u.email}`}
                            className="h-8 rounded-md border border-border bg-input px-2 text-sm"
                            value={u.is_active ? "active" : "inactive"}
                            disabled={self}
                            onChange={(e) => void updateUser(u.id, { is_active: e.target.value === "active" })}
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <AddTechnician
              onCreated={(u) => {
                setUsers((prev) => [...(prev ?? []), u]);
                setNotice(`Account created for ${u.email}. Share their password securely.`);
              }}
              onError={setError}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddTechnician({
  onCreated,
  onError,
}: {
  onCreated: (u: ProfileUser) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("technician");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || !email.trim() || !password) {
      onError("Name, email, and a password are all required.");
      return;
    }
    setBusy(true);
    try {
      const data = await api.post<{ user: ProfileUser }>("/users", {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });
      onCreated(data.user);
      setName("");
      setEmail("");
      setPassword("");
      setRole("technician");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-sm font-medium">Add technician</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Input
          aria-label="New user name"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="sm:max-w-44"
        />
        <Input
          aria-label="New user email"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={160}
          className="sm:max-w-56"
        />
        <Input
          aria-label="Temporary password"
          placeholder="Temporary password (8+ characters)"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={120}
          className="sm:max-w-56"
        />
        <select
          aria-label="Role for the new account"
          className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="technician">technician</option>
          <option value="admin">admin</option>
        </select>
        <Button size="sm" onClick={() => void create()} disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
