/**
 * The DDL and dbt importers read a uniqueness beside a table's key the same
 * way (dbt-alternate-uniqueness.spec.md). The dbt reading (`dbtMapping/
 * uniqueness.ts`, the reference's one-to-one in `factTypes.ts`) is a second
 * copy of DDL steps 1b and 3b, and this is the test that fails when the two
 * diverge, as `compositeKeyParity.test.ts` is for composite keys. It lives
 * here because cli is the one package that depends on both.
 */
import type { OrmModel } from "@barwise/core";
import { importDbtProject } from "@barwise/dbt";
import { DdlImportFormat } from "@barwise/formats";
import { describe, expect, it } from "vitest";

/**
 * Every uniqueness in the model, described by players: an internal one by
 * its fact type's players and the players of the roles it spans, an
 * external one by the players of its roles. The key's uniqueness is in
 * both and compared too. Which one each importer stores as preferred is not
 * compared: the DDL importer prefers a composite key's uniqueness
 * (annotation-preferred-identifier.spec.md) and the dbt importer does not
 * yet (barwise-fuo), and leaving preferred ones out made that difference
 * read as a missing uniqueness.
 */
function uniquenesses(model: OrmModel): string[] {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  const roleOwner = new Map(
    model.factTypes.flatMap((f) => f.roles.map((r) => [r.id, { f, player: name(r.playerId) }])),
  );
  const internal = model.factTypes.flatMap((f) =>
    f.internalConstraints
      .filter((c) => c.type === "internal_uniqueness")
      .map((c) =>
        `internal on ${f.roles.map((r) => name(r.playerId)).join(" / ")}: ${
          (c as { roleIds: readonly string[]; }).roleIds.map((id) => roleOwner.get(id)!.player)
            .join(
              ", ",
            )
        }`
      )
  );
  const external = model.constraints
    .filter((c) => c.type === "external_uniqueness")
    .map((c) =>
      `external: ${
        (c as { roleIds: readonly string[]; }).roleIds.map((id) => roleOwner.get(id)?.player ?? "?")
          .sort().join(", ")
      }`
    );
  return [...internal, ...external].sort();
}

const col = (name: string, tests = "[not_null]") =>
  `      - name: ${name}\n        data_tests: ${tests}\n`;
const ref = (name: string, to: string, extra = "") =>
  `      - name: ${name}\n        data_tests: [not_null${extra}, { relationships: { to: "ref('${to}')", field: ${name} } }]\n`;
const model = (name: string, key: string[], columns: string, tests = "") =>
  `  - name: ${name}\n    constraints:\n      - { type: primary_key, columns: [${
    key.join(", ")
  }] }\n${tests}    columns:\n${columns}`;
const combination = (...sets: string[][]) =>
  `    data_tests:\n${
    sets.map((s) =>
      `      - dbt_utils.unique_combination_of_columns:\n          arguments: { combination_of_columns: [${
        s.join(", ")
      }] }\n`
    ).join("")
  }`;

const cases: { name: string; ddl: string; dbt: string; }[] = [
  {
    // The unique column comes first, where the key guess would take it:
    // the declared key keeps it a secondary uniqueness.
    name: "a unique value column beside the key",
    ddl: `CREATE TABLE person (email VARCHAR(80) NOT NULL UNIQUE, person_id INT PRIMARY KEY);`,
    dbt: `models:\n${
      model(
        "person",
        ["person_id"],
        col("email", "[not_null, unique]") + col("person_id", "[not_null, unique]"),
      )
    }`,
  },
  {
    name: "a unique foreign key column: a one-to-one reference",
    ddl: `CREATE TABLE person (person_id INT PRIMARY KEY);
      CREATE TABLE passport (passport_id INT PRIMARY KEY,
        person_id INT NOT NULL UNIQUE REFERENCES person (person_id));`,
    dbt: `models:\n${model("person", ["person_id"], col("person_id", "[not_null, unique]"))}${
      model(
        "passport",
        ["passport_id"],
        col("passport_id", "[not_null, unique]") + ref("person_id", "person", ", unique"),
      )
    }`,
  },
  {
    name: "a uniqueness over two value columns: an external uniqueness",
    ddl: `CREATE TABLE room (room_id INT PRIMARY KEY, building VARCHAR(10) NOT NULL,
        room_number INT NOT NULL, UNIQUE (building, room_number));`,
    dbt: `models:\n${
      model(
        "room",
        ["room_id"],
        col("room_id", "[not_null, unique]") + col("building") + col("room_number"),
        combination(["building", "room_number"]),
      )
    }`,
  },
  {
    // rank is the one column beside the key, so it is the third role, and
    // the second key falls on whole roles of the fact type.
    name: "a second key of a relationship's fact type",
    ddl: `CREATE TABLE encounter (encounter_id INT PRIMARY KEY);
      CREATE TABLE diagnosis (icd_code VARCHAR(8) PRIMARY KEY);
      CREATE TABLE encounter_diagnosis (
        encounter_id INT NOT NULL REFERENCES encounter (encounter_id),
        icd_code VARCHAR(8) NOT NULL REFERENCES diagnosis (icd_code),
        diagnosis_rank INT NOT NULL,
        PRIMARY KEY (encounter_id, icd_code), UNIQUE (encounter_id, diagnosis_rank));`,
    dbt: `models:\n${
      model("encounter", ["encounter_id"], col("encounter_id", "[not_null, unique]"))
    }${model("diagnosis", ["icd_code"], col("icd_code", "[not_null, unique]"))}${
      model(
        "encounter_diagnosis",
        ["encounter_id", "icd_code"],
        ref("encounter_id", "encounter") + ref("icd_code", "diagnosis") + col("diagnosis_rank"),
        combination(["encounter_id", "icd_code"], ["encounter_id", "diagnosis_rank"]),
      )
    }`,
  },
  {
    // A note beside the rank makes the fact type objectified, with rank an
    // attribute: the uniqueness spans a role and the objectifier's column.
    name: "a uniqueness over a relationship's role and an attribute of its objectifier",
    ddl: `CREATE TABLE encounter (encounter_id INT PRIMARY KEY);
      CREATE TABLE diagnosis (icd_code VARCHAR(8) PRIMARY KEY);
      CREATE TABLE encounter_diagnosis (
        encounter_id INT NOT NULL REFERENCES encounter (encounter_id),
        icd_code VARCHAR(8) NOT NULL REFERENCES diagnosis (icd_code),
        diagnosis_rank INT NOT NULL, note VARCHAR(40),
        PRIMARY KEY (encounter_id, icd_code), UNIQUE (encounter_id, diagnosis_rank));`,
    dbt: `models:\n${
      model("encounter", ["encounter_id"], col("encounter_id", "[not_null, unique]"))
    }${model("diagnosis", ["icd_code"], col("icd_code", "[not_null, unique]"))}${
      model(
        "encounter_diagnosis",
        ["encounter_id", "icd_code"],
        ref("encounter_id", "encounter") + ref("icd_code", "diagnosis") + col("diagnosis_rank")
          + "      - name: note\n",
        combination(["encounter_id", "icd_code"], ["encounter_id", "diagnosis_rank"]),
      )
    }`,
  },
];

describe("the DDL and dbt importers agree on a uniqueness beside the key", () => {
  for (const c of cases) {
    it(c.name, () => {
      const fromDdl = uniquenesses(new DdlImportFormat().parse(c.ddl).model);
      const fromDbt = uniquenesses(importDbtProject([c.dbt]).model);
      expect(fromDbt).toEqual(fromDdl);
      // Not vacuous: each case states a uniqueness beside the key.
      expect(fromDdl.length).toBeGreaterThan(0);
    });
  }
});
