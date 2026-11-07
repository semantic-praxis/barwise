#!/usr/bin/env node
/**
 * A new spec carries an Open decisions section whose every entry says
 * where it stands (plan-before-code#open-decisions-reviewer;
 * docs/specs/adr-batch10-enforcers.spec.md, WS2).
 *
 * The decision: a spec does not decide an open question silently; the
 * reviewer settles them, and each entry gives a recommended default. What
 * a script can read of that is the shape: an `## Open decisions` heading,
 * and in each top-level entry one of "recommend", "resolved", "taken as",
 * "decided" or "default". A section that says only `None.` is accepted,
 * because the spec template tells an author to drop sections that do not
 * apply. The options and the trade-off are not machine-readable, and a
 * decision made silently in the body is review's, so the gate holds the
 * section and the default and nothing more.
 *
 * Which specs: those new since a fixed cutoff commit,
 * `OPEN_DECISIONS_REQUIRED_SINCE` in lib/spec-reader.mjs, by the rule
 * check:spec-touches uses (a file name absent from barwise/docs/specs/ in
 * the cutoff's tree; lib/spec-cutoff.mjs). Older specs are exempt by the
 * owner's decision, not because they conform: 75 of 201 lacked the
 * heading, and sweeping them is barwise-1007's. The cutoff is fixed, so a
 * spec that reaches main by any route is checked on every later run.
 *
 * Exit 0 every new spec conforms, 1 one does not (named), 2 the gate
 * could not answer: no tracked files, a spec unreadable, no corpus spec
 * read, or the cutoff not in this clone (a shallow clone, usually; the
 * message says which fix applies). `--cutoff <rev>` stands in for the
 * cutoff, for the gate's tests and for replaying the rule over history;
 * nothing in CI passes it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { opt } from "./lib/args.mjs";
import { gitAt } from "./lib/git-run.mjs";
import { fileName, specNamesAtCutoff } from "./lib/spec-cutoff.mjs";
import {
  inSpecCorpus,
  OPEN_DECISIONS_REQUIRED_SINCE,
  openDecisionsFindings,
} from "./lib/spec-reader.mjs";

// Every input is read inside the refusal: an unreadable spec is "could
// not answer" (exit 2), never a crash that exits 1 like a real finding.
let fresh, cutoff, corpus;
try {
  const lib = await import("./lib/tracked.mjs");
  const tracked = lib.trackedFiles();
  if (tracked.length === 0) throw new Error("the tracked-file list is empty");
  corpus = tracked.filter(inSpecCorpus);
  // A corpus of none is a gate that cannot see the specs (a moved
  // directory, a wrong root), and "no new spec fails" would read as green.
  if (corpus.length === 0) throw new Error("no spec under barwise/docs/specs/ is tracked");
  const given = opt("--cutoff");
  cutoff = given ?? OPEN_DECISIONS_REQUIRED_SINCE;
  const { existing } = specNamesAtCutoff(gitAt(lib.REPO_ROOT), cutoff, given);
  fresh = corpus.filter((f) => !existing.has(fileName(f))).map((f) => ({
    path: f,
    findings: openDecisionsFindings(readFileSync(resolve(lib.REPO_ROOT, f), "utf8")),
  }));
  // A spec being written is not yet tracked; say it was not read, so OK
  // does not claim to cover it.
  lib.noteUntrackedInput({
    pathspec: "barwise/docs/specs",
    suffix: ".spec.md",
    include: inSpecCorpus,
    gate: "check:spec-form",
  });
} catch (err) {
  console.error(`check:spec-form: cannot answer -- ${err.message}`);
  if (err.cause) console.error(`  cause: ${err.cause.message}`);
  process.exit(2);
}

const bad = fresh.filter((s) => s.findings.length > 0);
if (bad.length > 0) {
  const n = bad.reduce((sum, s) => sum + s.findings.length, 0);
  console.error(
    `check:spec-form: FAIL -- ${n} finding(s) in ${bad.length} spec(s) new since the cutoff ${
      cutoff.slice(0, 8)
    }:`,
  );
  for (const s of bad) for (const f of s.findings) console.error(`  ${s.path}: ${f}`);
  console.error(
    "A new spec has an `## Open decisions` section; each top-level entry says where it stands\n"
      + "(recommend, resolved, taken as, decided, or default), or the section says only `None.`\n"
      + "(plan-before-code#open-decisions-reviewer). A spec present by file name at the cutoff is exempt.",
  );
  process.exit(1);
}
console.log(
  `check:spec-form: ${fresh.length} of ${corpus.length} spec(s) new since the cutoff ${
    cutoff.slice(0, 8)
  }, each with a conforming Open decisions section. OK`,
);
