/**
 * The CLI entry point installs the UUIDv7 generator
 * (docs/specs/uuid7-generator-factory.spec.md).
 *
 * The generator's behaviour is tested in core against a fake clock. What
 * core cannot see is the wiring: that `src/index.ts` installs it before
 * any command runs. `runCli` builds the program in process and never
 * executes that file, so this is the one CLI test that spawns the built
 * binary -- deliberately, since the entry point is the thing under test.
 * Without the install line, the import below still succeeds, with v4 ids.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const CLI_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const dir = mkdtempSync(join(tmpdir(), "cli-entry-ids-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("CLI entry point", () => {
  it("mints UUIDv7 ids in an import run through the built binary", () => {
    expect(existsSync(CLI_ENTRY), `built entry missing: ${CLI_ENTRY}`).toBe(true);
    const sql = join(dir, "t.sql");
    writeFileSync(sql, "CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT);\n");
    const yaml = execFileSync(
      process.execPath,
      [CLI_ENTRY, "import", "model", sql, "--format", "ddl"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const ids = [...yaml.matchAll(/^\s*(?:- )?id: (\S+)$/gm)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(V7_SHAPE);
  });
});
