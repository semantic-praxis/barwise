/**
 * `barwise export --surrogate-keys` (surrogate-key-export.spec.md):
 * honoured by a format whose descriptor declares it, refused for any
 * other, with the message MCP gives.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const ROOMS = resolve(
  import.meta.dirname,
  "../../../formats/tests/fixtures/externalIdentifier.orm.yaml",
);

describe("barwise export --surrogate-keys", () => {
  it("gives a table keyed on several columns a generated key", async () => {
    const r = await runCli([
      "export",
      ROOMS,
      "--format",
      "ddl",
      "--surrogate-keys",
      "--no-annotate",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("room_key VARCHAR(32) NOT NULL");
    expect(r.stdout).toContain("PRIMARY KEY (room_key)");
  });

  it("refuses it for a format that does not take it", async () => {
    const r = await runCli(["export", ROOMS, "--format", "avro", "--surrogate-keys"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("The avro format does not take surrogate keys; ddl and dbt do.");
  });
});
