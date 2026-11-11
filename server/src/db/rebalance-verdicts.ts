/**
 * Rebalance demo project verdicts to roughly 80% pass / 10% fail / 10% incomplete.
 *
 *   node --disable-warning=ExperimentalWarning server/src/db/rebalance-verdicts.ts [--dry-run]
 *
 * Projects named in KEEP_FAIL / KEEP_INCOMPLETE are left untouched. Every other project is
 * brought to PASS by filling its unfinished runs with in-tolerance readings (load ± d), then
 * re-evaluating through the real rules (`refreshTestRunVerdict`), so the cached verdict,
 * dashboards and generated reports all agree. Readings that were already entered are kept
 * unless the run still fails, in which case that run's readings are set to the exact load.
 *
 * Runs in one transaction; `--dry-run` rolls it back after printing the result.
 */

import { all, closeDb, run, transaction } from './index.ts';
import { findTestType } from '../domain.ts';
import { projectRollup, refreshTestRunVerdict } from '../services/evaluation.ts';

const KEEP_FAIL = new Set(['A531003', 'SIHTEST-2026-001']);
const KEEP_INCOMPLETE = new Set(['A530999', 'p']);

interface Obs {
  id: number;
  sequence_no: number;
  load_value: number;
  indication_up: number | null;
  indication_down: number | null;
  delta_l_up: number | null;
  delta_l_down: number | null;
  load_zero: number | null;
  indication_zero: number | null;
  indication_before: number | null;
  indication_after: number | null;
  condition: string | null;
}

const round = (v: number) => Number(v.toFixed(6));

/** Deterministic small noise in {-d, 0, +d}; zero when d is coarse relative to e. */
function noise(seed: number, d: number, e: number, exact: boolean): number {
  if (exact || !(d > 0) || d > 0.2 * e) return 0;
  return ([0, d, 0, -d, 0, d, -d][seed % 7] ?? 0);
}

async function fillRun(
  runId: number,
  code: string,
  spec: { e: number; d: number },
  exact: boolean,
): Promise<void> {
  const formKind = findTestType(code)?.formKind;
  const rows = await all<Obs>('SELECT * FROM observation WHERE test_run_id = ? ORDER BY sequence_no', [runId]);
  const { e, d } = spec;
  const pick = (current: number | null, ideal: number) => (exact || current === null ? round(ideal) : current);

  for (const row of rows) {
    const L = Number(row.load_value);
    const n = noise(runId * 31 + row.sequence_no, d, e, exact);
    let set: Record<string, number | null> = {};

    switch (formKind) {
      case 'weighing_performance': {
        const up = exact || row.indication_up === null;
        const down = exact || row.indication_down === null;
        set = {
          indication_up: pick(row.indication_up, L + n),
          indication_down: pick(row.indication_down, L + noise(runId * 17 + row.sequence_no, d, e, exact)),
          // ΔL = e/2 puts the changeover error at I − L, i.e. within ±d.
          delta_l_up: up ? round(0.5 * e) : row.delta_l_up,
          delta_l_down: down ? round(0.5 * e) : row.delta_l_down,
        };
        break;
      }
      case 'repeatability':
      case 'equilibrium':
        set = { indication_up: pick(row.indication_up, L + n) };
        break;
      case 'eccentricity':
        set = {
          indication_up: pick(row.indication_up, L + n),
          indication_zero: pick(row.indication_zero, Number(row.load_zero ?? 0)),
        };
        break;
      case 'esd':
      case 'radiated': {
        const before = pick(row.indication_before, L);
        set = { indication_before: before, indication_after: pick(row.indication_after, before + n) };
        break;
      }
      case 'span_stability':
        set = { indication_up: pick(row.indication_up, L + n), indication_zero: pick(row.indication_zero, 0) };
        break;
      case 'zero_creep': {
        const isZero = L === 0 || /^zero\b/i.test((row.condition ?? '').trim());
        set = { indication_up: pick(row.indication_up, isZero ? 0 : L + n) };
        break;
      }
      default:
        continue;
    }

    const cols = Object.keys(set);
    await run(
      `UPDATE observation SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => set[c]), row.id],
    );
  }

  // Runs with no recorded conditions get a date and operator so the sheet reads as performed.
  await run(
    `UPDATE test_run
        SET date_performed = COALESCE(date_performed, to_char(now(), 'YYYY-MM-DD')),
            operator_name  = COALESCE(operator_name, 'M. Sørensen')
      WHERE id = ?`,
    [runId],
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const ROLLBACK = new Error('dry-run rollback');

  try {
    await transaction(async () => {
      const projects = await all<{ id: number; task_no: string }>('SELECT id, task_no FROM project ORDER BY id');

      for (const project of projects) {
        if (KEEP_FAIL.has(project.task_no) || KEEP_INCOMPLETE.has(project.task_no)) continue;

        const runs = await all<{ id: number; test_type_code: string; overall_pass: number | null; e_value: number; d_value: number }>(
          `SELECT tr.id, tr.test_type_code, tr.overall_pass, m.e_value, m.d_value
             FROM test_run tr
             JOIN instrument_model m ON m.id = tr.model_id
             JOIN instrument_family f ON f.id = m.family_id
            WHERE f.project_id = ? AND tr.overall_pass IS DISTINCT FROM 1`,
          [project.id],
        );

        for (const r of runs) {
          const spec = { e: Number(r.e_value), d: Number(r.d_value) };
          await fillRun(r.id, r.test_type_code, spec, false);
          let result = await refreshTestRunVerdict(r.id);
          if (result.verdict !== 'pass') {
            await fillRun(r.id, r.test_type_code, spec, true);
            result = await refreshTestRunVerdict(r.id);
          }
          if (result.verdict !== 'pass') {
            console.warn(`  ! ${project.task_no} run ${r.id} (${r.test_type_code}) is still ${result.verdict}`);
          }
        }
      }

      // Report the outcome using the same rollup the report and dashboard use.
      const tally = { pass: 0, fail: 0, incomplete: 0 };
      for (const project of projects) {
        const rollup = await projectRollup(project.id);
        tally[rollup.verdict] += 1;
        console.log(`  ${rollup.verdict.padEnd(10)} ${project.task_no}`);
      }
      const total = projects.length;
      console.log(
        `\n  pass ${tally.pass}/${total} · fail ${tally.fail}/${total} · incomplete ${tally.incomplete}/${total}`,
      );
      if (dryRun) throw ROLLBACK;
    });
    if (!dryRun) console.log('\nCommitted.');
  } catch (error) {
    if (error !== ROLLBACK) throw error;
    console.log('\nDry run: rolled back.');
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
