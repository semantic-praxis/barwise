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
 * Derived from `ciStepOccurrences()`, deduplicated by `args` with the first
 * occurrence kept, which is the shape `ci:local` and `fault-matrix` read.
 *
 * The condition is read from the WHOLE step, not the line after `run:`.
 * `test:optimizer` writes its `if:` before its `run:`, every other guarded
 * gate writes it after, and a scan in one direction would read the other
 * as unguarded -- safe, but silently wrong in exactly the way a runner
 * that only ever sees the safe direction cannot show
 * (`docs/specs/ci-local-condition-parity.spec.md`).
 */
export function ciSteps(workflow = WORKFLOW) {
  const found = [];
  for (const step of ciStepOccurrences(workflow)) {
    const npm = /^npm (.+)$/.exec(step.run ?? "");
    if (!npm) continue;
    const args = npm[1];
    if (SKIP.some((re) => re.test(args))) continue;
    if (!found.some((s) => s.args === args)) found.push({ args, condition: step.condition });
  }
  if (found.length === 0) {
    throw new Error(`no 'run: npm ...' steps found in ${workflow}; has the workflow moved?`);
  }
  return found;
}

/**
 * `continue-on-error`'s value as the gates read it: `true`, `false`, or
 * `null` for anything else -- an expression such as
 * `${{ matrix.experimental }}`, whose answer is not known until CI runs.
 */
function coe(raw) {
  if (raw === undefined || raw === "false") return false;
  if (raw === "true") return true;
  return null;
}

/**
 * Every step of every job, not deduplicated, as
 * `{ job, run, condition, continueOnError, workingDirectory }`
 * (docs/specs/executable-adrs.spec.md, WS1).
 *
 * - `run` is the raw value after `run:`, trimmed, or `null` for a step with
 *   none (`uses:`). A multi-line block reads as `|`, which matches no gate.
 * - `condition` joins the job's `if:` and the step's with ` && `.
 * - `continueOnError` is `true` if the job or the step says so, else `null`
 *   if either is an expression, else `false`.
 * - `workingDirectory` is the step's, else the job's
 *   `defaults.run.working-directory`, else `null`.
 *
 * Jobs are tracked because the deduplicated `ciSteps()` reading treated
 * every line after the first `steps:` as one job: a second job's own keys
 * would have landed on the previous job's last step. A step's keys are
 * read only at the step's key indent (the `- key:` line, or two spaces
 * deeper), so a `with:` child or a line inside a `run: |` block is never
 * taken for one.
 */
export function ciStepOccurrences(workflow = WORKFLOW) {
  const lines = readFileSync(workflow, "utf8").split("\n");
  const out = [];
  let inJobs = false;
  let jobIndent = -1;
  let job = null;
  let step = null;
  const finish = () => {
    if (step === null) return;
    const flags = [coe(job.coe), coe(step.coe)];
    out.push({
      job: job.name,
      run: step.run,
      condition: [job.condition, step.condition].filter(Boolean).join(" && "),
      continueOnError: flags.includes(true) ? true : flags.includes(null) ? null : false,
      workingDirectory: step.wd ?? job.wd,
    });
    step = null;
  };
  const indentOf = (line) => /^(\s*)/.exec(line)[1].length;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs || line.trim() === "" || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) {
      finish();
      inJobs = false;
      continue;
    }
    const indent = indentOf(line);
    const key = /^\s*([A-Za-z0-9_-]+):(?:\s+(.*?))?\s*$/.exec(line);
    if (key && (jobIndent < 0 || indent === jobIndent) && key[2] === undefined) {
      if (jobIndent < 0) jobIndent = indent;
      finish();
      job = { name: key[1], condition: "", coe: undefined, wd: null, steps: false, stepIndent: -1 };
      continue;
    }
    if (job === null) continue;
    const item = /^(\s*)- (.*)$/.exec(line);
    if (job.steps && item && (job.stepIndent < 0 || item[1].length === job.stepIndent)) {
      if (job.stepIndent < 0) job.stepIndent = item[1].length;
      finish();
      step = { run: null, condition: "", coe: undefined, wd: null };
    }
    if (step !== null && job.steps && indent > jobIndent + 2) {
      const at = item && item[1].length === job.stepIndent ? item[2] : indent === job.stepIndent + 2
        ? line.trim()
        : null;
      const field = at === null ? null : /^([A-Za-z-]+):\s*(.*?)\s*$/.exec(at);
      if (field) {
        if (field[1] === "run") step.run = field[2];
        if (field[1] === "if") step.condition = field[2];
        if (field[1] === "continue-on-error") step.coe = field[2];
        if (field[1] === "working-directory") step.wd = field[2];
      }
      continue;
    }
    // A job-level key: before `steps:`, or after the step list ends.
    finish();
    if (indent === jobIndent + 2 && key) {
      if (key[1] === "steps") job.steps = true;
      else job.steps = false;
      if (key[1] === "if") job.condition = key[2] ?? "";
      if (key[1] === "continue-on-error") job.coe = key[2];
    }
    if (key && key[1] === "working-directory" && !job.steps) job.wd = key[2] ?? null;
  }
  finish();
  return out;
}

/**
 * Whether a step's `if:` lets it run for a change of this class.
 *
 * Only the forms ci.yml uses are understood: a comparison of
 * `steps.changes.outputs.docs_only` or `.optimizer` with `'true'` or
 * `'false'`, `github.event_name == 'pull_request'`, and `&&` joins of
 * those. The event test is true locally: ci-local runs before a push, and
 * every push from a branch is headed for a pull request, so a PR-only step
 * is one the push will meet (check-tracker-closes, barwise-i61). Anything
 * else answers `run: true` with `understood: false`, because skipping a
 * gate CI will run turns a green local pass into a red push -- the failure
 * the local runner exists to prevent. The caller prints the unknown condition rather than hiding it.
 */
export function shouldRun(condition, cls) {
  if (condition === "") return { run: true, understood: true };
  const outputs = { docs_only: cls.docsOnly, optimizer: cls.optimizer };
  let run = true;
  for (const atom of condition.split("&&").map((s) => s.trim())) {
    if (/^github\.event_name\s*==\s*'pull_request'$/.test(atom)) continue;
    const m = /^steps\.changes\.outputs\.(docs_only|optimizer)\s*(==|!=)\s*'(true|false)'$/.exec(
      atom,
    );
    if (!m) return { run: true, understood: false };
    const equal = String(outputs[m[1]]) === m[3];
    if ((m[2] === "==") !== equal) run = false;
  }
  return { run, understood: true };
}
