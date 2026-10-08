/**
 * `--infer-references` (reference-inference.spec.md): a column named after
 * another table's key, with that key's type, reads as a reference to it,
 * reported; without the option nothing is inferred.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();
const infer = (sql: string) => ddl.parse(sql, { inferReferences: true });

/** Whether some fact type relates the two entities. */
function related(model: OrmModel, a: string, b: string): boolean {
  const ids = [a, b].map((n) => model.getObjectTypeByName(n)?.id);
  return model.factTypes.some((f) =>
    ids.every((id) => id !== undefined && f.roles.some((r) => r.playerId === id))
  );
}

const site = `CREATE TABLE site (site_id INT PRIMARY KEY, name VARCHAR(40));`;
const device = (column: string, type = "INT") =>
  `CREATE TABLE network_device (device_id INT PRIMARY KEY, ${column} ${type});`;

describe("a column named after a table's key, with its type", () => {
  it("infers nothing without the option, whatever the names", () => {
    const { model, warnings } = ddl.parse(`${site} ${device("site_id")}`);
    expect(related(model, "NetworkDevice", "Site")).toBe(false);
    expect(warnings.some((w) => /infer-references/.test(w))).toBe(false);
  });

  it("is a reference by each of the three forms, reported once", () => {
    for (const column of ["site_id", "SiteId", "site_site_id"]) {
      const { model, warnings } = infer(`${site} ${device(column)}`);
      expect(related(model, "NetworkDevice", "Site"), column).toBe(true);
      expect(warnings.filter((w) => /read as a reference to "site"/.test(w)), column).toHaveLength(
        1,
      );
    }
    // <table>_id where the key is not called id.
    const { model } = infer(`CREATE TABLE site (code INT PRIMARY KEY); ${device("site_id")}`);
    expect(related(model, "NetworkDevice", "Site")).toBe(true);
  });

  it("matches the table in either number, by the three endings only", () => {
    const pairs: [string, string][] = [
      ["categories", "category_id"],
      ["category", "categories_id"],
      ["statuses", "status_id"],
      ["status", "statuses_id"],
      ["subjects", "subject_id"],
      ["subject", "subjects_id"],
    ];
    for (const [table, column] of pairs) {
      const sql = `CREATE TABLE ${table} (code INT PRIMARY KEY);
        CREATE TABLE item (item_id INT PRIMARY KEY, ${column} INT);`;
      const { model } = infer(sql);
      const name = model.objectTypes.find((o) => o.name.toLowerCase() === table)!.name;
      expect(related(model, "Item", name), `${table} <- ${column}`).toBe(true);
    }
    const irregular = infer(`CREATE TABLE people (code INT PRIMARY KEY);
      CREATE TABLE item (item_id INT PRIMARY KEY, person_id INT);`);
    expect(related(irregular.model, "Item", "People")).toBe(false);
  });

  it("compares the conceptual type name only", () => {
    const ok = (key: string, col: string) =>
      related(
        infer(`CREATE TABLE site (site_id ${key} PRIMARY KEY); ${device("site_id", col)}`).model,
        "NetworkDevice",
        "Site",
      );
    expect(ok("INT", "INTEGER")).toBe(true);
    expect(ok("VARCHAR(10)", "VARCHAR(12)")).toBe(true);
    expect(ok("INT IDENTITY", "INT")).toBe(true);
    expect(ok("SERIAL", "INTEGER")).toBe(true);
    // BIGSERIAL and an unrecognised type parse to nothing: no inference.
    expect(ok("BIGSERIAL", "BIGINT")).toBe(false);
    expect(ok("GEOGRAPHY", "GEOGRAPHY")).toBe(false);
    expect(ok("INT", "VARCHAR(10)")).toBe(false);
  });

  it("never matches the column's own table", () => {
    const { model, warnings } = infer(
      `CREATE TABLE site (site_id INT PRIMARY KEY, parent_site_id INT);`,
    );
    expect(
      model.factTypes.filter((f) =>
        f.roles.every((r) => r.playerId === model.getObjectTypeByName("Site")!.id)
      ),
    )
      .toEqual([]);
    expect(warnings.some((w) => /infer-references/.test(w))).toBe(false);
  });

  it("infers nothing from two qualifying tables, naming both", () => {
    const { model, warnings } = infer(`CREATE TABLE site (id INT PRIMARY KEY);
      CREATE TABLE region (id INT PRIMARY KEY);
      CREATE TABLE network_device (device_id INT PRIMARY KEY, id_ref INT, id INT);`);
    expect(warnings.some((w) => /"id" could reference "site", "region"; none is inferred/.test(w)))
      .toBe(true);
    expect(related(model, "NetworkDevice", "Site") || related(model, "NetworkDevice", "Region"))
      .toBe(false);
  });

  it("counts only tables that meet every criterion: a name match of another type is no candidate", () => {
    const { model, warnings } = infer(`${site}
      CREATE TABLE legacy_sites (site_id UUID PRIMARY KEY);
      ${device("site_id")}`);
    expect(related(model, "NetworkDevice", "Site")).toBe(true);
    expect(warnings.some((w) => /could reference/.test(w))).toBe(false);
  });

  it("never infers a key column, only reports it", () => {
    const { model, warnings } = infer(`${site}
      CREATE TABLE site_detail (site_id INT PRIMARY KEY, note VARCHAR(80));`);
    expect(related(model, "SiteDetail", "Site")).toBe(false);
    expect(warnings.some((w) => /key column "site_id" is named like a reference to "site"/.test(w)))
      .toBe(true);
  });

  it("leaves a declared foreign key alone, with no inference warning", () => {
    const { model, warnings } = infer(`${site} CREATE TABLE region (region_id INT PRIMARY KEY);
      CREATE TABLE network_device (device_id INT PRIMARY KEY,
        site_id INT REFERENCES region (region_id));`);
    expect(related(model, "NetworkDevice", "Region")).toBe(true);
    expect(related(model, "NetworkDevice", "Site")).toBe(false);
    expect(warnings.some((w) => /infer-references/.test(w))).toBe(false);
  });

  describe("compares column names without case, as SQL does for unquoted names", () => {
    // A table-level constraint keeps its own spelling (PR #628 review).
    it("a key column named in another case is still never inferred", () => {
      const { model, warnings } = infer(`${site}
        CREATE TABLE site_detail (site_id INT, note VARCHAR(80), PRIMARY KEY (SITE_ID));`);
      expect(related(model, "SiteDetail", "Site")).toBe(false);
      expect(model.subtypeFacts).toEqual([]);
      expect(warnings.some((w) => /key column "site_id" is named like a reference/.test(w)))
        .toBe(true);
    });

    it("a declared foreign key in another case still keeps the column", () => {
      const { model, warnings } = infer(`${site} CREATE TABLE region (region_id INT PRIMARY KEY);
        CREATE TABLE network_device (device_id INT PRIMARY KEY, site_id INT,
          FOREIGN KEY (SITE_ID) REFERENCES region (region_id));`);
      // Not asserted: the Region relationship. The importer drops a declared
      // foreign key spelled in another case with or without inference
      // (barwise-sl4), which is not this rule's to fix.
      expect(related(model, "NetworkDevice", "Site")).toBe(false);
      expect(warnings.some((w) => /infer-references/.test(w))).toBe(false);
    });

    it("a target whose key is named in another case is still a target", () => {
      const { model } = infer(
        `CREATE TABLE site (site_id INT, name VARCHAR(40), PRIMARY KEY (SITE_ID));
        ${device("site_id")}`,
      );
      expect(related(model, "NetworkDevice", "Site")).toBe(true);
    });
  });

  describe("targets only a table that becomes an entity (PR #628 review)", () => {
    it("not a second schema's table of a name, which is skipped as a duplicate", () => {
      // b.site matches by type, but it is skipped and the reference would
      // resolve to a.site, whose key is a UUID.
      const { model, warnings } = infer(`CREATE TABLE a.site (site_id UUID PRIMARY KEY);
        CREATE TABLE b.site (site_id INT PRIMARY KEY);
        ${device("site_id")}`);
      expect(related(model, "NetworkDevice", "Site")).toBe(false);
      expect(warnings.some((w) => /read as a reference to "site"/.test(w))).toBe(false);
      expect(model.factTypes.some((f) => /^NetworkDevice has \w*SiteId$/.test(f.name))).toBe(true);
    });

    it("not a table its annotation makes a fact table, which has no entity", () => {
      // Inferred, the column lost even its value fact: step 3 found no
      // entity for the reference.
      const { model, warnings } = infer(`CREATE TABLE person (person_id INT PRIMARY KEY);
        CREATE TABLE club (club_id INT PRIMARY KEY);
        -- barwise:v1 {"kind":"factTable","table":"membership","factType":"Person belongs to Club","readings":["{0} belongs to {1}"],"roles":[{"name":"member","player":"Person","columns":["person_id"]},{"name":"club","player":"Club","columns":["club_id"]}]}
        CREATE TABLE membership (person_id INT PRIMARY KEY REFERENCES person (person_id),
          club_id INT NOT NULL REFERENCES club (club_id));
        CREATE TABLE ticket (ticket_id INT PRIMARY KEY, membership_id INT);`);
      expect(model.getFactTypeByName("Person belongs to Club")).toBeDefined();
      expect(model.getFactTypeByName("Ticket has MembershipId")).toBeDefined();
      expect(warnings.some((w) => /reference to "membership"/.test(w))).toBe(false);
    });
  });

  it("needs a single key column: a composite key's first column is no target", () => {
    const { model } = infer(`CREATE TABLE site (site_id INT, rack INT, PRIMARY KEY (site_id, rack));
      ${device("site_id")}`);
    expect(related(model, "NetworkDevice", "Site")).toBe(false);
  });
});
