import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import * as React from "react";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Wizard } from "./pages/Wizard";
import { Project } from "./pages/Project";
import { Checklist } from "./pages/Checklist";
import { Model } from "./pages/Model";
import { Reports } from "./pages/Reports";
import { Profile } from "./pages/Profile";
import { TestHistory } from "./pages/TestHistory";
import { Instruments } from "./pages/Instruments";import { Track } from "./pages/Track";
import { MobileUpload } from "./pages/MobileUpload";
import { Verify } from "./pages/Verify";
import { session, onUnauthorized } from "./lib/api";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";

function RequireSession({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  useEffect(
    () =>
      onUnauthorized(() => {
        window.location.hash = "#/login";
      }),
    []
  );
  if (!session.token) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

/** Standing in for views still on the migration list — links back, never dead-ends. */
function Migrating({ title }: { title: string }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <div className="amber-rule h-1 w-full" aria-hidden="true" />
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>This screen is not available in this build.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => window.history.back()}>
          Go back
        </Button>
      </CardContent>
    </Card>
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Public manufacturer tracking page: no session, no app shell. */}
        <Route path="/track/:token" element={<Track />} />
        {/* Public mobile photo-upload page: no session, no app shell. The token is the credential. */}
        <Route path="/m/:token" element={<MobileUpload />} />
        {/* Public report verification page: no session, no app shell. */}
        <Route path="/verify/:token" element={<Verify />} />
        <Route
          path="/projects"
          element={
            <RequireSession>
              <Shell>
                <Dashboard />
              </Shell>
            </RequireSession>
          }
        />
        <Route
          path="/projects/new"
          element={
            <RequireSession>
              <Shell>
                <Wizard />
              </Shell>
            </RequireSession>
          }
        />
        {[
          ["/projects/:id", "Project workspace", Project],
          ["/projects/:id/checklist", "Conformity checklist", Checklist],
          ["/models/:modelId", "Instrument overview", Model],
          ["/models/:modelId/tests/:code", "Test sheet", Model],
          ["/reports", "Report repository", Reports],
          ["/instruments", "Instrument registry", Instruments],
          ["/profile", "Profile", Profile],
          ["/test-history", "Test history", TestHistory],
        ].map(([path, title, Component]) => (
          <Route
            key={path as string}
            path={path as string}
            element={
              <RequireSession>
                <Shell>
                  {Component ? (
                    React.createElement(Component as React.ComponentType)
                  ) : (
                    <Migrating title={title as string} />
                  )}
                </Shell>
              </RequireSession>
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </HashRouter>
  );
}
