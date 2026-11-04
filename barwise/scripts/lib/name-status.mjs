/**
 * The output of `git diff --name-status -z --no-renames`, as
 * [{ letter, path }]. Three readers list a branch's changes this way
 * (pr-risk, plan-scope, check:plan-review), and they must agree on what
 * a PR changed, so the parse lives once. With renames off every record is
 * one status and one path; an odd field count is git printing something
 * this does not understand, and it throws rather than drop a path.
 */
export function parseNameStatus(out) {
  const fields = out.split("\u0000");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) {
    throw new Error(`git printed a status without a path (${fields.length} NUL-separated fields)`);
  }
  const records = [];
  for (let i = 0; i < fields.length; i += 2) {
    records.push({ letter: fields[i], path: fields[i + 1] });
  }
  return records;
}
