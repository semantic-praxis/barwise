/**
 * Where the lane's inputs and outputs live. One owner for every path so
 * a customer package, a generated tier, a recording and a finding are
 * addressed the same way from run.mjs, gate.mjs and the tests.
 *
 * The lane drives the built bundles as a customer would (test-plan/
 * made the same call); it never imports a package. That is why the
 * bundle paths are here and no `@barwise/*` import is anywhere in trial/.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
 * Why each bundle is not the code on disk -- empty when every bundle is
 * current. Each entry is `{ bundle, why }`.
 *
 * A present bundle is not a current one. `npm run build` does not rebuild
 * the bundles, so after editing a package the lane grades the CLI as it
 * was at the last `bundle` run. Two checks, because each sees what the
 * other cannot:
 *
 * - **What the bundle was built from.** Each bundle script writes
 *   `inputs.json` beside the bundle: every file esbuild read, from its
 *   metafile. An input newer than the bundle, or gone, means the bundle
 *   is stale. This is the only check that sees a DELETED input exactly:
 *   the first version inferred deletions from directory mtimes and could
 *   not see a package's top-level entry disappear, because the package
 *   root's own mtime moves for runtime state too (PR #572 review). A
 *   bundle with no `inputs.json` predates the check and is refused.
 * - **Source not yet built.** esbuild reads the workspace packages'
 *   `dist/`, so an edit under `src/` that `npm run build` has not
 *   compiled is invisible to the first check. Every package input except
 *   the editor's is walked, and anything newer than the bundle marks it
 *   stale. A directory's own mtime counts, so a deleted source file shows.
 *
 * mtime is only a proxy for "built from this source", and on 2026-09-26
 * it was defeated: turbo cached dist/bundle/ as a `build` output and a
 * cache hit restored an old bundle with a FRESH mtime, so the lane
 * reported "0 stale" over 28 rows main had already fixed (barwise-lh9).
 * That cause is removed at the source (turbo.json excludes dist/bundle/
 * from `build` outputs); these checks cover forgetting to rebuild.
 *
 * `roots`, `stat` and `readInputs` are injectable so the rule is
 * testable without a build.
 */
export function staleBundles({
  bundles = [CLI_BUNDLE, MCP_BUNDLE],
  roots = bundledPackageDirs(),
  stat = statSync,
  readInputs = readBundleInputs,
} = {}) {
  const stale = [];
  const newest = newestSource(roots, stat);
  for (const bundle of bundles) {
    const built = stat(bundle).mtimeMs;
    const inputs = readInputs(bundle);
    if (!inputs) {
      stale.push({ bundle, why: "has no inputs.json, so what it was built from is unknown" });
      continue;
    }
    const gone = inputs.find((f) => !existsSync(f));
    if (gone) {
      stale.push({ bundle, why: `was built from ${gone}, which no longer exists` });
      continue;
    }
    const newer = inputs.find((f) => stat(f).mtimeMs > built)
      ?? (newest.mtimeMs > built ? newest.file : undefined);
    if (newer) stale.push({ bundle, why: `is older than ${newer}` });
  }
  return stale;
}

/** The input list a bundle script wrote beside the bundle, as absolute paths, or null. */
function readBundleInputs(bundle) {
  const manifest = join(dirname(bundle), "inputs.json");
  if (!existsSync(manifest)) return null;
  // The bundle is <package>/dist/bundle/index.cjs; its inputs are
  // relative to <package>, where the bundle script runs.
  const pkg = resolve(dirname(bundle), "..", "..");
  return JSON.parse(readFileSync(manifest, "utf8")).inputs.map((f) => resolve(pkg, f));
}

/** The newest file or directory under the package roots, root dirs themselves excepted. */
function newestSource(roots, stat) {
  let newest = { file: undefined, mtimeMs: -Infinity };
  const consider = (path) => {
    const { mtimeMs } = stat(path);
    if (mtimeMs > newest.mtimeMs) newest = { file: path, mtimeMs };
  };
  const walk = (dir, isRoot = false) => {
    // Not the package root's own mtime: tests create and remove ignored
    // entries there (coverage/, .barwise/), which would mark every bundle
    // stale. A deleted top-level input is what inputs.json is for.
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
  return newest;
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

/**
 * Every file `trial:generate` reads to produce a tier, keyed by its path
 * relative to barwise/, with a content hash: the generator modules and what
 * orchestrates them (`run.mjs`'s `generate()`, `paths.mjs`'s SCALE), and the
 * customer's customer.yaml, kernel, skins and transcripts. Personas are left
 * out: they are read when a run grades, not when a tier is generated.
 *
 * Recorded in the tier's manifest.json by `generate()` and compared by
 * `staleGenerated`. Content, not mtime, and the set, not only its members,
 * so a deleted skin or generator reads as a change too (PR #577 review of
 * the first, mtime-based version).
 */
export function generationInputs(customerDir) {
  const lib = join(TRIAL_DIR, "lib");
  const filesIn = (dir) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(dir, e.name))
      : [];
  const files = [
    ...filesIn(join(lib, "generators")),
    join(lib, "model.mjs"),
    join(lib, "prng.mjs"),
    join(lib, "run.mjs"),
    join(lib, "paths.mjs"),
    join(customerDir, "customer.yaml"),
    join(customerDir, "kernel.orm.yaml"),
    ...filesIn(join(customerDir, "skins")),
    ...filesIn(join(customerDir, "transcripts")),
  ].filter((f) => existsSync(f));
  const inputs = {};
  for (const f of files.sort()) {
    inputs[relative(BARWISE_DIR, f)] = createHash("sha256").update(readFileSync(f)).digest("hex")
      .slice(0, 16);
  }
  return inputs;
}

/**
 * Why a generated tier is not what `trial:generate` would write now, or
 * undefined when it is. `trial:offline` grades the files the last generate
 * wrote and never regenerates, so a generator fix was once "verified" by a
 * run over the previous output, and the rows it retires still failed with
 * nothing said.
 */
export function staleGenerated(customerDir, tier) {
  const manifest = JSON.parse(
    readFileSync(join(generatedDir(customerDir, tier), "manifest.json"), "utf8"),
  );
  const recorded = manifest.inputs;
  if (!recorded) return "records no generation inputs, so what it was generated from is unknown";
  const now = generationInputs(customerDir);
  for (const [file, hash] of Object.entries(now)) {
    if (!(file in recorded)) return `predates ${file}`;
    if (recorded[file] !== hash) return `was generated before ${file} changed`;
  }
  for (const file of Object.keys(recorded)) {
    if (!(file in now)) return `was generated from ${file}, which no longer exists`;
  }
  return undefined;
}
