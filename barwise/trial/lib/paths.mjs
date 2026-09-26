/**
 * Where the lane's inputs and outputs live. One owner for every path so
 * a customer package, a generated tier, a recording and a finding are
 * addressed the same way from run.mjs, gate.mjs and the tests.
 *
 * The lane drives the built bundles as a customer would (test-plan/
 * made the same call); it never imports a package. That is why the
 * bundle paths are here and no `@barwise/*` import is anywhere in trial/.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TRIAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BARWISE_DIR = resolve(TRIAL_DIR, "..");
export const REPO_ROOT = resolve(BARWISE_DIR, "..");
export const CUSTOMERS_DIR = join(TRIAL_DIR, "customers");
export const LOSS_SETS_DIR = join(TRIAL_DIR, "loss-sets");
export const FINDINGS_DIR = join(TRIAL_DIR, "findings");
export const BASELINE_PATH = join(BARWISE_DIR, "trial-baseline.json");
export const CLI_BUNDLE = join(BARWISE_DIR, "packages/cli/dist/bundle/index.cjs");
export const MCP_BUNDLE = join(BARWISE_DIR, "packages/mcp/dist/bundle/index.cjs");

/**
 * The tiers, and how far each amplifies a kernel. One owner: run.mjs
 * generates against these and steps.mjs reports against them, and a
 * second copy would be the must-agree duplication CLAUDE.md forbids.
 * A customer may override per artifact (`tiers`) or for the whole model
 * (`scale`) in its customer.yaml.
 */
export const TIERS = ["small", "medium", "enterprise"];
export const SCALE = { small: 1, medium: 10, enterprise: 30 };

/** Generated artifacts are derived, never committed (see .gitignore). */
export function generatedDir(customerDir, tier) {
  return join(customerDir, "generated", tier);
}

export function resultsPath(tier) {
  return join(TRIAL_DIR, "results", `${tier}.json`);
}

/** Customer directories, sorted, optionally filtered by id or slug. */
export function listCustomerDirs(filter) {
  if (!existsSync(CUSTOMERS_DIR)) return [];
  return readdirSync(CUSTOMERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^C\d\d-/.test(d.name))
    .map((d) => join(CUSTOMERS_DIR, d.name))
    .filter((dir) => {
      if (!filter) return true;
      const name = dir.slice(dir.lastIndexOf("/") + 1);
      return name === filter || name.startsWith(`${filter}-`) || name.endsWith(`-${filter}`);
    })
    .sort();
}

export function bundlesPresent() {
  return existsSync(CLI_BUNDLE) && existsSync(MCP_BUNDLE);
}

/**
 * The newest package source file that is newer than a bundle, per
 * bundle -- empty when every bundle is current.
 *
 * A present bundle is not a current one. `npm run build` does not rebuild
 * the bundles, so after editing a package the lane grades the CLI as it
 * was at the last `bundle` run. A bundle is built from every package
 * except the editor's, so any newer file under a package's src/ means
 * the bundle may not contain it.
 *
 * mtime is only a proxy for "built from this source", and on 2026-09-26
 * it was defeated: turbo cached dist/bundle/ as a `build` output and a
 * cache hit restored an old bundle with a FRESH mtime, so the lane
 * reported "0 stale" over 28 rows main had already fixed (barwise-lh9).
 * That cause is removed at the source (turbo.json excludes dist/bundle/
 * from `build` outputs); this check covers the remaining one, forgetting
 * to rebuild.
 *
 * `roots` and `stat` are injectable so the rule is testable without a
 * build.
 */
export function staleBundles({
  bundles = [CLI_BUNDLE, MCP_BUNDLE],
  roots = bundledPackageDirs(),
  stat = statSync,
} = {}) {
  let newest = { file: undefined, mtimeMs: -Infinity };
  const consider = (path) => {
    const { mtimeMs } = stat(path);
    if (mtimeMs > newest.mtimeMs) newest = { file: path, mtimeMs };
  };
  const walk = (dir, isRoot = false) => {
    // A directory's own mtime moves when an entry is added, renamed or
    // DELETED, which no remaining file's mtime shows: a bundle still
    // holding a deleted module would otherwise read as current. Not the
    // package root's, though: tests create and remove ignored entries
    // there (coverage/, .barwise/), which would mark every bundle stale.
    if (!isRoot) consider(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!NOT_BUNDLE_INPUTS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(join(dir, entry.name));
        }
      } else consider(join(dir, entry.name));
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root, true);
  return bundles
    .filter((b) => stat(b).mtimeMs < newest.mtimeMs)
    .map((bundle) => ({ bundle, newerSource: newest.file }));
}

/**
 * Directories inside a package that never feed a bundle. Everything else
 * does, not only src/: the MCP bundle embeds core's schemas/ and the CLI
 * bundle script reads package.json for its version (PR #572 review).
 * Hidden directories are skipped too: they hold runtime state such as
 * packages/mcp/.barwise, which tests write and git ignores.
 */
const NOT_BUNDLE_INPUTS = new Set(["node_modules", "dist", "tests", "coverage"]);

function bundledPackageDirs() {
  const packagesDir = join(BARWISE_DIR, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "vscode")
    .map((d) => join(packagesDir, d.name));
}
