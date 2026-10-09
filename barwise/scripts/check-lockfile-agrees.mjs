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
 * `npm ls` reads the installed tree, which stands in for the lockfile only
 * when it was installed from that lockfile. CI runs `npm ci` first; a local
 * tree that predates a merge of main does not, and `npm ls` then either
 * blames the ranges for an old version or passes a tree the lockfile does
 * not describe (barwise-2d4). So the installed versions are compared with
 * the lockfile first, and a difference is a refusal naming `npm ci`
 * (docs/specs/lockfile-gate-stale-install.spec.md).
 *
 * `--dir <path>` points the gate at another npm project; the tests use it
 * for fixtures. Without it the gate reads barwise/, anchored to the
 * repository root rather than the cwd.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
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

// Each installed package against the lockfile entry at its path. Entries
// outside node_modules are the root and the workspaces: their manifests are
// source, so a version bump not yet followed by `npm install` is not a stale
// install. Optional entries are absent by design (other platforms' builds;
// 131 of them, measured 2026-10-08), so only a required one counts as
// missing. A `link` entry is a workspace symlink, and a symlink the lockfile
// does not mark as one is a local checkout put there on purpose
// (`npm link`), which `npm ci` would undo.
const lockPath = join(dir, "package-lock.json");
if (existsSync(lockPath)) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    refuse(`${lockPath} is not JSON.`);
  }
  // Without a v2/v3 `packages` map there is nothing to compare, and
  // falling through to `npm ls` would pass a tree never checked against
  // the lockfile -- the false green this comparison exists to remove.
  if (lock === null || typeof lock.packages !== "object" || lock.packages === null) {
    refuse(
      `${lockPath} has no packages map (lockfileVersion 2 or later); run \`npm install\` with npm 7 or later.`,
    );
  }
  const stale = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes("node_modules/") || entry.link) continue;
    const manifest = join(dir, path, "package.json");
    if (!existsSync(manifest)) {
      if (!entry.optional && !entry.devOptional) {
        stale.push(`${path}: lockfile ${entry.version}, not installed`);
      }
      continue;
    }
    if (lstatSync(join(dir, path)).isSymbolicLink()) continue;
    let installed;
    try {
      installed = JSON.parse(readFileSync(manifest, "utf8")).version;
    } catch {
      refuse(`${manifest} is not JSON.`);
    }
    if (installed !== entry.version) {
      stale.push(`${path}: lockfile ${entry.version}, installed ${installed}`);
    }
  }
  // The other direction: a package installed where the lockfile has no
  // entry. `npm ls` judges extraneous packages by the manifests, not the
  // lockfile, so a declared package installed against a lockfile that lost
  // its entry passes `npm ls` (Copilot, PR #627). Walks the root's and each
  // workspace's node_modules, scoped and nested.
  const visit = (pkgDir, key) => {
    if (lstatSync(pkgDir).isSymbolicLink()) return;
    if (!(key in lock.packages)) {
      let version = "unknown version";
      try {
        version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
      } catch {
        // A directory with no readable manifest is still not the lockfile's.
      }
      stale.push(`${key}: installed ${version}, not in lockfile`);
    }
    walk(join(pkgDir, "node_modules"), `${key}/node_modules/`);
  };
  const walk = (nodeModules, prefix) => {
    if (!existsSync(nodeModules)) return;
    for (const name of readdirSync(nodeModules)) {
      if (name.startsWith(".")) continue;
      if (!name.startsWith("@")) {
        visit(join(nodeModules, name), prefix + name);
        continue;
      }
      for (const scoped of readdirSync(join(nodeModules, name))) {
        visit(join(nodeModules, name, scoped), `${prefix}${name}/${scoped}`);
      }
    }
  };
  walk(join(dir, "node_modules"), "node_modules/");
  for (const path of Object.keys(lock.packages)) {
    if (path !== "" && !path.includes("node_modules/")) {
      walk(join(dir, path, "node_modules"), `${path}/node_modules/`);
    }
  }

  if (stale.length > 0) {
    const shown = stale.slice(0, 10).map((s) => `  ${s}`).join("\n");
    const more = stale.length > 10 ? `\n  ... and ${stale.length - 10} more` : "";
    refuse(
      `node_modules does not match package-lock.json (${stale.length} entries):\n${shown}${more}\n`
        + "  node_modules was not installed from this lockfile, so the ranges cannot\n"
        + "  be checked against it. Run `npm ci` in " + dir + ", with dev and peer\n"
        + "  dependencies included as CI installs them, then rerun.",
    );
  }
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
