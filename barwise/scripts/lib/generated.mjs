/**
 * Which paths are generated or recorded: the `linguist-generated` mark in
 * the root `.gitattributes`, read through `git check-attr`, so the answer
 * is git's own and the same one GitHub's diff view gives
 * (docs/specs/plan-scope-check.spec.md, Open decision 2). One reader for
 * every script that asks; a second copy of the list would be the
 * must-agree copy root CLAUDE.md forbids.
 */
import { execFileSync } from "node:child_process";

/**
 * The subset of `paths` (repo-root-relative) git marks generated, as a Set.
 * Throws when git cannot answer: a caller must refuse (exit 2), never read
 * "nothing is generated" from a failure.
 */
export function generatedPaths(paths, cwd) {
  if (paths.length === 0) return new Set();
  // -z on both sides: a path with a newline or quote survives intact.
  const out = execFileSync("git", ["check-attr", "-z", "--stdin", "linguist-generated"], {
    cwd,
    input: paths.join("\0") + "\0",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // Records are path NUL attribute NUL value NUL.
  const fields = out.split("\0");
  const marked = new Set();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] === "true" || fields[i + 2] === "set") marked.add(fields[i]);
  }
  return marked;
}
