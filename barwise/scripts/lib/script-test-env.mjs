/**
 * The environment a script-test file runs in, built from this process's.
 *
 * One owner, so the two places that start a script-test file --
 * run-script-tests.mjs for the suite and test-adr-model.mjs for one file
 * after the build -- give it the same environment, and so a test can hold
 * this function to what it promises.
 *
 * A bare `node --test scripts/tests/<file>` does not come through here, and
 * reads the machine's git config like any other git command. Run a file
 * through `npm run test:scripts` to get the answer CI gets.
 */
import { envWithoutUserGitConfig } from "./git-env.mjs";

export function scriptTestEnv(base = process.env) {
  // Two pieces of inherited state are wrong for a child that IS a fresh
  // top-level run, and both were found by a run going red rather than by
  // reading the docs.
  //
  // `NODE_TEST_CONTEXT` is how `node --test` recognises it is already inside
  // a test run; with it set a child prints "run() is being called
  // recursively ... skipping running files" and no summary at all -- which
  // the runner would then correctly refuse, for a suite that is fine.
  //
  // A reporter inherited through `NODE_OPTIONS` changes the output format
  // out from under the runner's parser. That is not hypothetical: the summary
  // it reads is TAP's `# tests N`, and CI printed the spec reporter's
  // `i tests N` instead, because CI runs the Node that `.nvmrc` pins and the
  // default reporter is not the same across versions. Forcing the format
  // makes the count independent of which Node is running, which is the same
  // portability argument `.nvmrc` itself exists for.
  const { NODE_TEST_CONTEXT: _nested, ...env } = base;
  if (typeof env.NODE_OPTIONS === "string") {
    // Stripped rather than overridden: `--test-reporter` ACCUMULATES between
    // NODE_OPTIONS and argv, and node then refuses the run outright with
    // "must match the number of specified --test-reporter-destination".
    env.NODE_OPTIONS = env.NODE_OPTIONS
      .split(/\s+/)
      .filter((tok) => !tok.startsWith("--test-reporter"))
      .join(" ");
  }
  // The tests build throwaway git repositories and run gates that call git;
  // the developer's own git config must reach neither (barwise-j9q). Set
  // here, for the whole file, rather than in the tests' helpers: about
  // twenty files create repositories through a dozen helpers, and some of
  // the git runs happen inside the gate under test, which only an inherited
  // environment reaches.
  return envWithoutUserGitConfig(env);
}
