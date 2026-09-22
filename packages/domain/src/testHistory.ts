/**
 * testHistory — filter predicate for test run records.
 *
 * Pure domain logic (previously lived in the retired classic client's
 * test-history view): given a run and the active filters, answers whether the
 * run belongs on screen. Both the history screen and its unit tests consume it.
 */

export interface TestHistoryFilter {
  needle?: string;
  testTypeCode?: string;
  verdict?: string;
  projectId?: string | number;
}

export interface TestHistoryRun {
  projectId?: string | number;
  testTypeCode?: string;
  verdict?: string;
  taskNo?: string;
  reportNo?: string;
  manufacturerName?: string;
  modelName?: string;
  familyName?: string;
  displayName?: string;
  operatorName?: string;
  category?: string;
  remarks?: string;
}

/** Filter match predicate for test run records. */
export function matches(
  run: TestHistoryRun,
  { needle = '', testTypeCode = '', verdict = '', projectId = '' }: TestHistoryFilter = {},
): boolean {
  if (projectId !== '' && String(run.projectId) !== String(projectId)) return false;
  if (testTypeCode && run.testTypeCode !== testTypeCode) return false;
  if (verdict && run.verdict !== verdict) return false;

  const term = needle.trim().toLowerCase();
  if (!term) return true;

  return [
    run.taskNo,
    run.reportNo,
    run.manufacturerName,
    run.modelName,
    run.familyName,
    run.testTypeCode,
    run.displayName,
    run.operatorName,
    run.category,
    run.remarks,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}
