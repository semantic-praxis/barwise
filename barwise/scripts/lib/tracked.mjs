/**
 * The tracked-file listing, anchored to the repo root.
 *
 * This exists because `git ls-files` resolves its pathspec -- and, with
 * no pathspec, its whole listing -- RELATIVE TO THE PROCESS CWD, and the
 * gates that use it are invoked from at least three places: `npm run
 * check:*` (cwd `barwise/`), a hand-run `node barwise/scripts/...` (cwd
 * repo root), and CI (cwd `barwise/`). The failure mode is not an error.
 * It is a smaller list, silently, with the gate still printing OK:
 *
 *   check-no-nul   1426 files under `npm run`, 1483 from the repo root
 *                  -- 57 tracked files, every one of them outside
 *                  `barwise/`, never scanned. That is all of `.claude/`,
 *                  `.github/`, `CLAUDE.md` and `AGENTS.md`, by a gate
 *                  whose entire purpose is "no NUL byte anywhere".
 *   check-shell       6 scripts under `npm run`, 7 from the repo root
 *                  -- `.claude/hooks/session-start.sh` unlinted in CI
 *                  for as long as that gate had existed.
 *
 * Both were found by accident, months apart in intent and minutes apart
 * in fact, and neither could be found by reading the gate: the code looks
 * right, and the count is the only tell. So the listing lives in one
 * place that is correct by construction, and a gate that wants tracked
 * files calls this rather than spelling out `git ls-files` again.
 *
 * Paths come back RELATIVE TO THE REPO ROOT. Read them through
 * `resolve(REPO_ROOT, file)`, not against cwd -- that is the one thing a
 * caller still has to get right, and it fails loudly (ENOENT) rather
 * than quietly.
 */
import { execFileSync } from "node:child_process";

/** Absolute path of the repo root. Same answer from any cwd inside it. */
export const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/**
 * Every tracked path in the repo, root-relative, in git's order.
 *
 * `.beads/hooks/` is vendored by the beads tracker; callers that lint
 * rather than merely read should exclude it themselves, since "is this
 * ours to check" is a per-gate question.
 */
export function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}
