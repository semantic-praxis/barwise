/**
 * barwise merge (docs/specs/cli-surface-parity.spec.md, workstream 1).
 *
 * Pure core, so this covers the whole command with no provider and no
 * key. The tests that matter most are the two about not writing: a
 * merge command's real risk is what it does to files, not what it
 * prints.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const base = join(fixtures, "simple.orm.yaml");
const incoming = join(fixtures, "simple-modified.orm.yaml");

describe("barwise merge", () => {
  it("writes the merged model to stdout, carrying the added type", async () => {
    const result = await runCli(["merge", base, incoming]);
    expect(result.exitCode).toBe(0);
    // simple-modified adds an Email value type; the merge must take it.
    expect(result.stdout).toContain("Email");
    expect(result.stdout).toContain("orm_version");
  });

  it("leaves both inputs untouched", async () => {
    // The destructive default is the risk this command carries, so the
    // absence of writes is asserted directly rather than assumed. The
    // MCP tool writes back to its base file; this deliberately does not.
    const before = [readFileSync(base, "utf8"), readFileSync(incoming, "utf8")];
    await runCli(["merge", base, incoming]);
    expect([readFileSync(base, "utf8"), readFileSync(incoming, "utf8")]).toEqual(before);
  });

  it("writes to --output when asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-merge-"));
    const out = join(dir, "merged.orm.yaml");
    const result = await runCli(["merge", base, incoming, "--output", out]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("Email");
    // Output went to the file, not also to stdout.
    expect(result.stdout).toBe("");
  });

  it("reports no changes when a model is merged with itself", async () => {
    const result = await runCli(["merge", base, base]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No changes");
  });

  it("emits a machine-readable result under --format json", async () => {
    const result = await runCli(["merge", base, incoming, "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hasChanges).toBe(true);
    expect(parsed.valid).toBe(true);
    expect(parsed.yaml).toContain("Email");
  });

  it("exits non-zero and writes nothing when the base file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-merge-"));
    const out = join(dir, "merged.orm.yaml");
    const result = await runCli([
      "merge",
      join(dir, "nope.orm.yaml"),
      incoming,
      "--output",
      out,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
    // A failed merge must not leave a partial file behind.
    expect(existsSync(out)).toBe(false);
  });

  it("accepts an incoming fragment that references types it does not redefine", async () => {
    // The lenient-load allowance: an incoming model may name a base
    // type as a role player without carrying its definition. Without
    // it, the deserializer rejects the fragment before the merge runs.
    const dir = mkdtempSync(join(tmpdir(), "barwise-merge-"));
    const copy = join(dir, "base.orm.yaml");
    copyFileSync(base, copy);
    const result = await runCli(["merge", copy, incoming]);
    expect(result.exitCode).toBe(0);
  });
});
