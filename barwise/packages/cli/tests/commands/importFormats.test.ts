/**
 * Tests for the `import sql`, `import model`, `import norma`, and
 * `import dbt` subcommands -- all against the real, registered format
 * descriptors (no LLM, no LSP, no dbt subprocess required for these
 * connectors).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-import-formats-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CREATE_TABLE_SQL = `
CREATE TABLE customers (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NOT NULL,
  UNIQUE(email)
);
`;

const DDL = `
CREATE TABLE users (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);
`;

const NORMA_XML = `<?xml version="1.0" encoding="utf-8"?>
<ormRoot:ORM2 xmlns:ormRoot="http://schemas.neumont.edu/ORM/2006-01/ORMRoot" xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore">
  <orm:ORMModel id="model1" Name="Test">
    <orm:Objects>
      <orm:EntityType id="et1" Name="Person" _ReferenceMode="id" />
    </orm:Objects>
  </orm:ORMModel>
</ormRoot:ORM2>`;

const DBT_CUSTOMERS_YAML = `
models:
  - name: customers
    description: Customer overview.
    columns:
      - name: customer_id
        data_tests: [not_null, unique]
      - name: customer_name
`;

describe("barwise import sql", () => {
  it("imports a single SQL file (text path)", async () => {
    const file = join(dir, "schema.sql");
    writeFileSync(file, CREATE_TABLE_SQL);

    const result = await runCli(["import", "sql", file]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Importing ORM model from SQL");
    expect(result.stderr).toContain("Imported");
    expect(result.stdout).toContain("orm_version");
  });

  it("imports a directory of SQL files (parseAsync path) with --name and --dialect", async () => {
    writeFileSync(join(dir, "schema.sql"), CREATE_TABLE_SQL);

    const result = await runCli([
      "import",
      "sql",
      dir,
      "--name",
      "my-model",
      "--dialect",
      "postgres",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Imported");
  });

  it("reports warnings when no ORM-relevant patterns are found", async () => {
    const file = join(dir, "empty.sql");
    writeFileSync(file, "SELECT 1;\n");

    const result = await runCli(["import", "sql", file]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warning(s):");
  });

  it("uses the filename as the default model name when --name is omitted", async () => {
    const file = join(dir, "widgets.sql");
    writeFileSync(file, CREATE_TABLE_SQL);

    const result = await runCli(["import", "sql", file]);
    expect(result.exitCode).toBe(0);
  });

  it("errors when the source path cannot be accessed", async () => {
    const result = await runCli(["import", "sql", join(dir, "nope.sql")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot access");
  });
});

describe("barwise import model", () => {
  it("imports a text-based format (ddl)", async () => {
    const file = join(dir, "schema.ddl");
    writeFileSync(file, DDL);

    const result = await runCli(["import", "model", file, "--format", "ddl"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Importing ORM model from ddl");
  });

  it("errors on an unknown format", async () => {
    const file = join(dir, "schema.ddl");
    writeFileSync(file, DDL);

    const result = await runCli(["import", "model", file, "--format", "not-a-format"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown format "not-a-format"');
  });

  it("errors when the source file is empty", async () => {
    const file = join(dir, "empty.ddl");
    writeFileSync(file, "   \n");

    const result = await runCli(["import", "model", file, "--format", "ddl"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Source file is empty");
  });

  it("errors when the format does not support text input (directory-only format)", async () => {
    const file = join(dir, "irrelevant.txt");
    writeFileSync(file, "not empty");

    const result = await runCli(["import", "model", file, "--format", "dbt"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not support text input");
  });

  it("uses --name to override the default model name", async () => {
    const file = join(dir, "schema.ddl");
    writeFileSync(file, DDL);

    const result = await runCli(["import", "model", file, "--format", "ddl", "--name", "custom"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("barwise import norma", () => {
  it("imports a NORMA XML file", async () => {
    const file = join(dir, "model.orm");
    writeFileSync(file, NORMA_XML);

    const result = await runCli(["import", "norma", file]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Importing ORM model from NORMA XML");
  });

  it("errors when the source file is empty", async () => {
    const file = join(dir, "empty.orm");
    writeFileSync(file, "");

    const result = await runCli(["import", "norma", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Source file is empty");
  });

  it("uses --name to override the default model name", async () => {
    const file = join(dir, "model.orm");
    writeFileSync(file, NORMA_XML);

    const result = await runCli(["import", "norma", file, "--name", "custom"]);
    expect(result.exitCode).toBe(0);
  });

  it("surfaces a parse error for malformed NORMA XML", async () => {
    const file = join(dir, "bad.orm");
    writeFileSync(file, "<not-norma-xml/>");

    const result = await runCli(["import", "norma", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("barwise import dbt", () => {
  it("imports a dbt project directory", async () => {
    mkdirSync(join(dir, "models"), { recursive: true });
    writeFileSync(join(dir, "models", "customers.yml"), DBT_CUSTOMERS_YAML);

    const result = await runCli(["import", "dbt", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Importing ORM model from dbt project");
  });

  it("uses --name to override the default (directory-name) model name", async () => {
    mkdirSync(join(dir, "models"), { recursive: true });
    writeFileSync(join(dir, "models", "customers.yml"), DBT_CUSTOMERS_YAML);

    const result = await runCli(["import", "dbt", dir, "--name", "custom"]);
    expect(result.exitCode).toBe(0);
  });

  it("reports a warning when no schema YAML files are found", async () => {
    const result = await runCli(["import", "dbt", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warning(s):");
  });

  it("passes DBT_TARGET_TYPE and HOME through to dialect detection", async () => {
    const originalTargetType = process.env["DBT_TARGET_TYPE"];
    const originalAdapter = process.env["DBT_ADAPTER"];
    const originalHome = process.env["HOME"];
    process.env["DBT_TARGET_TYPE"] = "postgres";
    delete process.env["DBT_ADAPTER"];
    process.env["HOME"] = dir;
    try {
      mkdirSync(join(dir, "models"), { recursive: true });
      writeFileSync(join(dir, "models", "customers.yml"), DBT_CUSTOMERS_YAML);

      const result = await runCli(["import", "dbt", dir]);
      expect(result.exitCode).toBe(0);
    } finally {
      if (originalTargetType === undefined) delete process.env["DBT_TARGET_TYPE"];
      else process.env["DBT_TARGET_TYPE"] = originalTargetType;
      if (originalAdapter === undefined) delete process.env["DBT_ADAPTER"];
      else process.env["DBT_ADAPTER"] = originalAdapter;
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
    }
  });

  it("falls back to DBT_ADAPTER and USERPROFILE when the primary env vars are unset", async () => {
    const originalTargetType = process.env["DBT_TARGET_TYPE"];
    const originalAdapter = process.env["DBT_ADAPTER"];
    const originalHome = process.env["HOME"];
    const originalUserProfile = process.env["USERPROFILE"];
    delete process.env["DBT_TARGET_TYPE"];
    process.env["DBT_ADAPTER"] = "snowflake";
    delete process.env["HOME"];
    process.env["USERPROFILE"] = dir;
    try {
      mkdirSync(join(dir, "models"), { recursive: true });
      writeFileSync(join(dir, "models", "customers.yml"), DBT_CUSTOMERS_YAML);

      const result = await runCli(["import", "dbt", dir]);
      expect(result.exitCode).toBe(0);
    } finally {
      if (originalTargetType === undefined) delete process.env["DBT_TARGET_TYPE"];
      else process.env["DBT_TARGET_TYPE"] = originalTargetType;
      if (originalAdapter === undefined) delete process.env["DBT_ADAPTER"];
      else process.env["DBT_ADAPTER"] = originalAdapter;
      if (originalHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = originalHome;
      if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
      else process.env["USERPROFILE"] = originalUserProfile;
    }
  });
});
