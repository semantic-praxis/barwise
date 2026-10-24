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
 * from an older branch must not change how every later merge resolves: a
 * higher installed DRIVER_VERSION is kept. Equal versions are replaced, so
 * a fix that forgets the bump still installs.
 *
 * Exit 0 installed or kept, and also when there is no git repository (an
 * unpacked archive, an export): like husky beside it in `prepare`, it says
 * so and lets the install go on, because a driver is no reason to fail one.
 * Exit 1 when git is there and installing fails.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DRIVER_VERSION } from "./beads-merge-driver.mjs";

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

function installedVersion(dir) {
  try {
    const v = Number(readFileSync(join(dir, "version"), "utf8").trim());
    return Number.isInteger(v) ? v : 0;
  } catch {
    return 0;
  }
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
  const installed = installedVersion(dir);
  if (installed > DRIVER_VERSION) {
    console.error(
      `install-merge-driver: keeping the installed tracker merge driver (version ${installed}); `
        + `this checkout carries version ${DRIVER_VERSION}.`,
    );
  } else {
    for (const [to, from] of FILES) {
      mkdirSync(dirname(join(dir, to)), { recursive: true });
      copyFileSync(join(HERE, from), join(dir, to));
    }
    // Last, so an interrupted copy reads as version 0 and is replaced.
    writeFileSync(join(dir, "version"), `${DRIVER_VERSION}\n`);
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
  if (!existsSync(join(dir, "driver.sh"))) {
    console.error(`install-merge-driver: ${join(dir, "driver.sh")} is missing after install.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
