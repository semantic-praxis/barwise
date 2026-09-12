/**
 * Where the lane's inputs and outputs live. One owner for every path so
 * a customer package, a generated tier, a recording and a finding are
 * addressed the same way from run.mjs, gate.mjs and the tests.
 *
 * The lane drives the built bundles as a customer would (test-plan/
 * made the same call); it never imports a package. That is why the
 * bundle paths are here and no `@barwise/*` import is anywhere in trial/.
 */
import { existsSync, readdirSync } from "node:fs";
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
