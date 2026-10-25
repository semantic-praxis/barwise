#!/usr/bin/env node
/**
 * What a "new specs declare Touches:" rule would have flagged over merged
 * history (docs/specs/touches-required.spec.md, Evidence).
 *
 *   npm run measure:touches-required -- [--ref <rev>] [--since <date>] [--branches]
 *
 * Reads committed history only, so a rerun against the same `--ref`
 * (default origin/main) and `--since` (default 2026-07-01) prints the same
 * numbers. Each first-parent commit C of `--ref` is read as the pull
 * request it landed: head is C's second parent for a merge commit and C
 * itself otherwise (a squash merge or a direct push), and the range is
 * `merge-base(C^1, head)...head`, the three-dot diff check:plan-review reads.
 *
 * A spec is ADDED when the diff reports status A under --no-renames and
 * `inSpecCorpus` accepts its path. It is NEW when, besides, no file with
 * its name existed anywhere under barwise/docs/specs/ (corpus or archive/)
 * at the merge base: the spec's rule for "existing". It SATISFIES the
 * rule when its `Touches:` has an unmarked entry, or a `-` entry naming a
 * path tracked at the merge base; `+` entries alone do not, so a
 * placeholder such as `+none` cannot pass.
 *
 * `--branches` also lists unmerged remote branches that add a new spec
 * failing the rule today. That part reads live remote refs and is not
 * reproducible from `--ref`; the spec quotes it as a dated snapshot.
 *
 * Prints one JSON object. Exit 0 printed, 2 git or an argument failed.
 */
import { execFileSync } from "node:child_process";
import { opt } from "./lib/args.mjs";
import {
  CLAIMS_NOTHING_BUILT,
  header,
  inSpecCorpus,
  namedSpecs,
  touches,
} from "./lib/spec-reader.mjs";
import { REPO_ROOT } from "./lib/tracked.mjs";

function refuse(message) {
  console.error(`measure-touches-required: cannot answer -- ${message}`);
  process.exit(2);
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    return refuse(`\`git ${args.join(" ")}\` failed: ${err.message.split("\n")[0]}`);
  }
}

let ref, since;
try {
  ref = opt("--ref", "origin/main");
  since = opt("--since", "2026-07-01");
} catch (err) {
  refuse(err.message);
}
if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
  refuse("this is a shallow clone; merge bases cannot be read. Fix: git fetch --unshallow");
}

const SPECS = "barwise/docs/specs/";
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const lines = (s) => s.split("\n").filter(Boolean);
const holds = (rev, path) => git(["ls-tree", "-z", "--name-only", rev, "--", path]) !== "";
const outsideDocs = (p) => !p.startsWith("barwise/docs/") && !p.startsWith(".beads/");

/** The rule's verdict on a spec's text at `head`, with `mergeBase` for `-` entries. */
function verdict(text, mergeBase) {
  const entries = touches(text);
  if (entries === undefined) return "none";
  if (entries.length === 0) return "empty";
  const ok = entries.some((e) =>
    e.mark === "" || (e.mark === "-" && !e.path.includes("*") && holds(mergeBase, e.path))
  );
  return ok ? "satisfies" : "marked-only";
}

/** Status letters of `git diff --name-status -z`, renames included when asked. */
function nameStatus(from, to, renames, pathspec) {
  const f = git([
    "diff",
    "--name-status",
    "-z",
    renames ? "-M" : "--no-renames",
    from,
    to,
    "--",
    pathspec,
  ]).split("\u0000");
  if (f.at(-1) === "") f.pop();
  const out = [];
  for (let i = 0; i < f.length;) {
    if (/^[RC]/.test(f[i])) {
      out.push({ s: f[i][0], from: f[i + 1], path: f[i + 2] });
      i += 3;
    } else {
      out.push({ s: f[i][0], path: f[i + 1] });
      i += 2;
    }
  }
  return out;
}

const commits = lines(
  git(["log", "--first-parent", `--since=${since}`, "--format=%H%x09%s", ref]),
).map((l) => l.split("\t"));

// The first-parent commit that put `Touches:` into the spec template.
const templateCommits = lines(
  git([
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H",
    ref,
    "--",
    ".claude/skills/spec-writer/template.spec.md",
  ]),
);
const templateTouches = templateCommits.find((c) =>
  /^Touches:/m.test(git(["show", `${c}:.claude/skills/spec-writer/template.spec.md`]))
);
const afterTemplate = new Set(
  templateTouches ? lines(git(["rev-list", "--first-parent", `${templateTouches}..${ref}`])) : [],
);

const shape = { merge: 0, squash: 0, direct: 0 };
const prs = [];
const archive = { added: 0, moves: 0 };
let adrAdded = 0;
let corpusRenames = 0;
const reach = {
  population: 0,
  namedNew: 0,
  namedNewFailing: 0,
  onlyExisting: 0,
  onlyExistingNoTouches: 0,
};

for (const [sha, subject] of commits) {
  const parents = git(["rev-list", "--parents", "-n1", sha]).trim().split(" ");
  const isMerge = parents.length > 2;
  // GitHub's own spellings; a subject merely mentioning "#443" is neither.
  const pr = (isMerge ? /^Merge pull request #(\d+)/ : /\(#(\d+)\)$/).exec(subject)?.[1];
  shape[isMerge ? "merge" : pr ? "squash" : "direct"] += 1;
  const head = isMerge ? `${sha}^2` : sha;
  const mergeBase = git(["merge-base", `${sha}^1`, head]).trim();

  const docs = nameStatus(mergeBase, head, false, "barwise/docs/");
  const renamed = nameStatus(mergeBase, head, true, SPECS).filter((r) => r.s === "R");
  corpusRenames += renamed.filter((r) => inSpecCorpus(r.path)).length;
  for (const r of docs.filter((d) => d.s === "A")) {
    if (r.path.startsWith(`${SPECS}archive/`)) {
      archive.added += 1;
      if (renamed.some((x) => x.path === r.path)) archive.moves += 1;
    } else if (r.path.startsWith("barwise/docs/adr/")) {
      adrAdded += 1;
    }
  }

  const namesAtBase = new Set(
    lines(git(["ls-tree", "-r", "--name-only", mergeBase, "--", SPECS])).map(base),
  );
  const added = docs.filter((d) => d.s === "A" && inSpecCorpus(d.path)).map((d) => d.path);
  const specs = added.map((path) => ({
    path,
    isNew: !namesAtBase.has(base(path)),
    verdict: verdict(git(["show", `${head}:${path}`]), mergeBase),
  }));
  const changed = lines(git(["diff", "--name-only", "--no-renames", mergeBase, head]));
  if (specs.length > 0) {
    prs.push({
      sha: sha.slice(0, 8),
      pr,
      afterTemplate: afterTemplate.has(sha),
      outsideDocs: changed.some(outsideDocs),
      specs,
    });
  }

  // check:plan-review's population (plan-scope-check.spec.md WS6): a named
  // spec, new or claiming nothing built at the base, and a diff outside docs.
  if (!changed.some(outsideDocs)) continue;
  const corpusAt = (rev) =>
    lines(git(["ls-tree", "-r", "--name-only", rev, "--", SPECS])).filter(inSpecCorpus);
  const corpus = [...new Set([...corpusAt(head), ...corpusAt(mergeBase)])];
  const named = namedSpecs(changed, corpus, git(["log", "--format=%B", `${mergeBase}..${head}`]));
  const inScope = [];
  for (const s of named) {
    if (!holds(mergeBase, s)) {
      inScope.push({ isNew: true, text: git(["show", `${head}:${s}`]) });
      continue;
    }
    const atBase = git(["show", `${mergeBase}:${s}`]);
    const status = header(atBase, "Status");
    if (status !== undefined && !CLAIMS_NOTHING_BUILT.test(status)) continue;
    const text = holds(head, s) ? git(["show", `${head}:${s}`]) : atBase;
    inScope.push({ isNew: false, text, atBase });
  }
  if (inScope.length === 0) continue;
  reach.population += 1;
  const fresh = inScope.filter((x) => x.isNew);
  if (fresh.length > 0) {
    reach.namedNew += 1;
    if (fresh.some((x) => touches(x.text) === undefined)) reach.namedNewFailing += 1;
  } else {
    reach.onlyExisting += 1;
    if (inScope.every((x) => touches(x.text) === undefined && touches(x.atBase) === undefined)) {
      reach.onlyExistingNoTouches += 1;
    }
  }
}

const allSpecs = prs.flatMap((p) => p.specs);
const fails = (s) => s.isNew && s.verdict !== "satisfies";
const flagged = prs.filter((p) => p.specs.some(fails));

// The corpus at --ref: Touches: adoption, and Created: against the day git
// added each file.
const corpus = lines(git(["ls-tree", "-r", "--name-only", ref, "--", SPECS])).filter(inSpecCorpus);
const created = { sameDay: 0, before: [], after: [], missing: [] };
let declaring = 0;
for (const f of corpus) {
  const text = git(["show", `${ref}:${f}`]);
  if (touches(text) !== undefined) declaring += 1;
  const addedOn = lines(git(["log", "--diff-filter=A", "--follow", "--format=%cs", ref, "--", f]))
    .at(-1);
  const day = /^\d{4}-\d{2}-\d{2}/.exec(header(text, "Created") ?? "")?.[0];
  if (!day) created.missing.push(base(f));
  else if (day === addedOn) created.sameDay += 1;
  else {(day < addedOn ? created.before : created.after).push(
      `${base(f)} (${day}, added ${addedOn})`,
    );}
}

const report = {
  ref: git(["rev-parse", "--short=8", ref]).trim(),
  since,
  commits: { total: commits.length, ...shape },
  specAddingPrs: prs.length,
  specsAdded: allSpecs.length,
  specsAddedThatAreNew: allSpecs.filter((s) => s.isNew).length,
  verdicts: allSpecs.reduce((m, s) => ({ ...m, [s.verdict]: (m[s.verdict] ?? 0) + 1 }), {}),
  flaggedPrs: flagged.length,
  flaggedSpecs: allSpecs.filter(fails).length,
  flaggedPrsChangingOutsideDocs: flagged.filter((p) => p.outsideDocs).length,
  templateTouchesCommit: templateTouches?.slice(0, 8),
  prsAfterTemplate: prs.filter((p) => p.afterTemplate).map((p) => ({
    pr: p.pr,
    flagged: p.specs.some(fails),
  })),
  corpusRenames,
  archive,
  adrAdded,
  reach,
  corpus: { specs: corpus.length, declaringTouches: declaring, created },
  flagged: flagged.map((p) => `${p.sha} #${p.pr ?? "-"}`),
};

if (process.argv.includes("--branches")) {
  const refs = lines(git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]))
    .filter((r) => !["origin", "origin/HEAD", ref].includes(r));
  const open = refs.filter((r) => git(["rev-list", "--count", `${ref}..${r}`]).trim() !== "0");
  const failing = [];
  for (const r of open) {
    const mergeBase = git(["merge-base", ref, r]).trim();
    const names = new Set(
      lines(git(["ls-tree", "-r", "--name-only", mergeBase, "--", SPECS])).map(base),
    );
    for (const d of nameStatus(mergeBase, r, false, SPECS)) {
      if (d.s !== "A" || !inSpecCorpus(d.path) || names.has(base(d.path))) continue;
      const v = verdict(git(["show", `${r}:${d.path}`]), mergeBase);
      if (v !== "satisfies") failing.push(`${r} ${base(d.path)} (${v})`);
    }
  }
  report.branches = { remote: refs.length, unmerged: open.length, failing };
}

console.log(JSON.stringify(report, null, 2));
