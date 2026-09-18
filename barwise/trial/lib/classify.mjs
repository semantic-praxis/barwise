/**
 * Match a failing step to a finding class in findings/catalog.json.
 * Every matcher on a class must fit: `step` is a regex over the step
 * name, `importer` an exact importer id, `detail` a substring of the
 * graded detail (`severity` is descriptive, not a matcher). First fit wins, so the
 * catalog lists the specific classes before the general ones.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINDINGS_DIR } from "./paths.mjs";

export function loadCatalog() {
  return JSON.parse(readFileSync(join(FINDINGS_DIR, "catalog.json"), "utf8")).classes;
}

export function classify(row, classes = loadCatalog()) {
  for (const c of classes) {
    if (c.step && !new RegExp(c.step).test(row.step)) continue;
    if (c.importer && row.importer !== c.importer) continue;
    if (c.detail && !String(row.detail ?? "").includes(c.detail)) continue;
    return c;
  }
  return null;
}
