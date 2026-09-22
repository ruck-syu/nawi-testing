import type { SaveFn } from "./types";

/**
 * Props every test-sheet form receives. `computed` is the server's evaluation —
 * derived columns render from it and inputs never do. `save` sends rows (or a
 * conditions-only update with rows undefined) and resolves with the new evaluation.
 */
export interface SheetFormProps {
  computed: {
    run: Record<string, any>;
    spec?: Record<string, any>;
    testType?: Record<string, any> | null;
    formKind?: string | null;
    verdict?: string;
    overallPass?: boolean;
    result?: any;
    attachments?: any[];
  };
  save: SaveFn;
  onDirty: () => void;
  /** Refresh computed state from a refetched run (structural changes: add row, reset). */
  onStructuralChange: () => Promise<void>;
}

export type SaveFn = (
  rows: unknown[] | undefined,
  extra?: Record<string, unknown>
) => Promise<any>;
