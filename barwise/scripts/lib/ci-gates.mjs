/**
 * The CI gate list, parsed out of `.github/workflows/ci.yml`.
 *
 * The steps are DERIVED rather than restated. A hand-copied list would
 * be a must-agree copy with nothing keeping it honest (CLAUDE.md), and
 * it would fail in the specific way that motivated `ci-local.mjs`:
 * silently, by omitting the gate that was about to break.
 *
 * This lives in `lib/` because two callers need the same answer for
 * different reasons. `ci-local.mjs` runs the list; `fault-matrix.mjs`
 * perturbs each entry's environment and reads what it says. Two parsers
 * over one workflow file is the copy the rule forbids, and the drift
 * would be invisible: each would still report OK over its own subset.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `barwise/scripts/lib` -> `barwise` -> the repo root -> the workflow. */
export const WORKFLOW = resolve(SCRIPTS, "../../.github/workflows/ci.yml");

/** `npm ci` installs rather than checks. Everything else CI runs, this runs. */
const SKIP = [/^ci$/];

/**
 * Every `run: npm <args>` step in ci.yml, in order, deduplicated.
 *
 * Returns the argument string as CI writes it -- `run test:coverage`,
 * `run audit:specs -- --check` -- so a caller can either hand it to npm
 * verbatim or resolve it against package.json.
 *
 * Throws rather than returning an empty list. Nothing downstream can
 * distinguish "the workflow declares no npm steps" from "the workflow
 * moved and this parsed a file that is not it", and both would read as
 * a clean run over zero gates -- the shape
 * `docs/specs/gate-refusal-contract.spec.md` exists to remove.
 */
export function ciGates(workflow = WORKFLOW) {
  const yml = readFileSync(workflow, "utf8");
  const found = [];
  for (const line of yml.split("\n")) {
    const m = /^\s*(?:- )?run: npm (.+?)\s*$/.exec(line);
    if (!m) continue;
    const args = m[1];
    if (SKIP.some((re) => re.test(args))) continue;
    if (!found.includes(args)) found.push(args);
  }
  if (found.length === 0) {
    throw new Error(`no 'run: npm ...' steps found in ${workflow}; has the workflow moved?`);
  }
  return found;
}
