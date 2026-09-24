#!/usr/bin/env node
/**
 * Refuse an installed tree that does not satisfy the manifests.
 *
 * `npm ci` installs exactly what the lockfile says and does not check the
 * result against each workspace's declared ranges. Dependabot PR #542 set
 * `vitest` to `^5.0.1` in twelve packages but left `@vitest/coverage-v8`
 * at `^4.1.11`, which peers on vitest 4.1.11 exactly; npm settled the
 * conflict by keeping 4.1.11 in every package's own node_modules. The
 * lockfile installed cleanly, every test passed, and CI was green on the
 * vitest the PR was upgrading away from. No gate asked which version ran.
 *
 * `npm ls` already knows how to compare a declared range with what is on
 * disk -- it printed `invalid: vitest@4.1.11` twelve times against that
 * tree -- so detection is npm's. This wrapper exists for the gate
 * contract (docs/specs/gate-refusal-contract.spec.md): with no
 * node_modules, `npm ls` reports every dependency "missing" and exits 1,
 * which reads as a finding about the lockfile when it is really "nothing
 * was installed". That case, an absent npm, and output that cannot be
 * parsed all exit 2 instead.
 *
 * `--dir <path>` points the gate at another npm project; the tests use it
 * for fixtures. Without it the gate reads barwise/, anchored to the
 * repository root rather than the cwd.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function refuse(message) {
  process.stderr.write(`check-lockfile-agrees: ${message}\n  Could not answer; not a finding.\n`);
  process.exit(2);
}

const dirFlag = process.argv.indexOf("--dir");
let dir;
if (dirFlag !== -1) {
  if (!process.argv[dirFlag + 1]) refuse("--dir needs a path.");
  dir = resolve(process.argv[dirFlag + 1]);
} else {
  // Imported only on this path so a fixture run needs no git.
  const { REPO_ROOT } = await import("./lib/tracked.mjs");
  dir = join(REPO_ROOT, "barwise");
}

if (!existsSync(join(dir, "package.json"))) refuse(`no package.json in ${dir}.`);
if (!existsSync(join(dir, "node_modules"))) {
  refuse(`no node_modules in ${dir}; run \`npm ci\` first.`);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const r = spawnSync(npm, ["ls", "--all", "--json"], {
  cwd: dir,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (r.error) refuse(`could not run npm: ${r.error.message}`);

let tree;
try {
  tree = JSON.parse(r.stdout);
} catch {
  refuse(`\`npm ls\` exited ${r.status} with output that is not JSON.`);
}

const problems = Array.isArray(tree.problems) ? tree.problems : [];
if (problems.length > 0) {
  console.error("The installed tree does not satisfy the declared ranges:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nThe lockfile resolved a version some package.json does not accept, so\n"
      + "the code and tests ran against a different version than the manifest\n"
      + "claims. Usually a plugin that pins its host exactly was not bumped with\n"
      + "it (vitest and @vitest/*, for one). Fix the ranges and reinstall.",
  );
  process.exit(1);
}
if (r.status !== 0) refuse(`\`npm ls\` exited ${r.status} but reported no problems.`);

let count = 0;
const walk = (node) => {
  for (const child of Object.values(node.dependencies ?? {})) {
    count++;
    walk(child);
  }
};
walk(tree);
// A tree with no dependencies at all is not evidence that every range
// is satisfied; it is evidence that nothing was read.
if (count === 0) refuse(`\`npm ls\` in ${dir} listed no dependencies.`);

console.log(`check-lockfile-agrees: ${count} installed entries satisfy their declared ranges. OK`);
