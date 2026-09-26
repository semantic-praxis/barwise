/**
 * The key type of an entity with no preferred identifying binary
 * (dbt-key-type-fidelity.spec.md, WS2).
 *
 * The mapper used to type such a key from the FIRST value type the
 * entity played, so `Order(order_id)` with one attribute `OrderTotal:
 * decimal(10,2)` got a DECIMAL(10,2) key. It now takes a type only from
 * the value type the reference mode names, and otherwise the configured
 * fallback.
 *
 * The repository sweep replaces `scripts/refmode-heuristic-audit.mjs`,
 * which copied the mapper's private `toSnake` to classify each pick. This
 * asks the mapper itself instead: map every model under two fallback
 * strategies, and a key whose type does not move with the fallback took
 * its type from a value type.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type { RelationalSchema } from "../../src/mapping/RelationalSchema.js";
import { preferredIdentifyingBinary } from "../../src/model/identification.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

function keyType(schema: RelationalSchema, table: string): string | undefined {
  const t = schema.tables.find((x) => x.name === table);
  const pk = t?.primaryKey.columnNames[0];
  return t?.columns.find((c) => c.name === pk)?.dataType;
}

describe("referenceModePkType: an entity with no preferred identifying binary", () => {
  it("does not take its key type from an unrelated attribute", () => {
    const model = new ModelBuilder("Borrowed")
      .withEntityType("Order", { referenceMode: "order_id" })
      .withValueType("OrderTotal", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .withBinaryFactType("Order has OrderTotal", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderTotal", name: "is of" },
        uniqueness: "role1",
      })
      .build();

    expect(keyType(mapper.map(model), "order")).toBe("TEXT");
    expect(keyType(mapper.map(model, { preferredIdentifierStrategy: "integer" }), "order"))
      .toBe("INTEGER");
  });

  it("takes its key type from the value type its reference mode names", () => {
    // OrderTotal comes first, so the old first-match rule would pick it.
    const model = new ModelBuilder("Named")
      .withEntityType("Order", { referenceMode: "order_id" })
      .withValueType("OrderTotal", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .withValueType("OrderId", { dataType: { name: "integer" } })
      .withBinaryFactType("Order has OrderTotal", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderTotal", name: "is of" },
        uniqueness: "role1",
      })
      .withBinaryFactType("Order has OrderId", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderId", name: "is of" },
        uniqueness: "both",
      })
      .build();

    expect(keyType(mapper.map(model), "order")).toBe("INTEGER");
  });
});

describe("referenceModePkType over this repository's models", () => {
  const barwiseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const files = execFileSync("git", ["ls-files", "--", "*.orm.yaml"], { cwd: barwiseRoot })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  function load(file: string): OrmModel | undefined {
    try {
      return new OrmYamlSerializer().deserialize(readFileSync(join(barwiseRoot, file), "utf8"));
    } catch {
      return undefined; // a model that does not load is not this test's subject
    }
  }

  it("sees the models it is measuring", () => {
    // A sweep over zero files passes every assertion below vacuously.
    expect(files.length).toBeGreaterThan(50);
  });

  it("types only the keys whose reference mode names a value type", () => {
    const typedFromValueType: string[] = [];
    let fallbackKeys = 0;

    for (const file of files) {
      const model = load(file);
      if (!model) continue;
      const asText = mapper.map(model);
      const asInteger = mapper.map(model, { preferredIdentifierStrategy: "integer" });
      // Keys this function does not type: an objectified entity's comes
      // from the fact type it objectifies, a subtype's from its supertype.
      const elsewhere = new Set([
        ...model.objectifiedFactTypes.map((o) => o.objectTypeId),
        ...model.subtypeFacts.map((s) => s.subtypeId),
      ]);
      for (const ot of model.objectTypes) {
        if (ot.kind !== "entity" || preferredIdentifyingBinary(model, ot)) continue;
        if (elsewhere.has(ot.id)) continue;
        const t = asText.tables.find((x) => x.sourceElementId === ot.id);
        if (!t || t.primaryKey.columnNames.join() !== ot.referenceMode) continue;
        const table = t.name;
        const a = keyType(asText, table);
        const b = keyType(asInteger, table);
        if (a === undefined || b === undefined) continue;
        if (a === b) typedFromValueType.push(`${file}: ${ot.name}(${ot.referenceMode}) ${a}`);
        else fallbackKeys++;
      }
    }

    // Measured at the commit that landed WS2: the old first-match rule
    // typed 93 of these keys from a value type, and 90 of those were an
    // unrelated attribute. These three are the ones whose reference mode
    // names the value type. A new entry here is a key typed from a value
    // type; check that it is the named one before updating the list.
    expect(typedFromValueType.sort()).toMatchInlineSnapshot(`
      [
        "docs/auction.orm.yaml: Model(model_id) TEXT",
        "examples/auction-project/domains/catalog.orm.yaml: Model(model_id) TEXT",
        "examples/transcripts/pii-redaction.orm.yaml: Reviewer(employee_id) VARCHAR(20)",
      ]
    `);
    expect(fallbackKeys).toBeGreaterThan(0);
  });
});
