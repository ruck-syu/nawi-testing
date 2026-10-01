import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiBase } from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";

interface VerifyData {
  valid: true;
  reportNo: string | null;
  taskNo: string;
  standardVersion: string;
  manufacturer: string;
  instrument: string | null;
  overallVerdict: string | null;
  testCount: number;
  passCount: number;
  failCount: number;
  incompleteCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
  generatedAt: string;
  integrityHash: string | null;
}

type VerifyResponse = { valid: false } | VerifyData;

function shortDate(value: string | null) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function text(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function Verify() {
  const { token } = useParams();
  const [data, setData] = useState<VerifyResponse | null>(null);

  useEffect(() => {
    let live = true;
    // Plain fetch on purpose: this page is public and must never read or
    // disturb the technician/admin login session.
    fetch(`${apiBase}/api/public/verify/${encodeURIComponent(token ?? "")}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid");
        return (await res.json()) as VerifyResponse;
      })
      .then((json) => {
        if (live) setData(json);
      })
      .catch(() => {
        // Unreachable server or bad response: indistinguishable from an
        // unknown code from the visitor's side, so show the invalid state.
        if (live) setData({ valid: false });
      });
    return () => {
      live = false;
    };
  }, [token]);

  if (!data) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-3 p-6">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
          role="status"
          aria-label="Loading verification result"
        />
        <p className="text-sm text-muted-foreground">Verifying report…</p>
      </div>
    );
  }

  if (!data.valid) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-3 p-6">
        <h1 className="text-xl font-bold tracking-tight">Verification Failed</h1>
        <p
          className="rounded-md border border-reject/40 bg-reject-wash px-4 py-3 text-sm font-semibold text-reject"
          role="alert"
        >
          Verification Failed — No report found for this verification code.
        </p>
      </div>
    );
  }

  const passed = data.overallVerdict === "pass";
  const completed = data.testCount - data.incompleteCount;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-6">
      <header className="border-b-2 border-primary pb-4 text-center">
        <p className="text-lg font-bold tracking-wide">भारत सरकार / Government of India</p>
        <p className="text-sm font-semibold">Ministry of Consumer Affairs, Food &amp; Public Distribution</p>
        <p className="text-sm font-semibold tracking-wide">Legal Metrology Division</p>
      </header>

      <p
        className={cn(
          "rounded-md border px-4 py-3 text-sm",
          passed
            ? "border-verify/40 bg-verify-wash text-verify"
            : "border-reject/40 bg-reject-wash text-reject"
        )}
        role="status"
      >
        <span className="block text-base font-bold tracking-wide">
          {passed ? "REPORT VERIFIED — PASS" : "REPORT VERIFIED — FAIL"}
        </span>
        {passed
          ? "This OIML R76 type-examination report has been digitally signed and is authentic."
          : "This report is authentic but the instrument did not pass all required tests."}
      </p>

      <Card aria-label="Report details">
        <CardHeader>
          <CardTitle>Report Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Report No</dt>
              <dd>{text(data.reportNo)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Task No</dt>
              <dd>{text(data.taskNo)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Standard</dt>
              <dd>{text(data.standardVersion)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Manufacturer</dt>
              <dd>{text(data.manufacturer)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:col-span-2">
              <dt className="font-semibold text-muted-foreground">Instrument</dt>
              <dd className="text-right">{text(data.instrument)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card aria-label="Test results">
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm font-semibold text-muted-foreground">Overall Result</span>
            <Badge variant={passed ? "pass" : "fail"} className="px-3 py-1 text-sm">
              {passed ? "PASS" : "FAIL"}
            </Badge>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-muted">
            <div
              className={cn("h-full transition-all", passed ? "bg-verify" : "bg-reject")}
              style={{ width: `${data.testCount > 0 ? Math.round((100 * completed) / data.testCount) : 0}%` }}
            />
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Tests Completed</dt>
              <dd className="tnum">
                {completed} / {data.testCount}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Tests Passed</dt>
              <dd className="tnum">{data.passCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Tests Failed</dt>
              <dd className="tnum">{data.failCount}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card aria-label="Approval and integrity">
        <CardHeader>
          <CardTitle>Approval &amp; Integrity</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Approved By</dt>
              <dd>{text(data.approvedBy)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Approved On</dt>
              <dd>{shortDate(data.approvedAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-muted-foreground">Generated On</dt>
              <dd>{shortDate(data.generatedAt)}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="font-semibold text-muted-foreground">Integrity Hash</dt>
              <dd className="break-all font-mono text-xs">{text(data.integrityHash)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        Verify a report by scanning its QR code — the code opens this page for that report.
      </footer>
    </div>
  );
}
