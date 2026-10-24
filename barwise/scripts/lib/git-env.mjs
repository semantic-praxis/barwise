/**
 * The variables by which git tells a command which repository it is in. A
 * hook in a linked worktree runs with GIT_DIR, and from our hooks an absolute
 * GIT_WORK_TREE, naming the PUSHING checkout. Inherited by a git command
 * meant for another repository -- the fresh worktree ci:local checks out, the
 * temp clone tracker-conflicts scans -- every call there would read the
 * outer checkout's index and tree instead (barwise-hud).
 *
 * Not `git rev-parse --local-env-vars`: that list also holds
 * GIT_CONFIG_COUNT and GIT_CONFIG_PARAMETERS, which carry `-c` settings the
 * environment can depend on, such as a proxy's CA bundle, and say nothing
 * about location; and GIT_OBJECT_DIRECTORY and
 * GIT_ALTERNATE_OBJECT_DIRECTORIES, which name the object store every
 * worktree of the repository shares. Where they are set, the commit may live
 * only there, so they are kept.
 *
 * One list, shared by ci-local.mjs, tracker-conflicts.mjs and their tests,
 * so a variable added for one reaches all of them.
 */
export const REPO_LOCATION_VARS = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
]);

/** This process's environment, minus what would point git at this checkout. */
export function envWithoutRepoLocation(base = process.env) {
  const env = { ...base };
  for (const name of REPO_LOCATION_VARS) delete env[name];
  return env;
}
