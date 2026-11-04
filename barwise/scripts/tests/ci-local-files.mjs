/**
 * The library files ci-local.mjs imports, read from its own import lines.
 * Fixtures that copy ci-local into a temp tree need them all; four test
 * files each listed them by hand, and a new import broke every one with
 * ERR_MODULE_NOT_FOUND until each list was edited.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function ciLocalLibs(scriptsDir) {
  const source = readFileSync(join(scriptsDir, "ci-local.mjs"), "utf8");
  return [...source.matchAll(/from "\.\/lib\/([\w.-]+\.mjs)"/g)].map((m) => m[1]);
}
