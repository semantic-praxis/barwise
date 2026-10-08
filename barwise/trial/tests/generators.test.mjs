/**
 * The DDL generator's ground truth names only what the file declares.
 * A skin's extra statement the generator could not parse became
 * `extra_N` -- a name no file contains, so the import grader reported it
 * silently dropped whatever the importer did: C04's TRANSIENT table,
 * which barwise imported, and C06's two CREATE TYPE statements, which
 * are not tables at all.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { generateDbt } from "../lib/generators/dbt.mjs";
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

test("no UNIQUE where the dialect has none or the rule is deontic", () => {
  // BigQuery has no UNIQUE constraint; C07's subscriber combination would
  // be an invalid clause there.
  const bq = generateDdl(
    load("C07-telecom/kernel.orm.yaml"),
    load("C07-telecom/skins/bigquery-dwh.yaml"),
  );
  assert.doesNotMatch(bq.text, /^\s+UNIQUE \(/m);
  // C12's Recipient-and-Program uniqueness is an obligation, not a rule
  // the database may enforce; its alethic combinations still are.
  const { text } = generateDdl(
    load("C12-benefits/kernel.orm.yaml"),
    load("C12-benefits/skins/postgres-modern.yaml"),
  );
  assert.doesNotMatch(text, /UNIQUE \(rcpt_id, prgm_id\)/);
  assert.match(text, /UNIQUE \(case_nbr, ofc_id\)/);
});

/**
 * A kernel small enough that each test shows one rule: Policy and Term,
 * PolicyPeriod objectifying "Policy is in force for Term" with its own
 * identifier, an Appeal that references a period, a period that
 * supersedes another, and a Leg with two Ports (barwise-rlv).
 */
function objectificationKernel() {
  const ot = (id, name, kind = "entity", extra = {}) => ({ id, name, kind, ...extra });
  const role = (id, player, role_name) => ({ id, player, role_name });
  const binary = (id, name, [a, pa, na], [b, pb, nb], unique, extra = []) => ({
    id,
    name,
    roles: [role(a, pa, na), role(b, pb, nb)],
    constraints: [{ type: "internal_uniqueness", roles: unique }, ...extra],
  });
  return {
    model: {
      object_types: [
        ot("policy", "Policy", "entity", { reference_mode: "policy_number" }),
        ot("policy-number", "PolicyNumber", "value"),
        ot("term", "Term", "entity", { reference_mode: "term_number" }),
        ot("term-number", "TermNumber", "value"),
        ot("period", "PolicyPeriod", "entity", { reference_mode: "policy_period_id" }),
        ot("period-id", "PolicyPeriodId", "value"),
        ot("appeal", "Appeal", "entity", { reference_mode: "appeal_number" }),
        ot("appeal-number", "AppealNumber", "value"),
        ot("leg", "Leg", "entity", { reference_mode: "leg_id" }),
        ot("leg-id", "LegId", "value"),
        ot("port", "Port", "entity", { reference_mode: "port_code" }),
        ot("port-code", "PortCode", "value"),
      ],
      fact_types: [
        binary("ft-pn", "Policy has PolicyNumber", ["r1", "policy", "has"], [
          "r2",
          "policy-number",
          "is of",
        ], ["r1"]),
        binary("ft-tn", "Term has TermNumber", ["r3", "term", "has"], [
          "r4",
          "term-number",
          "is of",
        ], ["r3"]),
        binary("ft-in-force", "Policy is in force for Term", ["r5", "policy", "is in force for"], [
          "r6",
          "term",
          "has in force",
        ], ["r5", "r6"]),
        binary(
          "ft-pid",
          "PolicyPeriod has PolicyPeriodId",
          ["r7", "period", "has"],
          [
            "r8",
            "period-id",
            "identifies",
          ],
          ["r7"],
          [{ type: "internal_uniqueness", roles: ["r8"], is_preferred: true }],
        ),
        binary("ft-an", "Appeal has AppealNumber", ["r9", "appeal", "has"], [
          "r10",
          "appeal-number",
          "is of",
        ], ["r9"]),
        binary("ft-contests", "Appeal contests PolicyPeriod", ["r11", "appeal", "contests"], [
          "r12",
          "period",
          "is contested by",
        ], ["r11"]),
        binary("ft-supersedes", "PolicyPeriod supersedes PolicyPeriod", [
          "r13",
          "period",
          "supersedes",
        ], [
          "r14",
          "period",
          "is superseded by",
        ], ["r13"]),
        binary("ft-lid", "Leg has LegId", ["r15", "leg", "has"], ["r16", "leg-id", "is of"], [
          "r15",
        ]),
        binary(
          "ft-pc",
          "Port has PortCode",
          ["r17", "port", "has"],
          ["r18", "port-code", "is of"],
          ["r17"],
        ),
        binary("ft-departs", "Leg departs from Port", ["r19", "leg", "departs from"], [
          "r20",
          "port",
          "is left by",
        ], [
          "r19",
        ]),
        binary("ft-arrives", "Leg arrives at Port", ["r21", "leg", "arrives at"], [
          "r22",
          "port",
          "receives",
        ], [
          "r21",
        ]),
      ],
      objectified_fact_types: [{ id: "oft", fact_type: "ft-in-force", object_type: "period" }],
    },
  };
}
const ansi = { dialect: "ansi", naming: { table_case: "lower", column_case: "lower" } };
const tableSql = (text, name) =>
  new RegExp(String.raw`CREATE TABLE ${name} \(([\s\S]*?)\n\)`).exec(text)?.[1] ?? "";

test("an objectification is its entity's table, keyed on its roles, its own identifier unique", () => {
  const { text } = generateDdl(objectificationKernel(), ansi);
  assert.doesNotMatch(text, /CREATE TABLE policy_is_in_force_for_term/);
  const period = tableSql(text, "policy_period");
  assert.match(period, /PRIMARY KEY \(policy_id, term_id\)/);
  assert.match(period, /UNIQUE \(policy_period_id\)/);
  assert.match(period, /FOREIGN KEY \(policy_id\) REFERENCES policy/);
});

test("a reference to an objectification is a composite foreign key", () => {
  const { text } = generateDdl(objectificationKernel(), ansi);
  assert.match(
    tableSql(text, "appeal"),
    /FOREIGN KEY \(policy_period_policy_id, policy_period_term_id\) REFERENCES policy_period \(policy_id, term_id\)/,
  );
});

test("a self-reference and two roles with one player are named after their roles", () => {
  const { text } = generateDdl(objectificationKernel(), ansi);
  assert.match(tableSql(text, "policy_period"), /supersedes_policy_period_policy_id/);
  const leg = tableSql(text, "leg");
  assert.match(leg, /departs_from_port_id/);
  assert.match(leg, /arrives_at_port_id/);
  assert.doesNotMatch(leg, /^\s+port_id /m);
});

test("names a skin's truncation makes alike are numbered apart, and references follow", () => {
  const { text } = generateDdl(objectificationKernel(), {
    ...ansi,
    naming: { ...ansi.naming, max_identifier: 8 },
  });
  const period = tableSql(text, "policy_p");
  assert.match(period, /^\s+supersed /m);
  assert.match(period, /^\s+superse2 /m);
  assert.match(
    period,
    /FOREIGN KEY \(supersed, superse2\) REFERENCES policy_p \(policy_i, term_id\)/,
  );
  for (const body of [period, tableSql(text, "appeal"), tableSql(text, "leg")]) {
    const cols = [...body.matchAll(/^\s+([a-z0-9_]+) /gm)].map((m) => m[1]);
    assert.equal(new Set(cols).size, cols.length, cols.join(", "));
  }
});

test("a skin's extra table that has a generated table's name is refused", () => {
  assert.throws(
    () =>
      generateDdl(objectificationKernel(), {
        ...ansi,
        extra_tables: ["CREATE TABLE leg (x integer)"],
      }),
    /extra table leg has the name of a generated table/,
  );
});

test("dbt states a key of several columns as one model test, not as unique columns", () => {
  const dir = mkdtempSync(join(tmpdir(), "dbt-composite-"));
  generateDbt(objectificationKernel(), { adapter: "postgres" }, dir);
  const schema = parse(readFileSync(join(dir, "models/staging/schema.yml"), "utf8"));
  const period = schema.models.find((m) => m.name === "stg_policy_period");
  assert.deepEqual(period.tests, [
    {
      "dbt_utils.unique_combination_of_columns": {
        combination_of_columns: ["policy_id", "term_id"],
      },
    },
  ]);
  for (const c of period.columns.filter((c) => ["policy_id", "term_id"].includes(c.name))) {
    assert.ok(!c.tests.includes("unique"), c.name);
  }
});
