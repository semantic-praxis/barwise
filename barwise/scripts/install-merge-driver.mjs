#!/usr/bin/env node
/**
 * Install the tracker's merge driver into this clone
 * (docs/specs/beads-merge-driver.spec.md). Run by `npm run prepare`.
 *
 * `.gitattributes` routes `.beads/issues.jsonl` to a driver named `beads`;
 * until this script, nothing registered one, and git fell back to a line
 * merge without a word -- six hand-resolved conflicts on PR #704.
 *
 * The driver is COPIED into <git-common-dir>/barwise-merge/ rather than
 * registered at its work-tree path: git runs the command in the work tree
 * being merged into, and a branch cut before the driver landed has no such
 * file. The registered command resolves the directory through git at merge
 * time and quotes it, so a moved clone, a path with a space, and a linked
 * worktree all work.
 *
 * The copy is shared by every worktree of the clone, so a `prepare` run
 * from an older branch must not change how every later merge resolves. The
 * copy records the last commit that changed the driver's files, and is
 * kept only when a branch still carries that commit and this checkout's
 * driver does not descend from it -- a sibling with a driver change this
 * one lacks, or an older branch. Keyed on the driver's own last commit,
 * so a branch that never touched the driver agrees with main; and
 * reachability matters because an amend or a rebase leaves the recorded
 * commit on no branch at all, which must not pin the copy for good.
 * A hand-bumped version number did this first; it held only while every
 * change remembered the bump.
 *
 * Exit 0 installed or kept, and also when there is no git repository (an
 * unpacked archive, an export): like husky beside it in `prepare`, it says
 * so and lets the install go on, because a driver is no reason to fail one.
 * Exit 1 when git is there and installing fails.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DRIVER_NAME = "beads";
export const INSTALL_DIR = "barwise-merge";
export const DRIVER_COMMAND =
  `sh "$(git rev-parse --git-common-dir)/${INSTALL_DIR}/driver.sh" %O %A %B %P`;

const HERE = dirname(fileURLToPath(import.meta.url));

/** Installed path -> source path, relative to the install dir and scripts/. */
export const FILES = [
  ["driver.sh", "beads-merge-driver.sh"],
  ["beads-merge-driver.mjs", "beads-merge-driver.mjs"],
  ["lib/beads-merge.mjs", "lib/beads-merge.mjs"],
  ["lib/beads-jsonl.mjs", "lib/beads-jsonl.mjs"],
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readOr(path, fallback) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return fallback;
  }
}

/**
 * The last commit that changed the driver's files here, or HEAD when they
 * are not tracked by this repository (nothing finer to key on).
 */
function driverCommit() {
  const paths = FILES.map(([, from]) => join(HERE, from));
  try {
    const last = git(["log", "-1", "--format=%H", "--", ...paths]);
    if (last) return last;
  } catch {
    // Paths outside this repository: fall through to HEAD.
  }
  try {
    return git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    return ""; // no commit yet
  }
}

/**
 * Why the installed copy must stay, or undefined to replace it. A copy
 * with no record, from this same driver commit, from an ancestor of it,
 * from a commit this clone does not have, or from one no ref carries any
 * more (amended, rebased) is replaced.
 */
function keepReason(installed, current) {
  if (!installed || !current || installed === current) return undefined;
  const r = spawnSync("git", ["merge-base", "--is-ancestor", installed, current], {
    stdio: "ignore",
  });
  if (r.status !== 1) return undefined; // 0: an ancestor; otherwise not a commit here
  let carried = "";
  try {
    carried = git(["for-each-ref", "--count=1", "--format=%(refname)", "--contains", installed]);
  } catch {
    return undefined;
  }
  if (!carried) return undefined;
  return `installed from ${
    installed.slice(0, 8)
  }, carried by ${carried}, which this checkout's driver (${current.slice(0, 8)}) does not contain`;
}

function main() {
  let common;
  try {
    common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch {
    console.error("install-merge-driver: not inside a git repository; nothing installed.");
    return 0;
  }
  const dir = join(common, INSTALL_DIR);
  const current = driverCommit();
  const reason = keepReason(readOr(join(dir, "commit"), ""), current);
  if (reason) {
    console.error(
      `install-merge-driver: keeping the installed tracker merge driver (${reason}). `
        + "Run `npm run prepare` from a branch that contains it to replace it.",
    );
    // The config belongs to the files it runs: this checkout's command
    // could name a wrapper the kept copy does not have.
    return 0;
  }
  // The record goes first and comes back last, so an interrupted copy has
  // none and is replaced next time rather than kept under the old one.
  rmSync(join(dir, "commit"), { force: true });
  for (const [to, from] of FILES) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    copyFileSync(join(HERE, from), join(dir, to));
  }
  writeFileSync(join(dir, "commit"), `${current}\n`);
  git([
    "config",
    `merge.${DRIVER_NAME}.name`,
    "barwise tracker merge (scripts/beads-merge-driver.mjs)",
  ]);
  git(["config", `merge.${DRIVER_NAME}.driver`, DRIVER_COMMAND]);
  // A criss-cross merge builds a virtual base by merging the bases first.
  // Running this driver there would put conflict blocks into that base,
  // which the outer run then refuses as malformed; `binary` takes the
  // bases' common ancestor instead.
  git(["config", `merge.${DRIVER_NAME}.recursive`, "binary"]);
  if (!existsSync(join(dir, "driver.sh"))) {
    console.error(`install-merge-driver: ${join(dir, "driver.sh")} is missing after install.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
