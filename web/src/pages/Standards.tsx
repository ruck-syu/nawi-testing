import { useEffect, useMemo, useState } from "react";
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
import {
  CHECKLIST_ITEMS,
  TEST_TYPES,
} from "../../../packages/domain/src/testTypes";

interface CustomEdition {
  name: string;
  testCodes: string[];
  clauseNos: string[];
  mpeLabel: string;
  basedOn: string;
}

/**
 * Standards: the visible proof that editions are data, not code.
 *
 * Each edition card shows exactly what selecting it in the wizard buys — the
 * test catalogue and the checklist clauses. The comparison answers the
 * ministry's question on screen: a new OIML edition arrives as new rows (plus
 * an MPE table entry if bands change), and everything here updates without a
 * code change.
 */
export function Standards() {
  const editions = useMemo(() => {
    const set = new Set<string>();
    for (const t of TEST_TYPES) {
      for (const s of t.applicableStandards) set.add(s);
    }
    return [...set].sort();
  }, []);
  // Prototype-only editions drafted through the Add dialog below. They live in
  // component state — nothing is stored — to demo what a new edition looks like
  // the moment it is defined. Shipping one for real is a seed-data task.
  const [customs, setCustoms] = useState<CustomEdition[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const allEditions = useMemo(
    () => [...editions, ...customs.map((c) => c.name)],
    [editions, customs]
  );
  const [editionA, setEditionA] = useState(editions[0] ?? "");
  const [editionB, setEditionB] = useState(editions[1] ?? editions[0] ?? "");
  const [openEdition, setOpenEdition] = useState<string | null>(null);

  const customByName = useMemo(() => new Map(customs.map((c) => [c.name, c])), [customs]);
  const testsFor = (edition: string) => {
    const custom = customByName.get(edition);
    if (custom) {
      const picked = new Set(custom.testCodes);
      return TEST_TYPES.filter((t) => picked.has(t.code)).sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
    }
    return TEST_TYPES.filter((t) => t.applicableStandards.includes(edition)).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
  };
  const clausesFor = (edition: string) => {
    const custom = customByName.get(edition);
    if (custom) {
      const picked = new Set(custom.clauseNos);
      return CHECKLIST_ITEMS.filter((c) => picked.has(c.clauseNo));
    }
    return CHECKLIST_ITEMS.filter(
      (c) => c.applicableStandards.length === 0 || c.applicableStandards.includes(edition)
    );
  };

  const codesA = new Set(testsFor(editionA).map((t) => t.code));
  const codesB = new Set(testsFor(editionB).map((t) => t.code));
  const onlyA = testsFor(editionA).filter((t) => !codesB.has(t.code));
  const onlyB = testsFor(editionB).filter((t) => !codesA.has(t.code));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Standards</h1>
          <p className="text-sm text-muted-foreground">
            What each supported edition contains. New OIML editions arrive as data rows —
            this page, the wizard dropdown, and every test sheet follow automatically.
          </p>
        </div>
        <Button size="sm" variant="accent" className="ml-auto" onClick={() => setDialogOpen(true)}>
          Add standard
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {allEditions.map((edition) => {
          const tests = testsFor(edition);
          const clauses = clausesFor(edition);
          const enterable = tests.filter((t) => t.formKind).length;
          const isDefault = edition === "OIML R76-1:2006";
          const isFuture = /20xx|future/i.test(edition);
          const custom = customByName.get(edition);
          const open = openEdition === edition;
          return (
            <div key={edition} className="flex flex-col rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">{edition}</p>
                {isDefault && (
                  <span className="rounded-sm bg-steel-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                    Default
                  </span>
                )}
                {isFuture && !custom && (
                  <span className="rounded-sm bg-amber-glow/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-glow">
                    Future placeholder
                  </span>
                )}
                {custom && (
                  <span className="rounded-sm bg-verify/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-verify">
                    Drafted here · not stored
                  </span>
                )}
              </div>
              <p className="tnum mt-1 text-sm text-muted-foreground">
                {tests.length} tests · {enterable} with data entry · {clauses.length} checklist clauses
                {custom ? ` · MPE: ${custom.mpeLabel}` : ""}
              </p>
              {isFuture && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Inherits today's catalogue until the new edition is published — then it is
                  renamed here and any changed rows ship with it.
                </p>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenEdition(open ? null : edition)}
                >
                  {open ? "Hide catalogue" : "Show catalogue"}
                </Button>
                {custom && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCustoms((prev) => prev.filter((c) => c.name !== edition));
                      if (editionA === edition) setEditionA(editions[0] ?? "");
                      if (editionB === edition) setEditionB(editions[1] ?? editions[0] ?? "");
                      if (openEdition === edition) setOpenEdition(null);
                    }}
                  >
                    Discard
                  </Button>
                )}
              </div>
              {open && (
                <Card className="mt-2 overflow-hidden p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Test</TableHead>
                        <TableHead>Sheet</TableHead>
                        <TableHead>Category</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tests.map((t) => (
                        <TableRow key={t.code}>
                          <TableCell className="text-sm">
                            <span className="font-semibold">{t.displayName}</span>
                            <span className="block font-mono text-xs text-muted-foreground">{t.code}</span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {t.reportSheetRef ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t.category}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </div>
          );
        })}
      </div>

      {allEditions.length > 1 && (
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="mb-2 text-sm font-bold">Compare editions</p>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              aria-label="First edition to compare"
              value={editionA}
              onChange={(e) => setEditionA(e.target.value)}
              className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
            >
              {allEditions.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">vs</span>
            <select
              aria-label="Second edition to compare"
              value={editionB}
              onChange={(e) => setEditionB(e.target.value)}
              className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
            >
              {allEditions.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          {onlyA.length === 0 && onlyB.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Identical catalogues — the future edition inherits today's rules until the new
              edition is published. When it lands, added and removed tests appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              {onlyA.map((t) => (
                <p key={t.code}>Only in {editionA}: <strong>{t.displayName}</strong> ({t.code})</p>
              ))}
              {onlyB.map((t) => (
                <p key={t.code}>Only in {editionB}: <strong>{t.displayName}</strong> ({t.code})</p>
              ))}
            </div>
          )}
        </div>
      )}
      {dialogOpen && (
        <AddStandardDialog
          baseEditions={editions}
          takenNames={allEditions}
          onClose={() => setDialogOpen(false)}
          onCreate={(custom) => {
            setCustoms((prev) => [...prev, custom]);
            setEditionB(custom.name);
            setOpenEdition(custom.name);
            setDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Show-only Add flow (prototype): draft a new edition by naming it, picking a
 * base catalogue, and ticking tests/clauses. Nothing is stored — on create the
 * edition appears above as a "drafted here" card and in the comparison, which
 * is exactly what the real flow produces after a seed. In production this
 * ships as data via `npm run seed`.
 */
function AddStandardDialog({
  baseEditions,
  takenNames,
  onClose,
  onCreate,
}: {
  baseEditions: string[];
  takenNames: string[];
  onClose: () => void;
  onCreate: (custom: CustomEdition) => void;
}) {
  const [name, setName] = useState("");
  const [basedOn, setBasedOn] = useState(baseEditions[0] ?? "");
  const [mpe, setMpe] = useState("OIML R76 Table 3 (current)");
  const [testCodes, setTestCodes] = useState<string[]>(() =>
    TEST_TYPES.filter((t) => t.applicableStandards.includes(baseEditions[0] ?? "")).map((t) => t.code)
  );
  const [clauseNos, setClauseNos] = useState<string[]>(() =>
    CHECKLIST_ITEMS.filter(
      (c) => c.applicableStandards.length === 0 || c.applicableStandards.includes(baseEditions[0] ?? "")
    ).map((c) => c.clauseNo)
  );

  // Re-seed the ticked sets when the base edition changes.
  useEffect(() => {
    setTestCodes(
      TEST_TYPES.filter((t) => t.applicableStandards.includes(basedOn)).map((t) => t.code)
    );
    setClauseNos(
      CHECKLIST_ITEMS.filter(
        (c) => c.applicableStandards.length === 0 || c.applicableStandards.includes(basedOn)
      ).map((c) => c.clauseNo)
    );
  }, [basedOn]);

  const toggle = (list: string[], value: string, setList: (v: string[]) => void) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const trimmed = name.trim();
  const duplicate = takenNames.some((t) => t.toLowerCase() === trimmed.toLowerCase());
  const problem = !trimmed
    ? "Name the new edition first."
    : duplicate
      ? "That identifier is already in use."
      : testCodes.length === 0
        ? "Tick at least one test."
        : null;

  const create = () => {
    if (problem) return;
    onCreate({ name: trimmed, testCodes, clauseNos, mpeLabel: mpe, basedOn });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Draft a new standard edition"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight">Draft a new edition</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Prototype — nothing here is stored. It previews what the real flow produces:
          name it, pick the catalogue, and the edition appears above and in the comparison.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="new-edition-name" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Edition identifier
            </label>
            <Input
              id="new-edition-name"
              placeholder="OIML R76-1:2028"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="new-edition-base" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Catalogue based on
            </label>
            <select
              id="new-edition-base"
              value={basedOn}
              onChange={(e) => setBasedOn(e.target.value)}
              className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
            >
              {baseEditions.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="new-edition-mpe" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              MPE table
            </label>
            <select
              id="new-edition-mpe"
              value={mpe}
              onChange={(e) => setMpe(e.target.value)}
              className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
            >
              <option>OIML R76 Table 3 (current)</option>
              <option>OIML R76 Table 3 (tightened bands)</option>
              <option>Build-spec table</option>
            </select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tests ({testCodes.length}/{TEST_TYPES.length})
              </p>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setTestCodes(TEST_TYPES.map((t) => t.code))}>
                All
              </button>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setTestCodes([])}>
                None
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border p-2">
              {TEST_TYPES.map((t) => (
                <label key={t.code} className="flex items-start gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={testCodes.includes(t.code)}
                    onChange={() => toggle(testCodes, t.code, setTestCodes)}
                  />
                  <span>
                    <span className="font-semibold">{t.displayName}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{t.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Clauses ({clauseNos.length}/{CHECKLIST_ITEMS.length})
              </p>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setClauseNos(CHECKLIST_ITEMS.map((c) => c.clauseNo))}>
                All
              </button>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setClauseNos([])}>
                None
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border p-2">
              {CHECKLIST_ITEMS.map((c) => (
                <label key={c.clauseNo} className="flex items-start gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={clauseNos.includes(c.clauseNo)}
                    onChange={() => toggle(clauseNos, c.clauseNo, setClauseNos)}
                  />
                  <span>
                    <span className="font-mono text-xs text-muted-foreground">{c.clauseNo}</span>
                    <span className="block">{c.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        {problem && <p className="text-sm text-reject">{problem}</p>}
        <div className="flex gap-2">
          <Button size="sm" variant="accent" onClick={create} disabled={!!problem}>
            Preview edition
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
