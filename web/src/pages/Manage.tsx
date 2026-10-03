import { Fragment, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { api, ApiError, session } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Field } from "../components/forms";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

interface ManagedUser {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  has_signature: boolean;
  signature_url: string | null;
}

/**
 * Manage: people administration — accounts, roles, and status. Previously this
 * table lived at the bottom of Profile, where nobody looked; Profile is back
 * to own-settings.
 */
export function Manage() {
  const isAdmin = (session.user?.role ?? "") === "admin";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manage</h1>
        <p className="text-sm text-muted-foreground">
          Accounts, roles, and access.
        </p>
      </div>
      {isAdmin ? (
        <PeopleSection />
      ) : (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            People management is limited to administrators.
          </CardContent>
        </Card>
      )}
      <ManufacturersSection />
    </div>
  );
}

function PeopleSection() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const myEmail = (session.user?.email ?? "").toLowerCase();

  useEffect(() => {
    let live = true;
    api
      .get<{ users: ManagedUser[] }>("/users")
      .then((list) => {
        if (live) setUsers(list.users ?? []);
      })
      .catch(() => {
        if (live) setUsers([]);
      });
    return () => {
      live = false;
    };
  }, []);

  async function updateUser(id: number, patch: Partial<Pick<ManagedUser, "role" | "is_active">>) {
    setError(null);
    try {
      const data = await api.patch<{ user: ManagedUser }>(`/users/${id}`, patch);
      setUsers((prev) => (prev ?? []).map((u) => (u.id === id ? data.user : u)));
      setNotice("User updated. Role changes apply on their next sign-in.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update user.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>
          Everyone with access. You cannot change your own role or status here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="mb-2 flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-3 py-2 text-sm text-reject">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">{notice}</p>
        )}
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
                const self = u.email.toLowerCase() === myEmail;
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
        <AddUser
          onCreated={(u) => {
            setUsers((prev) => [...(prev ?? []), u]);
            setNotice(`Account created for ${u.email}. Share their password securely.`);
          }}
          onError={setError}
        />
      </CardContent>
    </Card>
  );
}

function AddUser({
  onCreated,
  onError,
}: {
  onCreated: (u: ManagedUser) => void;
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
      const data = await api.post<{ user: ManagedUser }>("/users", {
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
      <p className="mb-2 text-sm font-medium">Add account</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
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
          aria-label="New user password"
          placeholder="Password (min 8 chars)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="sm:max-w-52"
        />
        <select
          aria-label="New user role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
        >
          <option value="technician">technician</option>
          <option value="admin">admin</option>
        </select>
        <Button size="sm" variant="accent" onClick={() => void create()} disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </div>
    </div>
  );
}

interface Manufacturer {
  id: number;
  name: string;
  address: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Manufacturer directory: every manufacturer with examinations on record,
 * editable in place. Edits update the shared record, so all of the
 * manufacturer's examinations (and future reports) show the corrected details.
 */
function ManufacturersSection() {
  const [makers, setMakers] = useState<Manufacturer[] | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => {
    api
      .get<{ manufacturers: Manufacturer[] }>("/manufacturers")
      .then((data) => setMakers(data.manufacturers ?? []))
      .catch(() => setMakers([]));
  };

  useEffect(refresh, []);

  const visible = (makers ?? []).filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [m.name, m.contact_person, m.email, m.phone]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(q));
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <CardTitle>Manufacturers</CardTitle>
            <CardDescription>
              {(makers ?? []).length} on record. Corrections here apply to every
              examination from that manufacturer.
            </CardDescription>
          </div>
          <Button size="sm" variant="accent" className="ml-auto" onClick={() => setAdding((a) => !a)}>
            {adding ? "Close" : "Add manufacturer"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {adding && (
          <ManufacturerAddForm
            onDone={() => {
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        <Input
          type="search"
          aria-label="Search manufacturers"
          placeholder="Name, contact, email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:max-w-xs"
        />
        {!makers ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing matches that search.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((m) => (
                <Fragment key={m.id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-semibold">{m.name}</div>
                      {m.address && (
                        <div className="text-xs text-muted-foreground">{m.address}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.contact_person ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.email ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.phone ?? "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId((id) => (id === m.id ? null : m.id))}
                      >
                        {editingId === m.id ? "Close" : "Edit"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {editingId === m.id && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/40">
                        <ManufacturerEditForm
                          manufacturer={m}
                          onDone={() => {
                            setEditingId(null);
                            refresh();
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ManufacturerAddForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    name: "",
    address: "",
    contact_person: "",
    email: "",
    phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (form.email.trim() !== "" && !form.email.includes("@")) {
      setError("Email must be a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      for (const key of ["address", "contact_person", "email", "phone"] as const) {
        const v = (form[key] ?? "").trim();
        body[key] = v === "" ? null : v;
      }
      await api.post("/manufacturers", body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Input value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} {...props} />
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Name">{text("name", { placeholder: "Acme Scales Ltd." })}</Field>
        <Field label="Contact person">{text("contact_person", { placeholder: "Optional" })}</Field>
      </div>
      <Field label="Address">{text("address", { placeholder: "Optional" })}</Field>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Email">{text("email", { placeholder: "Optional" })}</Field>
        <Field label="Phone">{text("phone", { placeholder: "Optional" })}</Field>
      </div>
      {error && <p className="text-sm text-reject">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="accent" onClick={() => void save()} disabled={busy}>
          {busy ? "Adding…" : "Add manufacturer"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ManufacturerEditForm({  manufacturer,
  onDone,
  onCancel,
}: {
  manufacturer: Manufacturer;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    name: manufacturer.name ?? "",
    address: manufacturer.address ?? "",
    contact_person: manufacturer.contact_person ?? "",
    email: manufacturer.email ?? "",
    phone: manufacturer.phone ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (form.email.trim() !== "" && !form.email.includes("@")) {
      setError("Email must be a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      for (const key of ["address", "contact_person", "email", "phone"] as const) {
        const v = (form[key] ?? "").trim();
        body[key] = v === "" ? null : v;
      }
      await api.patch(`/manufacturers/${manufacturer.id}`, body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Input value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} {...props} />
  );

  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Name">{text("name")}</Field>
        <Field label="Contact person">{text("contact_person", { placeholder: "Optional" })}</Field>
      </div>
      <Field label="Address">{text("address", { placeholder: "Optional" })}</Field>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Email">{text("email", { placeholder: "Optional" })}</Field>
        <Field label="Phone">{text("phone", { placeholder: "Optional" })}</Field>
      </div>
      {error && <p className="text-sm text-reject">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="accent" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
