import { useMemo, useState } from "react";
import { Input } from "./ui/input";

export type DateSort = "asc" | "desc";

/** YYYY-MM-DD key for comparison; "" when absent/invalid. */
export function dateKey(value?: string | null): string {
  if (!value) return "";
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** True when `value` falls inside the inclusive [from, to] range. Empty bounds are open. */
export function inDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  const key = dateKey(value);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function toLocalKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function shiftKey(todayKey: string, daysBack: number): string {
  const [y, m, d] = todayKey.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() - daysBack);
  return toLocalKey(dt);
}

const WINDOW_PRESETS = [7, 30, 90] as const;

interface DateFiltersProps {
  from: string;
  to: string;
  sort: DateSort;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onSort: (v: DateSort) => void;
  /** Prefix for aria-labels, e.g. "Started", "Generated", "Performed". */
  label?: string;
}

/**
 * Shared date filtering controls: one range dropdown (with presets; the two
 * date boxes only appear for a custom range) plus newest/oldest sort.
 */
export function DateFilters({
  from,
  to,
  sort,
  onFrom,
  onTo,
  onSort,
  label = "Date",
}: DateFiltersProps) {
  const today = useMemo(() => toLocalKey(new Date()), []);
  // Whether the user explicitly opened the custom range. Tracked separately
  // because picking "Custom range…" leaves from/to untouched, so a purely
  // derived preset would snap the dropdown back to "Any dates" and the date
  // boxes would never appear.
  const [customOpen, setCustomOpen] = useState(false);

  // Which preset the current from/to corresponds to ("" = any dates).
  const derived = useMemo(() => {
    if (!from && !to) return "";
    if (from === today && to === today) return "today";
    for (const n of WINDOW_PRESETS) {
      if (from === shiftKey(today, n - 1) && to === today) return String(n);
    }
    return "custom";
  }, [from, to, today]);
  const preset = customOpen ? "custom" : derived;

  function onPreset(value: string) {
    if (value === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    if (value === "") {
      onFrom("");
      onTo("");
    } else if (value === "today") {
      onFrom(today);
      onTo(today);
    } else if (value === "7" || value === "30" || value === "90") {
      onFrom(shiftKey(today, Number(value) - 1));
      onTo(today);
    }
  }

  return (
    <>
      <select
        aria-label={`${label} date range`}
        value={preset}
        onChange={(e) => onPreset(e.target.value)}
        className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
      >
        <option value="">Any dates</option>
        <option value="today">Today</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="custom">Custom range…</option>
      </select>
      {preset === "custom" && (
        <>
          <Input
            type="date"
            aria-label={`${label} from date`}
            title={`${label} from`}
            value={from}
            max={to || undefined}
            onChange={(e) => onFrom(e.target.value)}
            className="w-auto sm:max-w-[10.5rem]"
          />
          <Input
            type="date"
            aria-label={`${label} to date`}
            title={`${label} to`}
            value={to}
            min={from || undefined}
            onChange={(e) => onTo(e.target.value)}
            className="w-auto sm:max-w-[10.5rem]"
          />
        </>
      )}
      <select
        aria-label={`${label} sort by date`}
        value={sort}
        onChange={(e) => onSort(e.target.value as DateSort)}
        className="h-9 rounded-md border border-border bg-input px-3 text-sm shadow-xs"
      >
        <option value="desc">Date: newest first</option>
        <option value="asc">Date: oldest first</option>
      </select>
    </>
  );
}
