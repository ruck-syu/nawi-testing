import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { cn } from "../lib/utils";

const APPLICABLE: Array<[string, string]> = [
  ["existent", "Applicable"],
  ["non_existent", "Not present"],
  ["not_applicable", "Not applicable"],
];

const STATUS: Array<[string, string]> = [
  ["pass", "Conforms"],
  ["fail", "Does not conform"],
  ["na", "Not assessed"],
];

interface Item {
  itemId: number;
  clauseNo: string;
  description: string;
  category?: string;
  applicable: string;
  status: string;
  remarks?: string | null;
  linkedTestRunId?: number | null;
}

export function Checklist() {
  const { id } = useParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    api
      .get<{ items: Item[] }>(`/projects/${id}/checklist`)
      .then((data) => {
        if (live) setItems((data.items ?? []).map((i) => ({ ...i })));
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not load the checklist.");
      });
    return () => {
      live = false;
    };
  }, [id]);

  async function persist(item: Item) {
    try {
      await api.put(`/projects/${id}/checklist`, {
        results: [
          {
            itemId: item.itemId,
            applicable: item.applicable,
            status: item.status,
            remarks: item.remarks ?? null,
            linkedTestRunId: item.linkedTestRunId ?? null,
          },
        ],
      });
    } catch {
      // Toast equivalent: keep quiet but do not lose the local edit; the next
      // change retries. A failed save must never roll back what was typed.
    }
  }

  function update(index: number, patch: Partial<Item>) {
    setItems((list) => {
      if (!list) return list;
      const next = list.map((item, i) => (i === index ? { ...item, ...patch } : item));
      void persist(next[index] as Item);
      return next;
    });
  }

  const answered = useMemo(
    () => (items ?? []).filter((i) => i.status !== "na" || i.applicable !== "existent").length,
    [items]
  );
  const failing = useMemo(() => (items ?? []).filter((i) => i.status === "fail"), [items]);

  const visible = useMemo(() => {
    if (!items) return [];
    const withIndex = items.map((item, index) => ({ item, index }));
    if (filter === "unanswered")
      return withIndex.filter(({ item }) => item.status === "na" && item.applicable === "existent");
    if (filter === "fail") return withIndex.filter(({ item }) => item.status === "fail");
    if (filter === "pass") return withIndex.filter(({ item }) => item.status === "pass");
    return withIndex;
  }, [items, filter]);

  if (error) return <p className="text-sm text-reject">{error}</p>;
  if (!items) return <p className="text-sm text-muted-foreground">Loading the checklist…</p>;

  const pct = items.length > 0 ? Math.round((100 * answered) / items.length) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Conformity checklist</h1>
        <Link to={`/projects/${id}`} className="ml-auto">
          <Button variant="ghost" size="sm">
            Back to examination
          </Button>
        </Link>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        {items.length} clauses apply under this standard. The list comes from the database, so a
        revision of the standard changes the seed data rather than the software.
      </p>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5">
          <div className="h-2 overflow-hidden rounded-sm bg-muted">
            <div className="h-full bg-verify transition-all" style={{ width: `${pct}%` }} />
          </div>
          {failing.length > 0 ? (
            <p className="text-sm font-semibold text-reject">
              {failing.length} clause{failing.length === 1 ? "" : "s"} recorded as not conforming:{" "}
              {failing.map((i) => i.clauseNo).join(", ")}. A non-conforming clause fails the
              examination regardless of the measured results.
            </p>
          ) : answered === items.length ? (
            <p className="text-sm font-semibold text-verify">Every clause assessed and conforming.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {items.length - answered} clause{items.length - answered === 1 ? "" : "s"} still to
              assess.
            </p>
          )}
          <div>
            <select
              aria-label="Filter clauses"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
            >
              <option value="">All clauses</option>
              <option value="unanswered">Not yet assessed</option>
              <option value="fail">Not conforming</option>
              <option value="pass">Conforming</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Clause</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead className="w-36">Applicable</TableHead>
              <TableHead className="w-40">Conformity</TableHead>
              <TableHead className="w-64">Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Nothing matches that filter.
                </TableCell>
              </TableRow>
            )}
            {visible.map(({ item, index }) => (
              <TableRow key={item.itemId} className={cn(item.status === "fail" && "bg-reject-wash/40")}>
                <TableCell className="tnum whitespace-nowrap font-bold">{item.clauseNo}</TableCell>
                <TableCell className="text-sm">
                  {item.description}
                  {item.category && (
                    <div className="text-xs text-muted-foreground">{item.category}</div>
                  )}
                </TableCell>
                <TableCell>
                  <select
                    aria-label={`Is clause ${item.clauseNo} applicable`}
                    value={item.applicable}
                    onChange={(e) => {
                      const applicable = e.target.value;
                      update(index, {
                        applicable,
                        status: applicable !== "existent" ? "na" : item.status,
                      });
                    }}
                    className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm shadow-xs"
                  >
                    {APPLICABLE.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <select
                    aria-label={`Conformity for clause ${item.clauseNo}`}
                    value={item.status}
                    disabled={item.applicable !== "existent"}
                    onChange={(e) => update(index, { status: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm shadow-xs disabled:opacity-50"
                  >
                    {STATUS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {item.applicable !== "existent" && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Not assessed — clause not present
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="text"
                    aria-label={`Remarks for clause ${item.clauseNo}`}
                    placeholder="Observation, reference, deviation…"
                    defaultValue={item.remarks ?? ""}
                    onBlur={(e) => {
                      if (e.target.value !== (item.remarks ?? "")) {
                        update(index, { remarks: e.target.value });
                      }
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
