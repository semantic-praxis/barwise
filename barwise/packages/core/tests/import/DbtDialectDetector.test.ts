/**
 * Tests for the dbt dialect detector.
 *
 * The detector is deterministic: dialect overrides and the
 * environment-derived target type / home directory are passed in as
 * explicit options, never read from process.env inside core.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDbtDialect } from "../../src/import/DbtDialectDetector.js";

let testDir: string;

function createTestDir(): string {
  const dir = join(tmpdir(), `barwise-dialect-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectDbtDialect", () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns explicit dialect when provided", () => {
    expect(detectDbtDialect(testDir, { dialect: "snowflake" })).toBe("snowflake");
  });

  it("returns explicit dialect over all other detection methods", () => {
    // Write a profiles.yml that says postgres
    writeFileSync(
      join(testDir, "profiles.yml"),
      "default:\n  target: dev\n  outputs:\n    dev:\n      type: postgres\n",
    );
    writeFileSync(
      join(testDir, "dbt_project.yml"),
      "name: test\nprofile: default\n",
    );

    // Explicit overrides profiles
    expect(detectDbtDialect(testDir, { dialect: "bigquery" })).toBe("bigquery");
  });

  it("detects dialect from the caller-supplied target type", () => {
    // Mixed case + whitespace is normalized.
    expect(detectDbtDialect(testDir, { targetType: " BigQuery " })).toBe("bigquery");
  });

  it("prefers an explicit dialect over the target type", () => {
    expect(detectDbtDialect(testDir, { dialect: "postgres", targetType: "snowflake" }))
      .toBe("postgres");
  });

  it("ignores an unknown target type", () => {
    expect(detectDbtDialect(testDir, { targetType: "oracle" })).toBe("ansi");
  });

  it("detects dialect from profiles.yml in project directory", () => {
    writeFileSync(
      join(testDir, "profiles.yml"),
      "default:\n  target: dev\n  outputs:\n    dev:\n      type: snowflake\n",
    );
    writeFileSync(
      join(testDir, "dbt_project.yml"),
      "name: test\nprofile: default\n",
    );

    expect(detectDbtDialect(testDir)).toBe("snowflake");
  });

  it("looks up profiles.yml under the caller-supplied home directory", () => {
    const homeDir = createTestDir();
    try {
      mkdirSync(join(homeDir, ".dbt"), { recursive: true });
      writeFileSync(
        join(homeDir, ".dbt", "profiles.yml"),
        "default:\n  target: dev\n  outputs:\n    dev:\n      type: redshift\n",
      );
      writeFileSync(
        join(testDir, "dbt_project.yml"),
        "name: test\nprofile: default\n",
      );

      expect(detectDbtDialect(testDir, { homeDir })).toBe("redshift");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("detects dialect from requirements.txt", () => {
    writeFileSync(join(testDir, "requirements.txt"), "dbt-bigquery==1.7.0\n");

    expect(detectDbtDialect(testDir)).toBe("bigquery");
  });

  it("falls back to ansi when nothing is detected", () => {
    expect(detectDbtDialect(testDir)).toBe("ansi");
  });

  it("handles missing dbt_project.yml gracefully", () => {
    // No files at all
    expect(detectDbtDialect(testDir)).toBe("ansi");
  });

  it("does not read process.env (determinism)", () => {
    const original = process.env["DBT_TARGET_TYPE"];
    process.env["DBT_TARGET_TYPE"] = "snowflake";
    try {
      // The env var must be ignored: the caller passes target type
      // explicitly, so with no option it falls through to ansi.
      expect(detectDbtDialect(testDir)).toBe("ansi");
    } finally {
      if (original === undefined) delete process.env["DBT_TARGET_TYPE"];
      else process.env["DBT_TARGET_TYPE"] = original;
    }
  });
});
