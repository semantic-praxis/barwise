/**
 * The release CLI bundle runs the gym (barwise-fbi) and the prompt
 * commands against the packaged eval suite (barwise-fke).
 *
 * Every other gym test runs on source through `runCli`, and the source
 * was never the problem: learn resolved its catalog from import.meta.url,
 * which esbuild empties in the CJS bundle, so `gym list` and `gym check`
 * failed in the shipped barwise-cli-2.0.0.cjs while every suite was green.
 * This builds the bundle with the release script and runs it as a user
 * does. A subprocess is the point here, so the package's rule that
 * command tests go through `runCli` (for coverage) does not apply; this
 * test adds no coverage and is not meant to.
 *
 * It builds rather than reusing dist/bundle/: `bundle` is not part of
 * `build`, so a reused bundle would be missing locally or stale
 * (barwise-lh9).
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundle = join(pkgRoot, "dist/bundle/index.cjs");
const reference = resolve(pkgRoot, "../learn/exercises/customer-order.reference.orm.yaml");
const payload = resolve(pkgRoot, "../promptlab/tests/fixtures/responses/order-management.json");

let buildLog = "";

function run(...args: string[]) {
  return spawnSync(process.execPath, [bundle, ...args], { encoding: "utf8" });
}

describe("CLI release bundle", () => {
  beforeAll(() => {
    // esbuild prints warnings to stderr at logLevel "warning", so the
    // warning assertion below reads both streams.
    const build = spawnSync(process.execPath, ["esbuild.mjs"], { cwd: pkgRoot, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    buildLog = build.stdout + build.stderr;
  }, 60_000);

  it("builds without an empty-import-meta warning", () => {
    // Both packaged-data readers resolved their files from import.meta.url,
    // which esbuild empties in CJS: learn's gym catalog (barwise-fbi) and
    // promptlab's eval suite (barwise-fke). Both are compiled in now.
    expect(buildLog).toContain("Bundle complete.");
    expect(buildLog).not.toContain("import.meta");
  });

  it("lists the packaged exercises and exits 0", () => {
    const r = run("gym", "list");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("customer-order");
  });

  it("checks a candidate against a packaged exercise and exits 0", () => {
    const r = run("gym", "check", "customer-order", reference, "--format", "json", "--no-state");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ exerciseId: "customer-order", passed: true });
  });

  it("scores an extraction against the packaged eval suite and exits 0", () => {
    const r = run("prompt", "score", "--case", "order-management", "--extraction", payload);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("order-management");
  });

  it("refuses prompt history with no --suite, naming the flag, not a Node path error", () => {
    const r = run("prompt", "history");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Pass --suite <manifest>");
    expect(r.stderr).not.toContain('path" argument');
  });
});
