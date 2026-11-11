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

/**
 * `base` with every git config file outside the repository switched off:
 * the system file, the global file, and the default ignore file
 * (barwise-j9q).
 *
 * For a git command that must give the same answer on every machine -- the
 * script tests' throwaway repositories, and the gates they run. A personal
 * `lib/` ignore rule (common in Python and macOS templates) made `git add`
 * refuse inside those repositories on the owner's Mac, and the pre-push
 * hook failed test:scripts with 29 failures that CI and the container never
 * saw.
 *
 * Three settings, because two are not enough. GIT_CONFIG_NOSYSTEM drops the
 * system file and GIT_CONFIG_GLOBAL=/dev/null the global one, but with no
 * `core.excludesFile` set git still reads its default ignore file,
 * $XDG_CONFIG_HOME/git/ignore (~/.config/git/ignore), and neither variable
 * switches that off (measured, git 2.43.0). An empty `core.excludesFile`
 * does. It goes in as a GIT_CONFIG_COUNT entry APPENDED after any the
 * environment already carries, which can hold settings worth keeping (see
 * REPO_LOCATION_VARS above); XDG_CONFIG_HOME was the alternative, rejected
 * because it moves every other tool's config too.
 *
 * The repository's own config (.git/config) is still read: it is part of
 * the repository under test, not of the machine.
 */
export function envWithoutUserGitConfig(base = process.env) {
  const env = { ...base, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const count = Number(base.GIT_CONFIG_COUNT ?? 0);
  env[`GIT_CONFIG_KEY_${count}`] = "core.excludesFile";
  env[`GIT_CONFIG_VALUE_${count}`] = "";
  env.GIT_CONFIG_COUNT = String(count + 1);
  return env;
}
