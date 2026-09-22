import { useEffect } from "react";

/**
 * Refresh derived cells from server truth without touching keystrokes.
 *
 * Measurement forms keep rows in local state so typing never stalls on the
 * network — but that froze computed columns (errors, verdicts, tolerances) at
 * load time: after a save, the header badge caught up while every row still
 * showed yesterday's numbers. This patches only non-input keys from the latest
 * server rows, matched by sequenceNo, so in-flight edits survive and the whole
 * sheet — not just the badge — reflects the save the moment it lands.
 *
 * Runs only when the server rows change identity, i.e. on load and on save
 * responses. Keystrokes alone never trigger it.
 */
export function useDerivedSync(
  setRows: React.Dispatch<React.SetStateAction<any[]>>,
  serverRows: any[] | undefined,
  inputKeys: readonly string[],
) {
  useEffect(() => {
    if (!serverRows) return;
    const bySeq = new Map(serverRows.map((r: any) => [r?.sequenceNo, r]));
    setRows((prev) =>
      prev.map((local: any) => {
        const server = bySeq.get(local?.sequenceNo);
        if (!server) return local;
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(server)) {
          if (!inputKeys.includes(key)) patch[key] = value;
        }
        return { ...local, ...patch };
      }),
    );
    // Intentionally deps on identity only: any computed change is a new response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRows]);
}
