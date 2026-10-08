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
  return ciSteps(workflow).map((s) => s.args);
}

/**
 * Every `run: npm <args>` step with the `if:` that guards it, as
 * `{ args, condition }` -- `condition` is `""` for an unguarded step.
 *
 * The condition is read from the WHOLE step, not the line after `run:`.
 * `test:optimizer` writes its `if:` before its `run:`, every other guarded
 * gate writes it after, and a scan in one direction would read the other
 * as unguarded -- safe, but silently wrong in exactly the way a runner
 * that only ever sees the safe direction cannot show
 * (`docs/specs/ci-local-condition-parity.spec.md`).
 *
 * A step starts at a `- ` at the indent of the first item under `steps:`;
 * deeper dashes (a `with:` list) belong to the step above them.
 */
export function ciSteps(workflow = WORKFLOW) {
  const lines = readFileSync(workflow, "utf8").split("\n");
  const blocks = [];
  let stepIndent = -1;
  let inSteps = false;
  for (const line of lines) {
    if (/^\s*steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    const item = /^(\s*)- /.exec(line);
    if (item && stepIndent < 0) stepIndent = item[1].length;
    if (item && item[1].length === stepIndent) blocks.push([]);
    if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }

  const found = [];
  for (const block of blocks) {
    let args;
    let condition = "";
    for (const line of block) {
      const run = /^\s*(?:- )?run: npm (.+?)\s*$/.exec(line);
      if (run) args = run[1];
      const cond = /^\s*(?:- )?if:\s*(.+?)\s*$/.exec(line);
      if (cond) condition = cond[1];
    }
    if (args === undefined || SKIP.some((re) => re.test(args))) continue;
    if (!found.some((s) => s.args === args)) found.push({ args, condition });
  }
  if (found.length === 0) {
    throw new Error(`no 'run: npm ...' steps found in ${workflow}; has the workflow moved?`);
  }
  return found;
}

/**
 * Whether a step's `if:` lets it run for a change of this class.
 *
 * Only the forms ci.yml uses are understood: a comparison of
 * `steps.changes.outputs.docs_only` or `.optimizer` with `'true'` or
 * `'false'`, and `&&` joins of those. Anything else answers `run: true`
 * with `understood: false`, because skipping a gate CI will run turns a
 * green local pass into a red push -- the failure the local runner exists
 * to prevent. The caller prints the unknown condition rather than hiding it.
 */
export function shouldRun(condition, cls) {
  if (condition === "") return { run: true, understood: true };
  const outputs = { docs_only: cls.docsOnly, optimizer: cls.optimizer };
  let run = true;
  for (const atom of condition.split("&&").map((s) => s.trim())) {
    const m = /^steps\.changes\.outputs\.(docs_only|optimizer)\s*(==|!=)\s*'(true|false)'$/.exec(
      atom,
    );
    if (!m) return { run: true, understood: false };
    const equal = String(outputs[m[1]]) === m[3];
    if ((m[2] === "==") !== equal) run = false;
  }
  return { run, understood: true };
}
