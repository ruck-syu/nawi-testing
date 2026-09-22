import { useRef, useState } from "react";
import { Input } from "./ui/input";
import { Field, Select } from "./forms";
import { InvalidPopup } from "./InvalidPopup";

/**
 * Conditions header — environmental and run-level facts for the whole test.
 *
 * Inputs are uncontrolled (defaultValue) and commit on blur/change: server responses
 * re-render derived values elsewhere on the sheet and must never steal or reset an
 * input mid-edit. `save` here is already the flush-first wrapper from the owning form.
 */

const FIELDS: Record<string, { label: string; key: string; type: string; step?: string; min?: number; max?: number; placeholder?: string; hint?: string }> = {
  date: { label: "Date performed", key: "date_performed", type: "date" },
  time: { label: "Time", key: "time_performed", type: "time" },
  operator: { label: "Operator", key: "operator_name", type: "text", placeholder: "Initials or name" },
  temperature: { label: "Temperature (°C)", key: "temperature_c", type: "number", step: "0.1", min: -10, max: 40, placeholder: "20.0", hint: "OIML envelope −10…+40 °C. The temperature the instrument was at, not the room, when they differ." },
  chamber: { label: "Chamber (°C)", key: "chamber_temp_c", type: "number", step: "0.1" },
  room: { label: "Room (°C)", key: "room_temp_c", type: "number", step: "0.1" },
  humidity: { label: "Relative humidity (%)", key: "humidity_pct", type: "number", step: "1", min: 20, max: 95, placeholder: "50", hint: "OIML envelope 20…95 %RH." },
  pressure: { label: "Pressure (hPa)", key: "barometric_hpa", type: "number", step: "1", min: 860, max: 1060, placeholder: "1013", hint: "OIML envelope 860…1060 hPa." },
  testLoad: { label: "Test load (g)", key: "test_load", type: "number", step: "any", hint: "The single load every trial in this test uses." },
  indicationZero: { label: "Indication at zero (g)", key: "indication_zero", type: "number", step: "any", hint: "Read with the receptor empty; used to correct the errors." },
};

export function Conditions({
  run,
  save,
  fields,
  title = "Conditions",
  note,
}: {
  run: Record<string, any>;
  save: (rows: undefined, extra: Record<string, unknown>) => Promise<unknown>;
  fields: string[];
  title?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="mb-1 text-base font-bold tracking-tight">{title}</h3>
      {note && <p className="mb-3 text-sm text-muted-foreground">{note}</p>}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
        {fields.map((name) => {
          const spec = FIELDS[name];
          if (!spec) return null;
          const current = run[spec.key];
          const initial = current === null || current === undefined ? "" : String(current);
          const commit = (raw: string) => {
            const num = Number(raw);
            const value =
              raw === "" ? null : spec.type === "number" ? (Number.isFinite(num) ? num : null) : raw;
            void save(undefined, { [spec.key]: value });
          };
          // Skip the save when nothing changed. Compared numerically for number fields so
          // cosmetic reformatting ("20" → "20.0") does not fire a request.
          const unchanged = (raw: string) => {
            if (raw === initial) return true;
            if (spec.type !== "number" || raw === "" || initial === "") return false;
            const a = Number(raw);
            const b = Number(initial);
            return Number.isFinite(a) && Number.isFinite(b) && a === b;
          };
          if (spec.type === "date" || spec.type === "time") {
            return (
              <Field key={name} label={spec.label} hint={spec.hint}>
                <Input
                  type={spec.type}
                  defaultValue={initial}
                  onChange={(e) => commit(e.target.value)}
                />
              </Field>
            );
          }
          return (
            <NumberField
              key={name}
              label={spec.label}
              hint={spec.hint}
              step={spec.step}
              min={spec.min}
              max={spec.max}
              placeholder={spec.placeholder}
              initial={initial}
              unchanged={unchanged}
              commit={commit}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Number condition field with an "invalid" popup.
 *
 * Native `type="number"` inputs swallow unparseable keystrokes (value reads as
 * ""), so wrong-type detection uses `validity.badInput`. On bad input the save
 * is skipped — previously it silently stored null — and a floating popup says
 * invalid instead.
 */
function NumberField({
  label,
  hint,
  step,
  min,
  max,
  placeholder,
  initial,
  unchanged,
  commit,
}: {
  label: string;
  hint?: string;
  step?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  initial: string;
  unchanged: (raw: string) => boolean;
  commit: (raw: string) => void;
}) {
  const [badKey, setBadKey] = useState(0);
  const anchorRef = useRef<HTMLInputElement | null>(null);
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        defaultValue={initial}
        aria-invalid={badKey > 0 || undefined}
        ref={anchorRef}
        onBlur={(e) => {
          if (e.target.validity.badInput) {
            setBadKey((k) => k + 1);
            return;
          }
          if (!unchanged(e.target.value)) commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {badKey > 0 && (
        <InvalidPopup
          key={badKey}
          anchorRef={anchorRef}
          message="invalid datatype"
          onClose={() => setBadKey(0)}
        />
      )}
    </Field>
  );
}

export function ConditionSelect({
  run,
  save,
  label,
  hint,
  fieldKey,
  options,
}: {
  run: Record<string, any>;
  save: (rows: undefined, extra: Record<string, unknown>) => Promise<unknown>;
  label: string;
  hint?: string;
  fieldKey: string;
  options: Array<[string, string]>;
}) {
  return (
    <Select
      label={label}
      hint={hint}
      value={String(run[fieldKey] ?? options[0]?.[0] ?? "")}
      onChange={(v) => {
        void save(undefined, { [fieldKey]: v });
      }}
      options={options}
    />
  );
}
