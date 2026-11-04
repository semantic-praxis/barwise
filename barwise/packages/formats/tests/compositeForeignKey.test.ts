/**
 * The DDL importer reads each foreign key as one reference, however many
 * columns it has (composite-foreign-key-round-trip.spec.md). Read column by
 * column, `claim (policy_id, term_number)` came back with two references to
 * `policy_period`.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();

const PERIOD = `CREATE TABLE policy (policy_id INT PRIMARY KEY);
  CREATE TABLE policy_period (
    policy_id INT NOT NULL REFERENCES policy (policy_id), term_number INT NOT NULL,
    starts DATE NOT NULL, PRIMARY KEY (policy_id, term_number));`;

/** The fact types between Claim and another entity, each with its constraints on Claim's side and the other. */
function references(model: OrmModel, to: string) {
  const claim = model.getObjectTypeByName("Claim")!;
  const target = model.getObjectTypeByName(to)!;
  return model.factTypes
    .filter((f) =>
      f.roles.some((r) => r.playerId === claim.id) && f.roles.some((r) => r.playerId === target.id)
    )
    .map((f) => {
      const near = f.roles.find((r) => r.playerId === claim.id)!.id;
      const far = f.roles.find((r) => r.playerId === target.id)!.id;
      const has = (type: string, role: string) =>
        f.internalConstraints.some((c) =>
          c.type === type
          && ("roleIds" in c ? c.roleIds.length === 1 && c.roleIds[0] === role : c.roleId === role)
        );
      return {
        name: f.name,
        nearUnique: has("internal_uniqueness", near),
        mandatory: has("mandatory", near),
        farUnique: has("internal_uniqueness", far),
      };
    });
}

const claim = (columns: string, extra = "") =>
  ddl.parse(`${PERIOD}
    CREATE TABLE claim (claim_id INT PRIMARY KEY, ${columns},
      FOREIGN KEY (policy_id, term_number) REFERENCES policy_period (policy_id, term_number)${extra});`);

describe("a multi-column foreign key outside the key", () => {
  it("is one reference, mandatory when every column is NOT NULL", () => {
    const { model } = claim("policy_id INT NOT NULL, term_number INT NOT NULL");
    expect(references(model, "PolicyPeriod")).toEqual([
      { name: "Claim policy PolicyPeriod", nearUnique: true, mandatory: true, farUnique: false },
    ]);
    // Its columns are no values of the claim: the claim plays only in its
    // identifier and the reference.
    const claimId = model.getObjectTypeByName("Claim")!.id;
    expect(model.factTypes.filter((f) => f.roles.some((r) => r.playerId === claimId)))
      .toHaveLength(2);
  });

  it("is optional when any column is nullable", () => {
    const { model } = claim("policy_id INT NOT NULL, term_number INT");
    expect(references(model, "PolicyPeriod")).toEqual([
      { name: "Claim policy PolicyPeriod", nearUnique: true, mandatory: false, farUnique: false },
    ]);
  });

  it("is one-to-one when its columns are a UNIQUE, with no external uniqueness beside it", () => {
    const { model, warnings } = claim(
      "policy_id INT NOT NULL, term_number INT NOT NULL",
      ", UNIQUE (term_number, policy_id)",
    );
    expect(references(model, "PolicyPeriod")).toEqual([
      { name: "Claim policy PolicyPeriod", nearUnique: true, mandatory: true, farUnique: true },
    ]);
    const claimRoles = new Set(
      model.factTypes.flatMap((f) => f.roles).filter((r) =>
        r.playerId === model.getObjectTypeByName("Claim")!.id
      ).map((r) => r.id),
    );
    expect(
      model.constraints.filter((c) =>
        c.type === "external_uniqueness"
        && model.factTypes.some((f) =>
          f.roles.some((r) => c.roleIds.includes(r.id)) && f.roles.some((r) => claimRoles.has(r.id))
        )
      ),
    ).toEqual([]);
    expect(warnings.filter((w) => /"claim"/.test(w))).toEqual([]);
  });

  it("and a single-column one sharing a column are two references, one each", () => {
    const { model, warnings } = claim(
      "policy_id INT NOT NULL REFERENCES policy (policy_id), term_number INT NOT NULL, code INT NOT NULL",
      ", UNIQUE (policy_id, code)",
    );
    expect(references(model, "PolicyPeriod")).toHaveLength(1);
    expect(references(model, "Policy")).toHaveLength(1);
    // A combination naming the shared column stands for neither reference.
    expect(warnings).toContain(
      `Table "claim": UNIQUE (policy_id, code) names "policy_id", a column of two foreign keys, `
        + `and was not imported (barwise-1077).`,
    );
  });

  it("refuses a UNIQUE over part of it, of one column or several, rather than dropping it silently", () => {
    const { warnings } = claim(
      "policy_id INT NOT NULL, term_number INT NOT NULL UNIQUE, code INT NOT NULL",
      ", UNIQUE (term_number, code)",
    );
    const part = "covers only part of the composite foreign key (policy_id, term_number)";
    expect(warnings).toContain(
      `Table "claim": UNIQUE (term_number) ${part}, and was not imported (barwise-1077).`,
    );
    expect(warnings).toContain(
      `Table "claim": UNIQUE (term_number, code) ${part}, and was not imported (barwise-1077).`,
    );
  });
});

describe("the exceptions the per-column reading kept", () => {
  it("a foreign key that includes a single-column key is no reference either (barwise-1078)", () => {
    const { model, warnings } = ddl.parse(`${PERIOD}
      CREATE TABLE claim (policy_id INT PRIMARY KEY, term_number INT NOT NULL,
        FOREIGN KEY (policy_id, term_number) REFERENCES policy_period (policy_id, term_number));`);
    const claimId = model.getObjectTypeByName("Claim")!.id;
    const period = model.getObjectTypeByName("PolicyPeriod")!.id;
    expect(
      model.factTypes.filter((f) =>
        f.roles.some((r) => r.playerId === claimId) && f.roles.some((r) => r.playerId === period)
      ),
    ).toEqual([]);
    expect(
      warnings.some((w) => /the key is imported, the reference is not \(barwise-1078\)/.test(w)),
    )
      .toBe(true);
  });

  it("a foreign key naming a column the table does not declare is no reference, and no crash", () => {
    const { model } = ddl.parse(`${PERIOD}
      CREATE TABLE claim (claim_id INT PRIMARY KEY, policy_id INT NOT NULL, term_number INT NOT NULL,
        FOREIGN KEY (POLICY_ID, term_number) REFERENCES policy_period (policy_id, term_number));`);
    expect(references(model, "PolicyPeriod")).toEqual([]);
  });

  it("a multi-column foreign key to a table imported as no entity keeps its columns, with a warning", () => {
    const { model, warnings } = ddl.parse(`CREATE TABLE claim (claim_id INT PRIMARY KEY,
        policy_id INT NOT NULL, term_number INT NOT NULL,
        FOREIGN KEY (policy_id, term_number) REFERENCES elsewhere (policy_id, term_number));`);
    const claimId = model.getObjectTypeByName("Claim")!.id;
    expect(model.factTypes.filter((f) => f.roles.some((r) => r.playerId === claimId)))
      .toHaveLength(3);
    expect(warnings).toContain(
      `Table "claim": the foreign key (policy_id, term_number) references "elsewhere", imported as `
        + `no entity; its columns are kept as columns instead (composite-foreign-key-round-trip.spec.md).`,
    );
  });

  it("a column's foreign keys to no entity decide alike in either declared order", () => {
    const read = (fks: string[]) => {
      const { model } = ddl.parse(`CREATE TABLE claim (claim_id INT PRIMARY KEY,
          policy_id INT NOT NULL, term_number INT NOT NULL, ${fks.join(", ")});`);
      return model.factTypes.map((f) => f.name).sort();
    };
    const single = "FOREIGN KEY (policy_id) REFERENCES nowhere (policy_id)";
    const multi =
      "FOREIGN KEY (policy_id, term_number) REFERENCES elsewhere (policy_id, term_number)";
    expect(read([single, multi])).toEqual(read([multi, single]));
    expect(read([single, multi])).toContain("Claim has PolicyId");
  });

  it("a single-column key that is a foreign key stays the typed key, with no reference (barwise-1078)", () => {
    const { model, warnings } = ddl.parse(`CREATE TABLE person (person_id INT PRIMARY KEY);
      CREATE TABLE employee (person_id INT PRIMARY KEY REFERENCES person (person_id), grade INT);`);
    const employee = model.getObjectTypeByName("Employee")!;
    const person = model.getObjectTypeByName("Person")!;
    expect(
      model.factTypes.filter((f) =>
        f.roles.some((r) => r.playerId === employee.id)
        && f.roles.some((r) => r.playerId === person.id)
      ),
    ).toEqual([]);
    expect(
      warnings.some((w) => /the key is imported, the reference is not \(barwise-1078\)/.test(w)),
    )
      .toBe(true);
  });
});

describe("the barwise annotation of a multi-column reference", () => {
  const exported = () =>
    new DdlExportFormat().export(
      claim("policy_id INT NOT NULL, term_number INT NOT NULL").model,
    ).text;

  it("is written on the reference's first column, and on no other", () => {
    const lines = exported().split("\n").filter((l) => l.includes(`"table":"claim","column"`));
    expect(lines.map((l) => /"column":"(\w+)"/.exec(l)![1])).toEqual(["claim_id", "policy_id"]);
  });

  it("is read back for the one reference, from whichever of its columns carries it", () => {
    const renamed = exported().replace(
      `"factType":"Claim policy PolicyPeriod","readings":["{0} policy {1}"]`,
      `"factType":"Claim falls in PolicyPeriod","readings":["{1} falls in {0}"]`,
    );
    expect(renamed).toContain("Claim falls in PolicyPeriod");
    const first = ddl.parse(renamed).model;
    expect(references(first, "PolicyPeriod").map((r) => r.name)).toEqual([
      "Claim falls in PolicyPeriod",
    ]);
    // Moved to the second column by hand: still the reference's line.
    const lines = renamed.split("\n");
    const at = lines.findIndex((l) =>
      l.includes(`"column":"policy_id","factType":"Claim falls in`)
    );
    const line = lines[at]!.replace(`"column":"policy_id"`, `"column":"term_number"`);
    lines.splice(at, 1);
    lines.splice(lines.findIndex((l) => /^\s+term_number INTEGER/.test(l)), 0, line);
    expect(references(ddl.parse(lines.join("\n")).model, "PolicyPeriod").map((r) => r.name))
      .toEqual(["Claim falls in PolicyPeriod"]);
  });
});
