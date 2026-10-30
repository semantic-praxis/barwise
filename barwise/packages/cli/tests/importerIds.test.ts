/**
 * Every registered importer gives element ids through `generateId()`, or
 * leaves the id to the model, which names the element by its rule
 * (docs/specs/importer-role-ids.spec.md; iri-identity 6b).
 *
 * The id policy lives in one place, core's `generateId`, and the surfaces
 * install UUIDv7 behind it. An importer that passes a hand-built `id` to a
 * role config bypasses it silently: the dbt, DDL and OpenAPI importers did,
 * writing `Customers has CustomerName::role1` and `<uuid>-has-Name-role`,
 * and the DDL/OpenAPI form collided across tables that share a column name.
 *
 * So the oracle is the generator and the model's naming rule: install a
 * generator that mints `gen-1`, `gen-2`, ..., run each importer, and
 * require every object type, fact type, role and constraint id to be one
 * it minted or the one the model's rule gives the element (its local name;
 * `<fact type>.<role>`; its minted sentence), with the suffix rule's `_N`,
 * and no repeats. Any hand-built id -- textual, or a real UUID with a
 * suffix -- fails.
 *
 * The test iterates the format registry rather than a list of its own, and
 * an importer with neither a fixture nor an exemption below fails, so a new
 * importer is covered by declaration. This lives in the CLI package because
 * it is the one package that depends on every importer package.
 */
import { registerCodeFormats } from "@barwise/code-analysis";
import {
  generateId,
  type ImportFormat,
  listImporters,
  localName,
  mintedName,
  type OrmModel,
  setIdGenerator,
} from "@barwise/core";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

registerStandardFormats();
registerDbtFormats();
registerCodeFormats();

/**
 * Two tables share a `name` column (the value-side collision), and `orders`
 * has two foreign keys, so both of the DDL importer's role-minting paths run.
 * Table-level `FOREIGN KEY` lines, because the importer does not read an
 * inline `REFERENCES` on a column: with inline clauses the foreign-key path
 * never ran, and reverting its fix left this test green (caught in review).
 */
const DDL = `
CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL);
CREATE TABLE suppliers (supplier_id INTEGER PRIMARY KEY, name VARCHAR(50));
CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  supplier_id INTEGER,
  total DECIMAL(10,2),
  FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers (supplier_id)
);
`;

/**
 * The SQL importer reads query patterns, not CREATE TABLE: a JOIN gives it
 * two entities and a fact type between them.
 */
const SQL = `
SELECT o.id, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'active'
`;

/** Two schemas share `name`; one references the other singly and as an array. */
const OPENAPI = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
  components: {
    schemas: {
      Customer: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string" } },
        required: ["id", "name"],
      },
      Supplier: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string" } },
      },
      Order: {
        type: "object",
        properties: {
          id: { type: "integer" },
          customer: { $ref: "#/components/schemas/Customer" },
          suppliers: { type: "array", items: { $ref: "#/components/schemas/Supplier" } },
        },
        required: ["id", "customer"],
      },
    },
  },
});

const DBT_SCHEMA = `version: 2
models:
  - name: customers
    columns:
      - name: customer_id
        data_type: number
        tests: [unique, not_null]
      - name: customer_name
        tests: [not_null]
  - name: orders
    columns:
      - name: order_id
        data_type: number
        tests: [unique, not_null]
      - name: customer_id
        tests:
          - not_null
          - relationships:
              to: ref('customers')
              field: customer_id
      - name: status
        tests:
          - accepted_values:
              values: ['open', 'closed']
`;

/**
 * Every id path the Ossie importer takes: a declared concept, a built-in a
 * role names (`String`), each multiplicity, a subtype fact, a single
 * identifier whose far-role uniqueness the importer adds, a composite one
 * (an external uniqueness), and a mandatory role from `requires`.
 */
const OSSIE = `version: 0.2.0.dev0
name: Ids
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: Party
    type: EntityType
    identify_by: [ code ]
    requires: [ Party.code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: ManyToOne, verbalizes: [ "{Party} has {Code}" ] }
      - { name: nick, roles: [ { concept: String } ], verbalizes: [ "{Party} has nick {String}" ] }
  - concept: Person
    type: EntityType
    extends: [ Party ]
  - concept: Seat
    type: EntityType
    identify_by: [ party, label ]
    relationships:
      - { name: party, roles: [ { concept: Party } ], multiplicity: ManyToOne, verbalizes: [ "{Seat} is for {Party}" ] }
      - { name: label, roles: [ { concept: String } ], multiplicity: OneToOne, verbalizes: [ "{Seat} has label {String}" ] }
`;

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function dbtProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "importer-ids-dbt-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "models"));
  writeFileSync(join(dir, "dbt_project.yml"), "name: demo\nversion: '1.0'\nprofile: demo\n");
  writeFileSync(join(dir, "models", "schema.yml"), DBT_SCHEMA);
  return dir;
}

/**
 * One small source tree for the three code importers. With no language
 * server on PATH they fall back to regex analysis, which is what runs here
 * and in CI; an LSP-backed run mints ids through the same model API.
 */
function codeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "importer-ids-code-"));
  tempDirs.push(dir);
  const files: Record<string, string> = {
    "src/model.ts": 'export type Status = "open" | "closed";\n'
      + "export interface Customer { id: string; name: string; }\n"
      + "export interface Order { id: string; customer: Customer; status: Status; total: number; }\n",
    "src/main/java/demo/Customer.java":
      "package demo;\npublic class Customer { private String id; private String name; }\n",
    "src/main/java/demo/Order.java": "package demo;\npublic enum Status { OPEN, CLOSED }\n"
      + "public class Order { private String id; private Customer customer; private Status status; }\n",
    "src/main/kotlin/demo/Model.kt": "package demo\nenum class Status { OPEN, CLOSED }\n"
      + "data class Customer(val id: String, val name: String)\n"
      + "data class Order(val id: String, val customer: Customer, val status: Status)\n",
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

async function directory(name: string, dir: string): Promise<OrmModel> {
  return (await importerFor(name).parseAsync!(dir)).model;
}

/** How to feed each importer. Keys must cover every registered importer. */
const FIXTURES: Record<string, () => Promise<OrmModel>> = {
  ddl: async () => text("ddl", DDL),
  openapi: async () => text("openapi", OPENAPI),
  sql: async () => text("sql", SQL),
  ossie: async () => text("ossie", OSSIE),
  dbt: async () => directory("dbt", dbtProject()),
  typescript: async () => directory("typescript", codeProject()),
  java: async () => directory("java", codeProject()),
  kotlin: async () => directory("kotlin", codeProject()),
};

/** Importers deliberately not run here, each with the reason. */
const EXEMPT: Record<string, string> = {
  norma:
    "keeps the source .orm file's ids on purpose -- object types, fact types, roles, subtype facts, "
    + "constraints and fact instances -- and derives the rest from them, so one file imports to one "
    + "model (orm-format-3.spec.md WS2, which also lists what a round trip does not keep); "
    + "barwise-1070 asks whether role ids should be re-minted",
};

function importerFor(name: string): ImportFormat {
  const importer = listImporters().find((d) => d.name === name)?.importer;
  if (!importer) throw new Error(`no importer registered as "${name}"`);
  return importer;
}

function text(name: string, input: string): OrmModel {
  return importerFor(name).parse!(input).model;
}

interface GivenId {
  readonly label: string;
  readonly id: string;
  /** The id the model's rule gives the element when the importer states none. */
  readonly rule: string | undefined;
}

/** Every id an importer could give, labelled for a readable failure. */
function allIds(model: OrmModel): GivenId[] {
  const ids: GivenId[] = [];
  const add = (label: string, id: string, rule: string | undefined) =>
    ids.push({ label: `${label}: ${id}`, id, rule });
  for (const ot of model.objectTypes) add(`object type ${ot.name}`, ot.id, localName(ot.name));
  for (const ft of model.factTypes) {
    add(`fact type ${ft.name}`, ft.id, localName(ft.name));
    for (const r of ft.roles) {
      add(`role ${ft.name}/${r.name}`, r.id, `${ft.id}.${localName(r.name)}`);
    }
  }
  // Subtype facts too: an importer that maps a supertype (Ossie's extends)
  // mints their ids, and a hand-built one there passed unseen before.
  for (const sf of model.subtypeFacts) {
    const end = (id: string) => model.getObjectType(id)?.name ?? id;
    add(
      `subtype fact ${end(sf.subtypeId)} -> ${end(sf.supertypeId)}`,
      sf.id,
      mintedName({ kind: "subtypeFact", subtypeFact: sf }, model),
    );
  }
  for (const inView of model.everyConstraint()) {
    const [c, ft] = inView;
    add(
      `constraint ${ft?.name ?? "(across fact types)"}/${c.type}`,
      c.id!,
      mintedName({ kind: "constraint", inView }, model),
    );
  }
  return ids;
}

/** The id is the rule's, or the rule's under the suffix rule (`_2`, `_3`). */
function byRule(id: string, rule: string | undefined): boolean {
  if (rule === undefined) return false;
  return id === rule || (id.startsWith(`${rule}_`) && /^\d+$/.test(id.slice(rule.length + 1)));
}

let minted: Set<string>;
function installCountingGenerator(): void {
  minted = new Set();
  let n = 0;
  setIdGenerator(() => {
    const id = `gen-${++n}`;
    minted.add(id);
    return id;
  });
}

afterEach(() => {
  setIdGenerator(undefined);
});

describe("importer ids come from generateId", () => {
  it("every registered importer has a fixture or a stated exemption", () => {
    const registered = listImporters().map((d) => d.name).sort();
    const accounted = [...Object.keys(FIXTURES), ...Object.keys(EXEMPT)].sort();
    expect(registered).toEqual(accounted);
  });

  it("the counting generator is what generateId uses", () => {
    installCountingGenerator();
    expect(generateId()).toBe("gen-1");
  });

  for (const name of Object.keys(FIXTURES)) {
    it(`${name}: every element id was minted by the generator, and none repeats`, async () => {
      installCountingGenerator();
      const model = await FIXTURES[name]!();
      const ids = allIds(model);
      expect(ids.length, `${name} produced no elements`).toBeGreaterThan(0);

      const handBuilt = ids.filter((e) => !minted.has(e.id) && !byRule(e.id, e.rule))
        .map((e) => e.label);
      expect(handBuilt, `${name} gave ids neither the generator nor the model gave`).toEqual([]);

      const values = ids.map((e) => e.id);
      expect(new Set(values).size, `${name} emitted a repeated id`).toBe(values.length);
    });
  }
});
