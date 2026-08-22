/**
 * What built this run
 * (docs/specs/eval-run-resolution-and-provenance.spec.md, workstream 3).
 *
 * A history row records `artifactVersion` and `suiteVersion`, both
 * hand-maintained strings. The prompt hash closes that gap for the
 * prompt; this closes it for everything else, since the scorer, the
 * suite weights, the reference models, and `evaluateCandidate` all move
 * a score without touching a prompt.
 *
 * Two constraints shape the implementation, neither obvious from the
 * spec:
 *
 * 1. **No `import.meta`.** The CLI ships two ways -- a tsc build that
 *    reads its own package.json, and an esbuild CJS bundle where
 *    `import.meta` is empty (`cli.ts` already carries this rule for the
 *    version). So the version is threaded in from the entry point
 *    rather than read here, and the search root comes from
 *    `process.argv[1]`, which both builds set.
 * 2. **The repository has to be proven to be barwise.** Asking git
 *    about the current directory would answer about whatever repo the
 *    operator happened to be standing in -- their model repo, say --
 *    and record its commit as though it were barwise's. A globally
 *    installed CLI sitting in some project's `node_modules` has the
 *    same problem. Both produce a confidently wrong SHA, which is worse
 *    than none, so the repo is checked for barwise's own marker before
 *    its commit is believed.
 */

import type { BuildProvenance } from "@barwise/promptlab";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve what built this run. Never throws: an eval run costs money,
 * and a missing `git` binary must not be what loses it.
 *
 * @param version - The running barwise version, threaded from the entry
 *   point. All packages share one version, so the CLI's is barwise's.
 * @param fromDir - Where to start looking for the repository. Defaults
 *   to the directory of the running script.
 */
export function resolveProvenance(version: string, fromDir?: string): BuildProvenance {
  const start = fromDir ?? scriptDir();
  if (start === undefined) return { version };

  const root = barwiseRepoRoot(start);
  if (root === undefined) return { version };

  const commit = git(root, ["rev-parse", "HEAD"]);
  if (commit === undefined) return { version };

  // `--untracked-files=no` matters more than it looks. Bare
  // `--porcelain` lists untracked files as `??` entries, so a scratch
  // note or an editor swap file marked every run modified -- and worse,
  // `history.jsonl` is itself untracked, so the first recorded run
  // created the file that made every later run report dirty. The flag
  // exists to say the *tracked source* differed from the commit, which
  // is what decides whether that commit reproduces the run.
  //
  // Untracked files are not entirely irrelevant -- an unversioned
  // variant under `--artifacts` really would change what ran -- but
  // `promptHash` catches exactly that, by fingerprinting the prompt
  // actually sent rather than guessing from the working tree.
  const status = git(root, ["status", "--porcelain", "--untracked-files=no"]);
  return {
    version,
    commit,
    // An unreadable status is not evidence of a clean tree, so the
    // honest answer is that it was modified as far as we can tell.
    dirty: status === undefined ? true : status.length > 0,
  };
}

/** Format for display: `abc1234`, or `abc1234-dirty` when it matters. */
export function describeProvenance(build: BuildProvenance): string {
  if (build.commit === undefined) return build.version;
  return `${build.version} (${build.commit.slice(0, 7)}${build.dirty === true ? "-dirty" : ""})`;
}

function scriptDir(): string | undefined {
  const script = process.argv[1];
  return script === undefined || script.length === 0 ? undefined : dirname(script);
}

/**
 * The git root above `start`, but only when it is barwise's own.
 *
 * The marker is the monorepo's `barwise/package.json` naming itself.
 * If the layout ever moves, provenance degrades to version-only rather
 * than reporting someone else's commit -- the safe direction to fail.
 */
function barwiseRepoRoot(start: string): string | undefined {
  const root = git(start, ["rev-parse", "--show-toplevel"]);
  if (root === undefined) return undefined;

  const manifest = join(root, "barwise", "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; };
    return name === "barwise" ? root : undefined;
  } catch {
    return undefined;
  }
}

/** Run git, returning undefined for any failure rather than throwing. */
function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
