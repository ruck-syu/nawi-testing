import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Scale, TriangleAlert } from "lucide-react";
import { api, session, ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Label } from "../components/ui/input";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("tech@delta.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.token) return <Navigate to="/projects" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = (await api.post("/auth/login", { email, password })) as {
        token: string;
        user: { email: string; name?: string; role?: string };
      };
      session.save(data.token, data.user);
      navigate("/projects", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-steel-950">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center text-white">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-sm bg-steel-800 ring-1 ring-amber-glow/60">
              <Scale className="h-6 w-6 text-amber-glow" aria-hidden="true" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-glow">
              Legal Metrology Division
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight">NAWI Examination Console</h1>
          </div>

          <Card className="overflow-hidden">
            <div className="amber-rule h-1 w-full" aria-hidden="true" />
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="flex items-start gap-2 rounded-md border border-reject/40 bg-reject-wash px-3 py-2 text-sm text-reject"
                  >
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {error}
                  </div>
                )}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
              <div className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Demo accounts — admin: <span className="font-mono">admin@delta.test / admin123</span>
                {" · "}technician: <span className="font-mono">tech@delta.test / tech123</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
