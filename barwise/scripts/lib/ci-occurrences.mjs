/**
 * Every step of every job in a workflow, read with a YAML parser
 * (docs/specs/executable-adrs.spec.md, WS1). `check:architecture` reads
 * it to decide whether a gate an ADR declares can fail CI.
 *
 * A separate module from `ci-gates.mjs` on purpose. `ci-gates.mjs` is
 * imported by `ci-local.mjs`, whose own tests copy it into throwaway trees
 * with no `node_modules`, so it stays on builtins and its line scanner. A
 * hand-written line parser was tried here first and a review found it
 * wrong in two ways a YAML parser cannot be: a job-level key written after
 * `steps:` never reached the job's steps, and a step list indented at the
 * same column as `steps:` lost every step's keys. Two readers of one file
 * must agree, so `ci-conditions.test.mjs` holds them to the same answer on
 * the real workflow (`docs/adr/must-agree-copies.md`).
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

/**
 * `continue-on-error` as the gate reads it: `true`, `false`, or `null` for
 * an expression such as `${{ matrix.experimental }}`, whose answer is not
 * known until CI runs.
 */
function coe(value) {
  if (value === undefined || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  return null;
}

/**
 * A working directory in one spelling: `./barwise` and `barwise/` are the
 * directory GitHub runs `barwise` in, so they compare equal.
 */
const dir = (value) =>
  typeof value === "string" ? value.replace(/^\.\//, "").replace(/\/+$/, "") || "." : null;

/** An `if:` as text; YAML reads `if: false` as a boolean, kept as `"false"`. */
const condition = (value) => (value === undefined || value === null ? "" : String(value).trim());

/**
 * `[{ job, run, condition, continueOnError, workingDirectory }]`, one per
 * step, in order, not deduplicated.
 *
 * - `run` is the step's `run:` trimmed, or `null` for a step with none
 *   (`uses:`). A multi-line block keeps its newlines and so matches no
 *   single `npm run` line.
 * - `condition` joins the job's `if:` and the step's with ` && `.
 * - `continueOnError` is `true` if the job or the step says so, else `null`
 *   if either is an expression, else `false`.
 * - `workingDirectory` is the step's, else the job's
 *   `defaults.run.working-directory`, else the workflow's, else `null`,
 *   without a leading `./` or a trailing `/`.
 *
 * Throws when the file cannot be read or is not a workflow with jobs.
 */
export function ciStepOccurrences(workflow) {
  const doc = parse(readFileSync(workflow, "utf8"));
  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) {
    throw new Error(`${workflow} has no jobs: map`);
  }
  const out = [];
  const workflowWd = doc.defaults?.run?.["working-directory"] ?? null;
  for (const [name, job] of Object.entries(jobs)) {
    if (job === null || typeof job !== "object" || !Array.isArray(job.steps)) continue;
    const jobWd = job.defaults?.run?.["working-directory"] ?? workflowWd;
    for (const step of job.steps) {
      if (step === null || typeof step !== "object") continue;
      const flags = [coe(job["continue-on-error"]), coe(step["continue-on-error"])];
      out.push({
        job: name,
        run: typeof step.run === "string" ? step.run.trim() : null,
        condition: [condition(job.if), condition(step.if)].filter(Boolean).join(" && "),
        continueOnError: flags.includes(true) ? true : flags.includes(null) ? null : false,
        workingDirectory: dir(step["working-directory"] ?? jobWd),
      });
    }
  }
  return out;
}
