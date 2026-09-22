import { useCallback, useEffect, useRef } from "react";

/**
 * Debounced, non-overlapping autosave — a hook port of the vanilla autosaver.
 *
 * The trailing call is always honoured: edits landing while a save is in flight run one
 * more save afterwards with the final state. In React the stale-echo races of the old
 * client cannot occur by construction: inputs bind to local row state that server
 * responses never overwrite, so no focus-restore or echo-merging logic is needed.
 */
export function useAutosaver(save: () => Promise<unknown>, delay = 500) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const pending = useRef(false);

  const fire = useCallback(async () => {
    if (inFlight.current) {
      pending.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      try {
        await saveRef.current();
      } finally {
        inFlight.current = null;
        if (pending.current) {
          pending.current = false;
          void fire();
        }
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void fire();
    }, delay);
  }, [delay, fire]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return fire();
  }, [fire]);

  const hasPending = useCallback(
    () => timer.current !== null || inFlight.current !== null || pending.current,
    []
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { schedule, flush, hasPending };
}

/**
 * Wrap a form's save before handing it to the conditions header. Header edits send no
 * rows, and the response re-renders derived values — flushing unsent table edits first
 * keeps the evaluation from being computed without them.
 */
export function withTableFlush(
  saver: { flush: () => Promise<unknown>; hasPending: () => boolean },
  save: (rows: unknown[] | undefined, extra?: Record<string, unknown>) => Promise<unknown>,
  getRows: () => unknown[]
) {
  return (rows: unknown[] | undefined, extra: Record<string, unknown> = {}) => {
    if (rows !== undefined) return save(rows, extra);
    const flushed = saver.hasPending() ? saver.flush() : Promise.resolve();
    return flushed.then(() => save(getRows(), extra));
  };
}
