/**
 * DDL import keeps every column, its type, and its constraints on the
 * right role (docs/specs/ddl-import-fidelity.spec.md).
 *
 * The older tests in DdlImportFormat.test.ts assert that SOME mandatory or
 * uniqueness constraint exists, never which role holds it -- which is how
 * the importer shipped with both on the value's role, turning `NOT NULL`
 * into nullable and adding `UNIQUE` to every column on re-export. These
 * assert the role, by its player.
 */
import type { Constraint, FactType, OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const importer = new DdlImportFormat();

function factType(model: OrmModel, name: string): FactType {
  const ft = model.factTypes.find((f) => f.name === name);
  if (!ft) throw new Error(`no fact type "${name}": ${model.factTypes.map((f) => f.name)}`);
  return ft;
}

/** Each constraint as `<type>:<player names>`, so a test reads which role holds it. */
function constraintsByPlayer(model: OrmModel, ft: FactType): string[] {
  const player = (roleId: string) => {
    const role = ft.roles.find((r) => r.id === roleId)!;
    return model.getObjectType(role.playerId)!.name;
  };
  return ft.constraints.map((c: Constraint) => {
    if (c.type === "mandatory") return `mandatory:${player(c.roleId)}`;
    if (c.type === "internal_uniqueness") {
      return `unique:${c.roleIds.map(player).join(",")}${c.isPreferred ? ":preferred" : ""}`;
    }
    return c.type;
  }).sort();
}

function dataType(model: OrmModel, name: string) {
  return model.getObjectTypeByName(name)?.dataType;
}

describe("ordinary columns: the entity's role first, constraints on the right role (R3)", () => {
  const { model } = importer.parse(`
    CREATE TABLE customers (
      customer_id INTEGER PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      nickname VARCHAR(50),
      email VARCHAR(100),
      phone VARCHAR(20) UNIQUE,
      UNIQUE (email)
    );
  `);

  it("reads <Entity> has <Value>, entity first", () => {
    const ft = factType(model, "Customers has Name");
    expect(ft.roles.map((r) => model.getObjectType(r.playerId)!.name)).toEqual([
      "Customers",
      "Name",
    ]);
    expect(ft.readings.map((r) => r.template)).toEqual(["{0} has {1}", "{1} is of {0}"]);
  });

  it("NOT NULL makes the entity's role mandatory; uniqueness sits on the entity's role", () => {
    expect(constraintsByPlayer(model, factType(model, "Customers has Name"))).toEqual([
      "mandatory:Customers",
      "unique:Customers",
    ]);
  });

  it("a nullable, non-unique column has only the entity-role uniqueness", () => {
    expect(constraintsByPlayer(model, factType(model, "Customers has Nickname"))).toEqual([
      "unique:Customers",
    ]);
  });

  it("a table-level single-column UNIQUE adds uniqueness on the value's role", () => {
    expect(constraintsByPlayer(model, factType(model, "Customers has Email"))).toEqual([
      "unique:Customers",
      "unique:Email",
    ]);
  });

  it("an inline UNIQUE does the same", () => {
    expect(constraintsByPlayer(model, factType(model, "Customers has Phone"))).toEqual([
      "unique:Customers",
      "unique:Phone",
    ]);
  });
});

describe("a single-column key becomes a typed identifier (R4)", () => {
  it("creates the identifier value type with the key's type, in a preferred identifying binary", () => {
    const { model } = importer.parse(`
      CREATE TABLE orders (
        order_id BIGINT NOT NULL,
        placed_at TIMESTAMP,
        PRIMARY KEY (order_id)
      );
    `);
    expect(model.getObjectTypeByName("Orders")?.referenceMode).toBe("order_id");
    expect(dataType(model, "OrderId")).toEqual({ name: "integer" });
    expect(constraintsByPlayer(model, factType(model, "Orders has OrderId"))).toEqual([
      "mandatory:Orders",
      "unique:OrderId:preferred",
      "unique:Orders",
    ]);
  });

  it("does the same for an inline PRIMARY KEY with a length", () => {
    const { model } = importer.parse(`CREATE TABLE users (code CHAR(8) PRIMARY KEY);`);
    expect(dataType(model, "Code")).toEqual({ name: "text", length: 8 });
    expect(constraintsByPlayer(model, factType(model, "Users has Code"))).toContain(
      "unique:Code:preferred",
    );
  });

  it("warns on a composite key instead of dropping it silently", () => {
    const { warnings } = importer.parse(`
      CREATE TABLE enrollment (
        student_id INTEGER NOT NULL,
        course_id INTEGER NOT NULL,
        PRIMARY KEY (student_id, course_id)
      );
    `);
    expect(warnings.join("\n")).toMatch(
      /composite PRIMARY KEY \(student_id, course_id\).*barwise-1077/,
    );
  });
});

describe("column types: several words, length and scale, trailing clauses (R2, R1)", () => {
  const { model, warnings } = importer.parse(`
    CREATE TABLE t (
      id INTEGER PRIMARY KEY,
      a DOUBLE PRECISION,
      b TIMESTAMP WITH TIME ZONE NOT NULL,
      c CHARACTER VARYING(20),
      d DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
      e INTEGER DEFAULT 0,
      f VARCHAR(10) DEFAULT 'none' UNIQUE,
      CONSTRAINT t_f_len CHECK (length(f) > 0)
    );
  `);

  it("imports every column, with its length and scale", () => {
    expect(dataType(model, "A")).toEqual({ name: "float" });
    expect(dataType(model, "B")).toEqual({ name: "timestamp" });
    expect(dataType(model, "C")).toEqual({ name: "text", length: 20 });
    expect(dataType(model, "D")).toEqual({ name: "decimal", length: 10, scale: 2 });
    expect(dataType(model, "E")).toEqual({ name: "integer" });
    expect(dataType(model, "F")).toEqual({ name: "text", length: 10 });
  });

  it("reads the clauses after a DEFAULT", () => {
    expect(constraintsByPlayer(model, factType(model, "T has D"))).toContain("mandatory:T");
    expect(constraintsByPlayer(model, factType(model, "T has F"))).toContain("unique:F");
    expect(constraintsByPlayer(model, factType(model, "T has B"))).toContain("mandatory:T");
  });

  it("reports the table CHECK it does not import, and nothing else", () => {
    expect(warnings).toEqual([`Table "t": "CHECK (length(f) > 0)" is not imported.`]);
  });

  it("reads a DEFAULT expression through to the next clause (review of PR #570)", () => {
    const result = importer.parse(`
      CREATE TABLE seq (
        id INTEGER DEFAULT nextval('seq_id_seq'::regclass) NOT NULL,
        note VARCHAR(20) DEFAULT 'a, b' NOT NULL,
        made TIMESTAMP DEFAULT (now() at time zone 'utc') UNIQUE,
        score INTEGER DEFAULT (coalesce(1, NULL)) NOT NULL,
        PRIMARY KEY (id)
      );
    `);
    expect(result.warnings).toEqual([]);
    expect(constraintsByPlayer(result.model, factType(result.model, "Seq has Note"))).toEqual([
      "mandatory:Seq",
      "unique:Seq",
    ]);
    expect(constraintsByPlayer(result.model, factType(result.model, "Seq has Made"))).toContain(
      "unique:Made",
    );
    // A clause keyword inside the expression's parentheses does not end it.
    expect(constraintsByPlayer(result.model, factType(result.model, "Seq has Score"))).toEqual([
      "mandatory:Seq",
      "unique:Seq",
    ]);
  });

  it("imports a column with an unknown clause, and says what it skipped", () => {
    const result = importer.parse(`
      CREATE TABLE test (
        id INT PRIMARY KEY,
        computed_col INT GENERATED ALWAYS AS (id * 2) STORED
      );
    `);
    expect(dataType(result.model, "ComputedCol")).toEqual({ name: "integer" });
    expect(result.warnings).toEqual([
      `Table "test", column "computed_col": "GENERATED ALWAYS AS (id * 2) STORED" is not imported.`,
    ]);
  });

  it("warns on a column it cannot read at all", () => {
    const result = importer.parse(`CREATE TABLE u (id INT PRIMARY KEY, label NOT NULL);`);
    expect(result.model.getObjectTypeByName("Label")).toBeUndefined();
    expect(result.warnings).toEqual([
      `Table "u": could not read column "label NOT NULL"; not imported.`,
    ]);
  });

  it("warns that a multi-column UNIQUE is not imported, rather than making each column unique", () => {
    const result = importer.parse(`
      CREATE TABLE v (id INT PRIMARY KEY, a INT, b INT, UNIQUE (a, b));
    `);
    expect(constraintsByPlayer(result.model, factType(result.model, "V has A"))).toEqual([
      "unique:V",
    ]);
    expect(result.warnings.join("\n")).toMatch(/UNIQUE \(a, b\) spans several columns/);
  });

  it("does not mistake a column named key or index for a table constraint", () => {
    const result = importer.parse(`CREATE TABLE w (id INT PRIMARY KEY, key INT, index INT);`);
    expect(dataType(result.model, "Key")).toEqual({ name: "integer" });
    expect(dataType(result.model, "Index")).toEqual({ name: "integer" });
    expect(result.warnings).toEqual([]);
  });
});

describe("value types are shared only when sharing loses nothing (R5)", () => {
  it("shares a same-named, same-typed column and key across tables", () => {
    const { model } = importer.parse(`
      CREATE TABLE a (id INTEGER PRIMARY KEY, name VARCHAR(50));
      CREATE TABLE b (id INTEGER PRIMARY KEY, name VARCHAR(50));
    `);
    expect(model.objectTypes.filter((o) => o.kind === "value").map((o) => o.name).sort())
      .toEqual(["Id", "Name"]);
  });

  it("splits a same-named column with a different type, and warns", () => {
    const { model, warnings } = importer.parse(`
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(50));
      CREATE TABLE suppliers (id UUID PRIMARY KEY, name VARCHAR(100));
    `);
    expect(dataType(model, "Id")).toEqual({ name: "integer" });
    expect(dataType(model, "SuppliersId")).toEqual({ name: "uuid" });
    expect(dataType(model, "Name")).toEqual({ name: "text", length: 50 });
    expect(dataType(model, "SuppliersName")).toEqual({ name: "text", length: 100 });
    expect(warnings).toHaveLength(2);
  });
});

describe("a key that is also a foreign key (review of PR #570)", () => {
  it("keeps the typed key and reports the reference it does not import", () => {
    const { model, warnings } = importer.parse(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE user_profiles (user_id INTEGER PRIMARY KEY REFERENCES users (id), bio TEXT);
    `);
    expect(model.getObjectTypeByName("UserId")?.dataType).toEqual({ name: "integer" });
    expect(warnings).toEqual([
      `Table "user_profiles": key column "user_id" also references "users"; the key is imported, the reference is not (barwise-1078).`,
    ]);
  });
});

describe("inline REFERENCES is a foreign key (R6)", () => {
  it("creates the relationship, as the table-level form does", () => {
    const { model } = importer.parse(`
      CREATE TABLE customers (customer_id INTEGER PRIMARY KEY);
      CREATE TABLE orders (
        order_id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers (customer_id)
      );
    `);
    const fk = model.factTypes.find((f) =>
      f.roles.some((r) => model.getObjectType(r.playerId)?.name === "Customers")
      && f.roles.some((r) => model.getObjectType(r.playerId)?.name === "Orders")
    );
    expect(fk).toBeDefined();
    expect(model.getObjectTypeByName("CustomerId")?.dataType).toEqual({ name: "integer" });
    // Not also imported as an ordinary column.
    expect(model.factTypes.filter((f) => f.name.startsWith("Orders has"))).toHaveLength(1);
  });
});
