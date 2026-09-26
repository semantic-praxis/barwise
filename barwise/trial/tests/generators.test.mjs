/**
 * The DDL generator's ground truth names only what the file declares.
 * A skin's extra statement the generator could not parse became
 * `extra_N` -- a name no file contains, so the import grader reported it
 * silently dropped whatever the importer did: C04's TRANSIENT table,
 * which barwise imported, and C06's two CREATE TYPE statements, which
 * are not tables at all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { generateDdl } from "../lib/generators/ddl.mjs";

const customers = join(dirname(fileURLToPath(import.meta.url)), "../customers");
const load = (p) => parse(readFileSync(join(customers, p), "utf8"));

const extras = (customer, skin) => {
  const { manifest } = generateDdl(
    load(`${customer}/kernel.orm.yaml`),
    load(`${customer}/skins/${skin}.yaml`),
  );
  return manifest.tables.filter((t) => t.kind === "extra");
};

test("a TRANSIENT table is named, not numbered", () => {
  const names = extras("C04-marketplace", "snowflake-core").map((t) => t.name);
  assert.ok(names.includes("ORDER_EVENTS_RAW"), names.join(", "));
  assert.ok(!names.some((n) => n.startsWith("extra_")), names.join(", "));
});

test("a statement that declares no table is not expected as an entity", () => {
  const types = extras("C06-logistics", "postgres-tms").filter((t) => t.name.startsWith("extra_"));
  assert.equal(types.length, 2);
  assert.ok(types.every((t) => t.importable === false));
});
