import { useRef, useState } from "react";
import { Input } from "./ui/input";
import { InvalidPopup } from "./InvalidPopup";
import { cn } from "../lib/utils";

/**
 * Shared measurement cells. Inputs are uncontrolled: defaultValue paints the last saved
 * reading once, keystrokes update local row state only, and server responses re-render
 * derived cells without touching the focused input. This is what makes the editing races
 * of the old client structurally impossible here.
 */

export function NumCell({
  value,
  label,
  onInput,
  onFlush,
  className,
  step,
  invalid,
}: {
  value: number | null | undefined;
  label: string;
  onInput: (value: number | null) => void;
  onFlush: () => void;
  className?: string;
  step?: string;
  /** Out-of-envelope value: red ring, still editable — the server refuses it on save. */
  invalid?: boolean;
}) {
  const [localInvalid, setLocalInvalid] = useState(false);
  const [popupKey, setPopupKey] = useState(0);
  const anchorRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
    <Input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || localInvalid || undefined}
      ref={anchorRef}
      defaultValue={value === null || value === undefined ? "" : String(value)}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          setLocalInvalid(false);
          setPopupKey(0);
          onInput(null);
        } else {
          const n = Number(raw);
          const validNum = Number.isFinite(n);
          setLocalInvalid(!validNum);
          // Fresh key per invalid keystroke re-triggers the popup timer.
          if (!validNum) setPopupKey((k) => k + 1);
          onInput(validNum ? n : null);
        }
      }}
      onBlur={() => {
        // Don't flush while invalid: saving null would wipe the last good reading.
        if (!localInvalid) onFlush();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "tnum text-right",
        (invalid || localInvalid) && "border-reject ring-1 ring-reject/50",
        className,
      )}
      {...(step ? { step } : {})}
    />
    {localInvalid && popupKey > 0 && (
      <InvalidPopup
        key={popupKey}
        anchorRef={anchorRef}
        message="invalid datatype"
        onClose={() => setPopupKey(0)}
      />
    )}
    </>
  );
}

export function TextCell({
  value,
  label,
  onInput,
  placeholder,
}: {
  value: string | null | undefined;
  label: string;
  onInput: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      type="text"
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value ?? ""}
      onChange={(e) => onInput(e.target.value)}
    />
  );
}

export function SelectCell({
  value,
  label,
  options,
  onInput,
}: {
  value: string | null | undefined;
  label: string;
  options: Array<[string, string]>;
  onInput: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      defaultValue={String(value ?? options[0]?.[0] ?? "")}
      onChange={(e) => onInput(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-input px-2 text-sm shadow-xs"
    >
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

export function VerdictCell({ pass }: { pass: boolean | null | undefined }) {
  if (pass === null || pass === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("text-sm font-bold", pass ? "text-verify" : "text-reject")}>
      {pass ? "Pass" : "Fail"}
    </span>
  );
}

export function ErrorValue({
  error,
  pass,
  dp,
  signed,
}: {
  error: number | null | undefined;
  pass: boolean | null | undefined;
  dp: number;
  signed: (v: number | null | undefined, dp: number) => string;
}) {
  return (
    <span className={cn("tnum font-semibold", pass === false && "text-reject")}>
      {signed(error, dp)}
    </span>
  );
}
