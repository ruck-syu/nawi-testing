import * as React from "react";
import { cn } from "../lib/utils";
import { Input, Label } from "./ui/input";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-40 flex-1 flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  hint,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  ariaLabel?: string;
}) {
  const control = (
    <select
      aria-label={ariaLabel ?? label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm shadow-xs"
    >
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
  if (!label) return control;
  return <Field label={label} hint={hint}>{control}</Field>;
}

export function Stepper({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="mb-5 flex gap-2" aria-label="Progress">
      {steps.map((name, i) => (
        <li
          key={name}
          aria-current={i === active ? "step" : undefined}
          className={cn(
            "flex-1 rounded-sm border px-3 py-2",
            i === active
              ? "border-amber-glow bg-steel-950 text-white"
              : i < active
                ? "border-verify/40 bg-verify-wash text-verify"
                : "bg-card text-muted-foreground"
          )}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
            Step {i + 1}
          </div>
          <div className="text-sm font-bold">{name}</div>
        </li>
      ))}
    </ol>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-reject/40 bg-reject-wash px-3 py-2 text-sm text-reject"
    >
      {message}
    </div>
  );
}

export { Input };
