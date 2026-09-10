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

/**
 * Refuse: the third result a gate needs, beside pass and fail.
 *
 * `PASS` otherwise means both "the thing is fine" and "I could not see
 * the thing", and the reader cannot tell which. Exit 2 is the state
 * `mutate.mjs` established and `audit-gate.mjs` already used for an
 * unparseable report (docs/specs/gate-refusal-contract.spec.md).
 *
 * Exiting from a library is deliberate and is scoped by what this
 * library is: `scripts/lib/` is imported only by gate scripts, and a
 * gate that cannot resolve the repository root has nothing left to do
 * but say so. Returning an error would put the decision back on eight
 * call sites, which is the shape "define errors out of existence"
 * exists to refuse.
 */
function refuse(what, detail) {
  process.stderr.write(
    `${what}\n${detail ? `  ${detail}\n` : ""}`
      + "  Refusing rather than answering a question about the wrong tree.\n",
  );
  process.exit(2);
}

/**
 * Absolute path of the repo root. Same answer from any cwd inside it.
 *
 * Guarded because seven gates crashed with a Node stack trace when
 * `git` answered emptily -- a path derived from `""`, not a check that
 * noticed. They were accidentally loud rather than safe by
 * construction, and a derived path that happened to resolve would have
 * printed OK over zero files instead (barwise-905's shape, measured in
 * the 65-run reading in `gate-refusal-contract.spec.md`).
 *
 * Both halves matter. A `git` that FAILS throws out of `execFileSync`;
 * a `git` that SUCCEEDS and prints nothing returns `""`, which is the
 * quieter and worse case: `resolve("", file)` silently means cwd.
 */
export const REPO_ROOT = (() => {
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    refuse(
      "gate: `git rev-parse --show-toplevel` failed, so the repository root is unknown.",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
  }
  if (root === "") {
    refuse(
      "gate: `git rev-parse --show-toplevel` returned nothing, so the repository root is unknown.",
    );
  }
  return root;
})();

/**
 * Every tracked path in the repo, root-relative, in git's order.
 *
 * `.beads/hooks/` is vendored by the beads tracker; callers that lint
 * rather than merely read should exclude it themselves, since "is this
 * ours to check" is a per-gate question.
 */
export function trackedFiles() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

  // A repository with no tracked files is not a state this repository
  // reaches; an empty listing means git answered about something else.
  // Every caller filters this list and reports OK on finding no
  // offenders, so an empty listing is precisely the reading that looks
  // like success -- barwise-905, where the gate printed OK having
  // scanned nothing.
  if (files.length === 0) {
    refuse("gate: `git ls-files` listed no tracked files, so there is nothing to check.");
  }
  return files;
}
