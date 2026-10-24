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
 * Every run installs this checkout's driver; the last `prepare` wins. The
 * copy is shared by every worktree, so a `prepare` on an older branch puts
 * that branch's rules in place until the next one on a newer branch --
 * older rules, still a working driver. Three designs tried to keep the
 * newer copy instead (a hand-bumped version, the installing commit, the
 * driver's own last commit), and review found each one could pin a stale
 * or damaged copy that `prepare` then refused to repair. A copy that is
 * always replaced cannot get stuck.
 *
 * Exit 0 installed, and also when there is nothing to install into: no git
 * repository (an unpacked archive), or a cwd that is not the top of the
 * work tree (barwise unpacked inside another project's checkout, whose
 * repository is not ours to configure). Like husky beside it in `prepare`,
 * it says so and lets the install go on. Exit 1 when installing fails.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
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

function main() {
  let common;
  let top;
  try {
    common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    top = git(["rev-parse", "--show-toplevel"]);
  } catch {
    console.error("install-merge-driver: not inside a git repository; nothing installed.");
    return 0;
  }
  if (realpathSync(top) !== realpathSync(process.cwd())) {
    console.error(
      `install-merge-driver: ${process.cwd()} is not the top of its work tree (${top}); `
        + "nothing installed. Run it through `npm run prepare`.",
    );
    return 0;
  }
  // Built beside the live copy and swapped in, so a merge never runs a
  // half-copied driver and no file from an earlier layout survives. The old
  // copy is moved aside, not deleted, until the new one is in place: the
  // only moment with no driver is between two renames, and a failed swap
  // puts the old copy back.
  const dir = join(common, INSTALL_DIR);
  const next = mkdtempSync(join(common, `${INSTALL_DIR}.next-`));
  const old = `${dir}.old-${process.pid}`;
  try {
    for (const [to, from] of FILES) {
      mkdirSync(dirname(join(next, to)), { recursive: true });
      copyFileSync(join(HERE, from), join(next, to));
    }
    if (existsSync(dir)) renameSync(dir, old);
    try {
      renameSync(next, dir);
    } catch (err) {
      // A concurrent prepare's copy landed first: it is a whole copy too.
      if (!existsSync(join(dir, "driver.sh"))) {
        if (existsSync(old) && !existsSync(dir)) renameSync(old, dir);
        console.error(`install-merge-driver: could not install into ${dir}: ${err.message}`);
        return 1;
      }
    }
  } finally {
    rmSync(next, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
  }
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
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
