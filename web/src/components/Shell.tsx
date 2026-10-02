import { Link, NavLink, useNavigate } from "react-router-dom";
import { FlaskConical, FileText, LayoutDashboard, Plus, LogOut, CircleUserRound, Scale } from "lucide-react";
import { cn } from "../lib/utils";
import { session } from "../lib/api";
import { Button } from "./ui/button";
import logo from "../assets/logo.svg";

const NAV = [
  { to: "/projects", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/instruments", label: "Instruments", icon: Scale, end: false },
  { to: "/test-history", label: "Test History", icon: FlaskConical, end: false },
  { to: "/reports", label: "Reports", icon: FileText, end: false },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const user = session.user;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Masthead */}
      <header className="bg-steel-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <img
            src={logo}
            alt="Legal Metrology Division logo"
            className="h-10 w-10 shrink-0 rounded-sm ring-1 ring-amber-glow/60"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-glow">
              Legal Metrology Division
            </p>
            <p className="truncate text-lg font-bold leading-tight tracking-tight">
              NAWI Examination Console
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {user && (
              <Link
                to="/profile"
                title="Open your profile and settings"
                className="hidden items-center gap-2 rounded-sm border border-white/20 px-2 py-1 text-xs leading-tight text-white/80 hover:border-white/50 hover:text-white md:flex"
              >
                <CircleUserRound className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="text-right">
                  <span className="block font-semibold text-white underline decoration-white/40 underline-offset-2">{user.name ?? user.email}</span>
                  <span className="uppercase tracking-wide">{user.role ?? ""}</span>
                </span>
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                session.clear();
                navigate("/login", { replace: true });
              }}
            >
              <LogOut aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <div className="amber-rule h-0.5 w-full" aria-hidden="true" />
      </header>

      {/* Section nav */}
      <nav className="border-b bg-card" aria-label="Primary">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 sm:px-6">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold",
                  isActive
                    ? "border-amber-glow text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
          <Link to="/projects/new" className="ml-auto py-1.5">
            <Button variant="accent" size="sm">
              <Plus aria-hidden="true" />
              New Examination
            </Button>
          </Link>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="border-t bg-steel-950 text-white/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>OIML R76 / EN 45501 · Type examination console</span>
          <span className="tnum">Unit NAWI-LAB-01</span>
        </div>
      </footer>
    </div>
  );
}
