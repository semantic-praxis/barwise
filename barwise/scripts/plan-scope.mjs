#!/usr/bin/env node
/**
 * How a branch compares with the plan it names
 * (docs/specs/plan-scope-check.spec.md, WS3).
 *
 * A spec declares what a change will touch; nothing compared the diff with
 * that declaration, so the diff could exceed the plan silently and the
 * reviewer had to reconstruct which files were intended. This prints, for
 * the current branch against its base:
 *
 *   - any plan.md or PLAN.md the branch adds outside barwise/docs/specs/
 *     (Open decision 4: reported, not refused -- an ad hoc plan gets no
 *     review and no Status);
 *   - the specs the branch names: each spec its diff changes, and each spec
 *     file name a commit message on the branch mentions;
 *   - its size, with generated and recorded files left out (the marks in
 *     .gitattributes, read through lib/generated.mjs), and where that size
 *     falls among the last 100 merged PRs on the base;
 *   - each changed file no named spec plans, read from a spec's Touches:
 *     header, or from the paths its text names when it has none.
 *
 * It REPORTS and never gates (the spec, "Should the check fail a build?"):
 * size and "outside the plan" are shadows of review cost, and a gate on
 * them is what turns the divergence into gaming. Exit 0 whenever a report
 * is printed, whatever it says; exit 2 when git cannot list the changes or
 * resolve the base, with no report at all.
 *
 * The diff is three-dot (`base...HEAD`), as pr-risk reads it: what this
 * branch changed since it left the base, not the base's own later commits.
 *
 *   npm run plan-scope [-- --base <ref>]      (default origin/main)
 *   --root <dir> runs against another git tree, for this script's tests.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { opt } from "./lib/args.mjs";
import { generatedPaths } from "./lib/generated.mjs";
import { matchesPattern } from "./lib/review-tiers.mjs";
import { inSpecCorpus, namedPaths, touches } from "./lib/spec-reader.mjs";

const SPEC_DIR = "barwise/docs/specs/";
/** An ad hoc plan file: plan.md or PLAN.md by name, anywhere but the specs directory. */
const isAdHocPlan = (f) => /(^|\/)(plan|PLAN)\.md$/.test(f) && !f.startsWith(SPEC_DIR);

let report;
try {
  const root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const base = opt("--base", "origin/main");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const lines = (out) => out.split("\0").filter(Boolean);

  // Changed files with their status, and lines per file, since the branch
  // left the base. Renames off, so a move is its two paths.
  const status = lines(git("diff", "--name-status", "-z", "--no-renames", `${base}...HEAD`));
  const changed = [];
  const added = new Set();
  for (let i = 0; i + 1 < status.length; i += 2) {
    changed.push(status[i + 1]);
    if (status[i] === "A") added.add(status[i + 1]);
  }
  const lineCount = new Map();
  for (const rec of lines(git("diff", "--numstat", "-z", "--no-renames", `${base}...HEAD`))) {
    const [a, d, path] = rec.split("\t");
    // A binary file reads "-": count it as a file, not as lines.
    lineCount.set(path, (Number(a) || 0) + (Number(d) || 0));
  }

  const trackedList = lines(git("ls-files", "-z"));
  // A repository always tracks files: an empty listing is git answering
  // emptily, and a report built on it would read no spec and plan nothing.
  // Checked before the merge history, so a refusal costs nothing.
  if (trackedList.length === 0) throw new Error(`git ls-files lists nothing under ${root}`);

  const generated = generatedPaths(changed, root);
  const counted = changed.filter((f) => !generated.has(f));
  const size = counted.reduce((n, f) => n + (lineCount.get(f) ?? 0), 0);

  // Where that size falls: the last 100 merges on the base's first-parent
  // line, each measured the same way. Measured at about 2s for 100.
  const merges = git("log", "--first-parent", "--merges", "-100", "--format=%H", base)
    .split("\n").filter(Boolean);
  const sizes = merges.map((m) => {
    const recs = lines(git("diff", "--numstat", "-z", "--no-renames", `${m}^1`, m))
      .map((r) => r.split("\t"));
    const gen = generatedPaths(recs.map((r) => r[2]), root);
    return recs.filter((r) => !gen.has(r[2])).reduce(
      (n, [a, d]) => n + (Number(a) || 0) + (Number(d) || 0),
      0,
    );
  });
  const below = sizes.filter((s) => s < size).length;

  // The specs the branch names.
  const tracked = new Set([...trackedList, ...added]);
  // Only specs on disk: one the branch deletes, archives or renames away
  // (staged or not) is a change to a plan, not a plan to read.
  const onDisk = (f) => existsSync(join(root, f));
  const specs = new Set(changed.filter((f) => inSpecCorpus(f) && onDisk(f)));
  const messages = git("log", "--format=%B", `${base}..HEAD`);
  for (const m of messages.matchAll(/([\w.-]+\.spec\.md)/g)) {
    const f = SPEC_DIR + m[1];
    if (tracked.has(f) && inSpecCorpus(f) && onDisk(f)) specs.add(f);
  }

  // Each spec's plan: its Touches: entries, or the paths its text names.
  const dirs = new Set();
  for (const f of tracked) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const exists = (p) => tracked.has(p) || dirs.has(p);
  const plan = [];
  const read = [];
  for (const spec of [...specs].sort()) {
    const text = readFileSync(join(root, spec), "utf8");
    const declared = touches(text);
    if (declared !== undefined) {
      plan.push(...declared.map((e) => e.path));
      read.push(`${spec.slice(SPEC_DIR.length)} (Touches:)`);
    } else {
      plan.push(
        // No directories: a spec's prose names `barwise/` or `packages/`
        // in passing, and as a plan entry that would cover the whole tree.
        // Only a Touches: header may plan a directory, deliberately.
        ...namedPaths(text, exists, { anyExtension: true, bare: true, barrels: true }),
      );
      read.push(`${spec.slice(SPEC_DIR.length)} (the paths it names; no Touches:)`);
    }
  }
  // A file is planned when an entry names it, a directory entry holds it,
  // or a pattern entry matches it. Any change under the specs directory is
  // the plan itself being edited -- a spec revised, archived or retired --
  // not work outside it.
  const planned = (f) =>
    f.startsWith(SPEC_DIR)
    || plan.some((p) =>
      p === f || (p.endsWith("/") && f.startsWith(p)) || (p.includes("*") && matchesPattern(f, p))
    );

  report = {
    base,
    adHoc: changed.filter((f) => added.has(f) && isAdHocPlan(f)),
    read,
    files: counted.length,
    generatedFiles: changed.length - counted.length,
    size,
    below,
    merges: sizes.length,
    outside: specs.size === 0 ? null : counted.filter((f) => !planned(f)),
  };
} catch (err) {
  console.error(`plan-scope: cannot answer -- ${err.message.split("\n")[0]}`);
  console.error(
    "  No report printed: a diff this could not read is not a diff with nothing outside the plan.",
  );
  process.exit(2);
}

const r = report;
console.log(`plan-scope: ${r.base}...HEAD`);
if (r.adHoc.length > 0) {
  console.log("\nAd hoc plan files outside barwise/docs/specs/ (no review, no Status):");
  for (const f of r.adHoc) console.log(`  ${f}`);
}
console.log(
  `\nSize: ${r.size} lines in ${r.files} files`
    + (r.generatedFiles > 0 ? ` (${r.generatedFiles} generated or recorded files left out)` : "")
    + `; larger than ${r.below} of the last ${r.merges} merged PRs on ${r.base}.`,
);
if (r.outside === null) {
  console.log(
    r.files === 0
      ? "\nNo spec named, and nothing outside generated files changed."
      : "\nNo plan found: no spec in the diff, and no spec file named in a commit message on this branch.",
  );
} else {
  console.log(`\nPlan read from: ${r.read.join(", ")}`);
  if (r.outside.length === 0) console.log("Every changed file is in the plan.");
  else {
    console.log(`Outside the plan (${r.outside.length} of ${r.files} files):`);
    for (const f of r.outside) console.log(`  ${f}`);
  }
}
