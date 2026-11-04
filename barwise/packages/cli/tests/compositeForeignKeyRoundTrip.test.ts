/**
 * A multi-column foreign key comes back from a DDL or dbt round trip as one
 * reference: not one per column, and not none
 * (composite-foreign-key-round-trip.spec.md). Before, the DDL importer read
 * one outside the key column by column, and the dbt export wrote nothing for
 * it, so these eight tracked models gained or lost references on every
 * round trip. It lives here because cli is the one package that depends on
 * core, formats and dbt.
 *
 * Each model is compared as the multiset of its multi-column foreign keys,
 * since names can change on re-import (a relationship's table comes back
 * named for its players), but what each foreign key points at, how many
 * columns it has, whether it is mandatory and whether it is one-to-one
 * cannot.
 */
import { OrmModel, OrmYamlSerializer } from "@barwise/core";
import { RelationalMapper, renderDbt } from "@barwise/core/mapping";
import { importDbtProject } from "@barwise/dbt";
import { DdlExportFormat, DdlImportFormat } from "@barwise/formats";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");

/** Every tracked model with a multi-column foreign key, found by scanning the corpus. */
const MODELS = [
  "trial/customers/C01-hospital/kernel.orm.yaml",
  "trial/customers/C03-insurer/kernel.orm.yaml",
  "trial/customers/C04-marketplace/kernel.orm.yaml",
  "trial/customers/C07-telecom/kernel.orm.yaml",
  "trial/customers/C09-pharma/kernel.orm.yaml",
  "trial/customers/C12-benefits/kernel.orm.yaml",
  "trial/findings/barwise-rkm/before.orm.yaml",
  "trial/findings/barwise-rkm/after.orm.yaml",
];

/**
 * Each multi-column foreign key the mapper makes, described without names.
 * One-to-one is read from the model, since the schema's tables hold no
 * UNIQUE: the fact type behind the columns has a uniqueness on the
 * referenced side's role alone. dbt writes no UNIQUE beside a key, so its
 * round trip is compared without it (the spec's Out of scope).
 */
function foreignKeys(model: OrmModel, withOneToOne: boolean): string[] {
  const schema = new RelationalMapper().map(model);
  return schema.tables.flatMap((t) =>
    t.foreignKeys.filter((fk) => fk.columnNames.length > 1).map((fk) => {
      const columns = fk.columnNames.map((n) => t.columns.find((c) => c.name === n)!);
      const roleId = columns[0]!.sourceRoleId;
      const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleId));
      const far = ft?.roles.find((r) => r.id !== roleId);
      const oneToOne = far !== undefined
        && ft!.internalConstraints.some((c) =>
          c.type === "internal_uniqueness" && c.roleIds.length === 1 && c.roleIds[0] === far.id
        );
      return [
        fk.referencedTable,
        `${columns.length} columns`,
        columns.every((c) => !c.nullable) ? "mandatory" : "optional",
        ...(withOneToOne ? [oneToOne ? "one-to-one" : "many-to-one"] : []),
      ].join(" ");
    })
  ).sort();
}

const ROUND_TRIPS: Record<string, { trip: (m: OrmModel) => OrmModel; oneToOne: boolean; }> = {
  "DDL with annotations": {
    trip: (m) => new DdlImportFormat().parse(new DdlExportFormat().export(m).text).model,
    oneToOne: true,
  },
  "DDL without annotations": {
    trip: (m) =>
      new DdlImportFormat().parse(new DdlExportFormat().export(m, { annotate: false }).text).model,
    oneToOne: true,
  },
  "dbt": {
    trip: (m) => importDbtProject([renderDbt(new RelationalMapper().map(m)).schemaYaml]).model,
    oneToOne: false,
  },
};

describe("a multi-column foreign key round-trips as one reference", () => {
  for (const file of MODELS) {
    const model = new OrmYamlSerializer().deserialize(readFileSync(resolve(ROOT, file), "utf8"));
    for (const [name, { trip, oneToOne }] of Object.entries(ROUND_TRIPS)) {
      it(`${file}, through ${name}`, () => {
        const before = foreignKeys(model, oneToOne);
        // Not vacuous: each listed model has one.
        expect(before.length).toBeGreaterThan(0);
        expect(foreignKeys(trip(model), oneToOne)).toEqual(before);
      });
    }
  }
});
