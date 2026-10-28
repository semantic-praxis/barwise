/**
 * Every uniqueness the DDL export writes as a UNIQUE clause comes back from
 * a dbt export and re-import (dbt-alternate-uniqueness.spec.md), and from
 * both DDL round trips (objectified-key-identifier.spec.md). Before,
 * the dbt export wrote a test only for each table's key, so all of them
 * were lost: every one of these 24 tracked models came back with none. It
 * lives here because cli is the one package that depends on core and dbt.
 *
 * Each UNIQUE is described without names, which can change on re-import (a
 * relationship's column is renamed for its player): per column, whether it
 * is a key column, a foreign key column and the table it references, or a
 * value column and its data type; and its table's key width. A uniqueness
 * read back on the wrong column, or the wrong side of a reference, changes
 * the description.
 */
import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { RelationalMapper, routeUniqueOnly } from "@barwise/core/mapping";
import { DbtExportFormat, importDbtProject } from "@barwise/dbt";
import { DdlExportFormat, DdlImportFormat } from "@barwise/formats";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");

/** Every tracked model the router writes a UNIQUE for, found by scanning the corpus. */
const MODELS = [
  "docs/auction.orm.yaml",
  "examples/auction-project/domains/auctions.orm.yaml",
  "examples/auction-project/domains/catalog.orm.yaml",
  "examples/models/diagram-layout.orm.yaml",
  "examples/transcripts/clinic-appointments.orm.yaml",
  "examples/transcripts/rb-global-account-taxonomy.orm.yaml",
  "test-plan/fixtures/external-uniqueness-violation.orm.yaml",
  "test-plan/fixtures/external-uniqueness.orm.yaml",
  "trial/customers/C01-hospital/kernel.orm.yaml",
  "trial/customers/C02-bank/kernel.orm.yaml",
  "trial/customers/C03-insurer/kernel.orm.yaml",
  "trial/customers/C04-marketplace/kernel.orm.yaml",
  "trial/customers/C05-manufacturer/kernel.orm.yaml",
  "trial/customers/C06-logistics/kernel.orm.yaml",
  "trial/customers/C07-telecom/kernel.orm.yaml",
  "trial/customers/C08-utility/kernel.orm.yaml",
  "trial/customers/C09-pharma/kernel.orm.yaml",
  "trial/customers/C10-university/kernel.orm.yaml",
  "trial/customers/C11-analytics/kernel.orm.yaml",
  "trial/customers/C12-benefits/kernel.orm.yaml",
  "trial/findings/barwise-nqd/base.orm.yaml",
  "trial/findings/barwise-nqd/incoming.orm.yaml",
  "trial/findings/barwise-rkm/after.orm.yaml",
  "trial/findings/barwise-rkm/before.orm.yaml",
];

/** Each UNIQUE the router writes for the model, described without names. */
function uniques(model: OrmModel): string[] {
  const schema = new RelationalMapper().map(model);
  return routeUniqueOnly(model, schema).uniques.map((u) => {
    const table = schema.tables.find((t) => t.name === u.tableName)!;
    const key = table.primaryKey.columnNames;
    const columns = u.columns.map((name) => {
      if (key.includes(name)) return "key";
      const fk = table.foreignKeys.find((f) => f.columnNames.includes(name));
      if (fk) return `fk:${fk.referencedTable}`;
      return `value:${table.columns.find((c) => c.name === name)!.dataType}`;
    }).sort();
    return `${key.length}-column key: ${columns.join(", ")}`;
  }).sort();
}

function dbtRoundTrip(model: OrmModel): OrmModel {
  const { files } = new DbtExportFormat().export(model, { annotate: false });
  const schemaYaml = files!.find((f) => f.name.endsWith("schema.yml"))!.content;
  return importDbtProject([schemaYaml]).model;
}

/**
 * The DDL round trips are held to the same descriptions. The annotated one
 * gained a UNIQUE in four of these models, on an objectified relationship
 * keyed on one column, until barwise-i3r (objectified-key-identifier.spec.md).
 */
const ROUND_TRIPS: Record<string, (m: OrmModel) => OrmModel> = {
  dbt: dbtRoundTrip,
  "DDL with annotations": (m) =>
    new DdlImportFormat().parse(new DdlExportFormat().export(m).text).model,
  "DDL without annotations": (m) =>
    new DdlImportFormat().parse(new DdlExportFormat().export(m, { annotate: false }).text).model,
};

const load = (file: string) =>
  new OrmYamlSerializer().deserialize(readFileSync(resolve(ROOT, file), "utf8"));

describe("a round trip keeps every uniqueness the DDL export writes", () => {
  for (const file of MODELS) {
    for (const [way, trip] of Object.entries(ROUND_TRIPS)) {
      it(`${file}, through ${way}`, () => {
        const model = load(file);
        const before = uniques(model);
        // Not vacuous: each listed model has one.
        expect(before.length).toBeGreaterThan(0);
        expect(uniques(trip(model))).toEqual(before);
      });
    }
  }
});

/** An entity's preferred identifier, by its fact type's name and the players of its roles. */
function preferred(model: OrmModel, entityName: string): string {
  const entity = model.getObjectTypeByName(entityName);
  const id = entity && model.preferredIdentifierOf(entity.id);
  const found = id ? model.everyConstraint().find(([c]) => c.id === id) : undefined;
  if (!found) return "none";
  const [c, ft] = found;
  const roles = model.factTypes.flatMap((f) => f.roles);
  const players = "roleIds" in c
    ? c.roleIds.map((r) => model.getObjectType(roles.find((x) => x.id === r)!.playerId)!.name)
    : [];
  return `${ft?.name ?? "model"}: ${players.join(", ")}`;
}

describe("an annotated DDL round trip keeps the preferred identifier of an objectifier keyed on one column", () => {
  // Each entity objectifies a relationship whose one-column key it takes;
  // the import used to give it a second, typed identifier over that column.
  const cases: [string, string][] = [
    ["trial/customers/C05-manufacturer/kernel.orm.yaml", "WorkOrder"],
    ["trial/customers/C06-logistics/kernel.orm.yaml", "Booking"],
    ["trial/findings/barwise-nqd/base.orm.yaml", "WorkOrder"],
    ["trial/findings/barwise-nqd/incoming.orm.yaml", "WorkOrder"],
  ];
  for (const [file, entity] of cases) {
    it(`${file}: ${entity}`, () => {
      const model = load(file);
      expect(preferred(model, entity)).not.toBe("none");
      expect(preferred(ROUND_TRIPS["DDL with annotations"]!(model), entity))
        .toBe(preferred(model, entity));
    });
  }
});
