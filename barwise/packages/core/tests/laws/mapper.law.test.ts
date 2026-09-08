/**
 * Laws over a generated model: the relational mapper produces a schema
 * that could actually be created.
 *
 * The mapper is a per-kind walk that builds tables, columns and keys by
 * appending to mutable structures, which is the shape that produces
 * omission defects: barwise-931 truncated a composite key to one column
 * for a year with every fixture green. These state what must hold of
 * the schema for any model, so an omission fails on the first generated
 * model that reaches it. Spec: docs/specs/core-model-laws.spec.md, WS5.
 *
 * A failure prints the seed and the shrunk model, so one recorded value
 * reproduces it.
 */

/** See `serialization.law.test.ts`: 250 runs under parallel coverage. */
const LAW_TIMEOUT_MS = 120_000;

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type { RelationalSchema } from "../../src/mapping/RelationalSchema.js";
import { preferredIdentifyingBinary } from "../../src/model/identification.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { arbOrmModel, RUNS, SEED } from "../arbitraries/model.js";

const mapper = new RelationalMapper();

describe("law: the mapper is total", () => {
  /**
   * `RelationalMapper` has no `throw` anywhere in it, so this is not
   * about a declared error path: it is about the undeclared ones, the
   * `!` assertions and the lookups that assume a table exists. Those
   * are what a generated model reaches and a fixture does not.
   */
  it("map does not throw on any generated model", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        expect(() => mapper.map(model)).not.toThrow();
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("law: every schema the mapper produces is well formed", () => {
  /**
   * The clauses a `CREATE TABLE` run would enforce, in the order it
   * would hit them. Stated as one property rather than five so a
   * failure reports the whole schema it happened in.
   */
  it("names, keys and references all resolve", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        expectWellFormed(mapper.map(model));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("law: one identification becomes one column", () => {
  /**
   * A reference mode is shorthand for an identifying binary, and a
   * model may state both. The mapper used to believe both: it took the
   * preferred identifier's DATA TYPE for a key named from the reference
   * mode, then mapped the same fact type again as an ordinary value
   * column -- two columns for one fact, on 109 entities across 15
   * shipped models (barwise-967).
   *
   * Stated over the fact type rather than over column names, because
   * the duplicate did not share a name: `pushColumn`'s collision
   * fallback renamed the second one, which is how it survived a rename
   * (PR #456) without being noticed as a duplicate at all.
   */
  it("no entity table carries its preferred identifier twice", { timeout: LAW_TIMEOUT_MS }, () => {
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        expectIdentifiedOnce(model, mapper.map(model));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("coverage: the generator reaches the shapes the mapper branches on", () => {
  /**
   * A mapper law over models with no objectified fact type and no
   * subtype never enters the two steps that rewrite a primary key
   * after it was built, which is where barwise-931 and barwise-963
   * live. Counted, so a generator change that stops reaching them
   * fails here rather than passing the laws vacuously.
   */
  const schemas = fc.sample(arbOrmModel(), { seed: SEED, numRuns: RUNS })
    .map((model) => ({ model, schema: mapper.map(model) }));

  it("produces a table with a composite primary key", () => {
    const count =
      schemas.filter(({ schema }) => schema.tables.some((t) => t.primaryKey.columnNames.length > 1))
        .length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces a table with a composite foreign key", () => {
    const count =
      schemas.filter(({ schema }) =>
        schema.tables.some((t) => t.foreignKeys.some((fk) => fk.columnNames.length > 1))
      ).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces a schema mapped from a model carrying a subtype fact", () => {
    const count = schemas.filter(({ model }) => model.subtypeFacts.length > 0).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces a schema mapped from a model carrying an objectified fact type", () => {
    const count = schemas.filter(({ model }) => model.objectifiedFactTypes.length > 0).length;
    expect(count).toBeGreaterThan(0);
  });

  it("produces an entity identified by a preferred binary to a value type", () => {
    // Measured at this seed: 1 model of 250, and that one model is what
    // kills the mutation on the once-only law. One is not cover -- it is
    // one seed change from a law that passes vacuously, the same thin
    // spot barwise-968 records for composite foreign keys. Counted here
    // so raising it is a visible change rather than an invisible one.
    const count =
      schemas.filter(({ model }) =>
        model.objectTypes.some((ot) =>
          ot.kind === "entity" && preferredIdentifyingBinary(model, ot) !== undefined
        )
      ).length;
    expect(count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The well-formedness clauses
// ---------------------------------------------------------------------------

/**
 * Every clause `core-model-laws.spec.md` WS5 specified, including the
 * one it had to defer.
 *
 * "A foreign key's `referencedColumns` equal the referenced table's
 * primary key, in order" was red on arrival: the mapper replaced a key
 * after foreign keys to it were built (barwise-963), and a subtype fact
 * truncated a composite subtype key (barwise-965). Both are fixed by
 * settling every key before anything reads one
 * (`mapper-key-settlement.spec.md` WS2), so the clause is back and the
 * fixture that pinned the wrong output is gone.
 *
 * It is the clause that does the work. Under the weaker one that
 * shipped in its place -- referenced columns merely EXIST in the target
 * -- a foreign key naming a column that is no longer a key reads as
 * well formed, which is exactly how barwise-963 and -965 passed.
 */
/**
 * No entity's table holds two columns derived from the one fact type
 * that identifies it.
 *
 * `sourceRoleId` is the link: phase 0 stamps the key with the entity
 * role of the preferred binary, and `mapValueTypeColumn` stamps the
 * same role id on the column it would add for that fact type. Two
 * columns carrying that role id is the defect, whatever they are
 * called.
 */
function expectIdentifiedOnce(model: OrmModel, schema: RelationalSchema): void {
  const bySource = new Map(schema.tables.map((t) => [t.sourceElementId, t]));

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    const preferred = preferredIdentifyingBinary(model, ot);
    if (!preferred) continue;
    const table = bySource.get(ot.id);
    if (!table) continue;

    const fromIdentifier = table.columns.filter((c) => c.sourceRoleId === preferred.entityRole.id);
    expect(
      fromIdentifier.map((c) => c.name),
      `${table.name} materialises ${preferred.factType.name} more than once`,
    ).toHaveLength(fromIdentifier.length === 0 ? 0 : 1);
  }
}

function expectWellFormed(schema: RelationalSchema): void {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  expect(byName.size, `duplicate table name in [${schema.tables.map((t) => t.name)}]`)
    .toBe(schema.tables.length);

  for (const table of schema.tables) {
    const columnNames = table.columns.map((c) => c.name);
    const owned = new Set(columnNames);
    expect(owned.size, `${table.name} has a duplicate column: [${columnNames}]`)
      .toBe(columnNames.length);

    for (const pkCol of table.primaryKey.columnNames) {
      expect(owned.has(pkCol), `${table.name} key names a missing column ${pkCol}`).toBe(true);
    }

    for (const fk of table.foreignKeys) {
      const target = byName.get(fk.referencedTable);
      expect(target, `${table.name} references missing table ${fk.referencedTable}`)
        .toBeDefined();

      // A zero-column foreign key constrains nothing and would not
      // parse; it is what a role loop that found no target produces if
      // it still emits the key.
      expect(fk.columnNames.length, `${table.name} has an empty foreign key`)
        .toBeGreaterThan(0);
      // Unequal arity is the barwise-931 defect's signature: a
      // composite target key truncated to its first column.
      expect(
        fk.referencedColumns.length,
        `${table.name} -> ${fk.referencedTable} arity: `
          + `[${fk.columnNames}] against [${fk.referencedColumns}]`,
      ).toBe(fk.columnNames.length);

      for (const local of fk.columnNames) {
        expect(owned.has(local), `${table.name} key names a missing column ${local}`).toBe(true);
      }
      // The clause WS5 deferred: not merely that the referenced columns
      // exist, but that they ARE the target's key.
      expect(
        [...fk.referencedColumns],
        `${table.name} -> ${fk.referencedTable} does not name that table's key`,
      ).toEqual([...target!.primaryKey.columnNames]);
    }
  }
}
