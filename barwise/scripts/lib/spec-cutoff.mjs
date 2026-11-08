/**
 * Which spec file names a cutoff commit already held: the one reading
 * behind every "new since the cutoff" rule over specs (check:spec-touches,
 * check:spec-form). A spec is new when its file name is absent from
 * barwise/docs/specs/ (corpus or archive/) in that commit's tree, by name
 * and not path, so a spec moved into or out of archive/ stays the existing
 * spec it was. Two gates answering "is this spec new" from two copies of
 * this would disagree on a rename sooner or later.
 *
 * Throws, never exits: each gate owns its refusal and the order it prints
 * findings in. A cutoff missing from the clone (usually a shallow one) and
 * git failing are both throws; neither is ever "no spec is new".
 */
import { SPECS_DIR } from "./spec-reader.mjs";

export const fileName = (p) => p.slice(p.lastIndexOf("/") + 1);
export const nulList = (out) => out.split("\u0000").filter(Boolean);

/**
 * `{ id, atCutoff, existing }`: the resolved commit, every path in its
 * tree, and the spec file names in it. `given` is a `--cutoff` override
 * (tests and replays), which changes only the wording of the refusal.
 */
export function specNamesAtCutoff(git, cutoff, given = null) {
  // undefined is "no such commit" (exit 1); git failing throws from
  // commit() with its own message, and gets no fetch advice: fetching
  // would not mend it.
  const id = git.commit(cutoff);
  if (id === undefined) {
    // A shallow clone can lack any commit, so it is named either way; a
    // `--cutoff` in a full clone is a bad revision, which no fetch mends.
    const shallow = git.run(["rev-parse", "--is-shallow-repository"]).trim() === "true";
    const what = given !== null
      ? `--cutoff ${given} names no single commit in this clone (unknown, or an ambiguous abbreviation).`
      : `the cutoff ${cutoff} is not in this clone, so which specs are new cannot be read.`;
    const fix = shallow
      ? "\n  This clone is shallow. Fix: git fetch --unshallow"
      : given === null
      ? "\n  Fix: git fetch origin main"
      : "";
    throw new Error(what + fix);
  }
  const atCutoff = nulList(git.run(["ls-tree", "-r", "-z", "--name-only", id]));
  if (atCutoff.length === 0) throw new Error(`git listed no files at the cutoff ${cutoff}`);
  const existing = new Set(atCutoff.filter((f) => f.startsWith(SPECS_DIR)).map(fileName));
  return { id, atCutoff, existing };
}
