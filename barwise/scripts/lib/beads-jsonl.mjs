/**
 * The tracker's line format and derived fields, shared by every script that
 * writes `.beads/issues.jsonl`: beads-crud.mjs and the merge driver
 * (docs/specs/beads-merge-driver.spec.md).
 *
 * One module rather than a copy in each, because the two must agree: a merge
 * that serialized or counted differently from beads-crud would have its
 * every merged line rewritten by the next beads-crud write.
 *
 * The functions take plain issue objects, so a caller holding its own record
 * wrappers passes `records.map((r) => r.obj)`; the objects are mutated in
 * place.
 */

const BLOCKS_TYPE = "blocks";

/**
 * Mirrors check-beads.sh's go_compact(): reproduce cmd/bd/export.go's
 * json.Marshal output so every write passes the canonical-form check.
 */
export function canonicalLine(obj) {
  return JSON.stringify(obj)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

/** The `blocks` edges out of `id`, and into it from every other issue. */
export function blocksDepCount(id, issues) {
  const self = issues.find((o) => o.id === id);
  const dependencyCount = self
    ? (self.dependencies || []).filter((d) => d.type === BLOCKS_TYPE).length
    : 0;
  let dependentCount = 0;
  for (const o of issues) {
    for (const d of o.dependencies || []) {
      if (d.type === BLOCKS_TYPE && d.depends_on_id === id) dependentCount++;
    }
  }
  return { dependencyCount, dependentCount };
}

/**
 * Recompute dependency_count/dependent_count for each issue in `ids`
 * (a dependent_count changes on the far side of an edge just added or
 * removed, so callers pass both ends). One pass over the edges, then one
 * over the issues: the merge driver passes every id, and asking
 * blocksDepCount per id made that a scan per issue.
 */
export function recomputeCounts(issues, ids) {
  const touched = new Set(ids);
  const dependents = new Map();
  for (const o of issues) {
    for (const d of o.dependencies || []) {
      if (d.type === BLOCKS_TYPE) {
        dependents.set(d.depends_on_id, (dependents.get(d.depends_on_id) ?? 0) + 1);
      }
    }
  }
  for (const o of issues) {
    if (touched.has(o.id)) {
      o.dependency_count = (o.dependencies || []).filter((d) => d.type === BLOCKS_TYPE).length;
      o.dependent_count = dependents.get(o.id) ?? 0;
    }
  }
}
