/**
 * The results file's join.
 *
 * A run replaces the rows it re-ran and keeps the rest. Which rows it
 * re-ran was asked by sprint number, and a sprint number cannot answer
 * it: sprint 4b records `sprint: 4.5` while `--sprint` and the default
 * list carry integers, so `sprints.includes(4.5)` was false and every
 * prior late-requirement row survived a full re-run while the fresh one
 * was appended beside it. The step count grew by 128 a run and the
 * ratchet stayed green, because the duplicated rows all passed and the
 * gate counts failures.
 *
 * Keying the join on what identifies a step removes the question rather
 * than teaching the filter about 4.5 -- which would put the "sprint 4
 * also runs 4b" pairing in a second place, where it could drift from
 * the runner that owns it.
 */

/** The identity of a step: one row per customer, sprint and step name. */
export const resultKey = (r) => `${r.customer}/${r.sprint}/${r.step}`;

/**
 * Join prior rows with this run's, fresh winning on a collision, and
 * order the result so the file is stable across runs.
 */
export function mergeResults(kept, fresh) {
  const byKey = new Map();
  for (const r of [...kept, ...fresh]) byKey.set(resultKey(r), r);
  return [...byKey.values()].sort((a, b) => resultKey(a).localeCompare(resultKey(b)));
}
