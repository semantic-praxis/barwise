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

test("a combination the kernel says is unique is the table's UNIQUE clause", () => {
  // barwise-1077's acceptance checks graded artifacts that never stated
  // the combination, so no importer could have passed them.
  const doc = load("C09-pharma/kernel.orm.yaml");
  const skin = load("C09-pharma/skins/sdtm-ansi.yaml");
  const { text } = generateDdl(doc, skin);
  assert.match(text, /UNIQUE \("STUDY_ID", "SITE_ID", "SUBJECT_NUMBER"\)/);
  assert.match(text, /UNIQUE \("SUBJECT_ID", "VISIT_NUMBER"\)/);
  // A skin whose schemas leave it to the application says so.
  const none = generateDdl(doc, {
    ...skin,
    idioms: { ...skin.idioms, no_unique_constraints: true },
  });
  assert.doesNotMatch(none.text, /^\s+UNIQUE \(/m);
});

test("a table for a fact type of three or more roles is keyed on its uniqueness", () => {
  // Keyed on every role, it allowed two vehicles for one shipment leg, and
  // the persona check for that rule graded an artifact that never said so.
  const { text } = generateDdl(
    load("C06-logistics/kernel.orm.yaml"),
    load("C06-logistics/skins/postgres-tms.yaml"),
  );
  const table = /CREATE TABLE[^;]*shipment_travels_leg_on_vehicle[^;]*/i.exec(text)?.[0] ?? "";
  assert.match(table, /PRIMARY KEY \(shipment_id, leg_id\)/);
});
