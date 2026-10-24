/**
 * The Apache Ossie ontology exporter
 * (`docs/specs/ossie-ontology-format.spec.md`, WS2): each rule against a
 * small native model, the loss report, the pinned schema, and the round
 * trip of the pinned flights example.
 */
import { type InternalConstraint, OrmModel } from "@barwise/core";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OssieExportFormat } from "../src/ossie/OssieExportFormat.js";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";
import type { OssieConcept, OssieDocument, OssieRelationship } from "../src/ossie/OssieTypes.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/ossie");
const fixture = (name: string) => readFileSync(resolve(fixtures, name), "utf8");

/** The pinned ontology schema, its remote `$ref` served from the vendored copy. */
function schemaValidator() {
  // Strict, but for `strictRequired`: the pinned schema itself writes
  // `required` inside an `anyOf` for properties its parent declares, which
  // is valid JSON Schema and only a style rule of ajv's -- about how the
  // schema is written, not about the document under test.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  // `ajv-formats` defines no `iri`, and strict mode refuses an unknown
  // format; an absolute IRI is a scheme, a colon, and no whitespace or
  // characters RFC 3987 excludes.
  ajv.addFormat("iri", /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/u);
  const core = JSON.parse(fixture("ossie-schema.json"));
  delete core.$id;
  ajv.addSchema(
    core,
    "https://raw.githubusercontent.com/apache/ossie/main/core-spec/ossie-schema.json",
  );
  return ajv.compile(JSON.parse(fixture("ontology.json")));
}

const exporter = new OssieExportFormat();
const importer = new OssieImportFormat();

function exported(model: OrmModel) {
  const result = exporter.export(model);
  const document = parse(result.text) as OssieDocument;
  const header = "# barwise: what this document could not carry from the model:";
  const losses = result.text.split("\n")
    .filter((l) => l.startsWith("# barwise: ") && l !== header)
    .map((l) => l.slice("# barwise: ".length));
  return { result, document, losses };
}

function concept(doc: OssieDocument, name: string): OssieConcept {
  const c = doc.ontology.find((x) => x.concept === name);
  if (!c) throw new Error(`no concept ${name}`);
  return c;
}

function relationship(doc: OssieDocument, conceptName: string, name: string): OssieRelationship {
  const r = concept(doc, conceptName).relationships?.find((x) => x.name === name);
  if (!r) throw new Error(`no relationship ${conceptName}.${name}`);
  return r;
}

let seq = 0;
const id = (tag: string) => `${tag}-${++seq}`;

function entity(m: OrmModel, name: string, referenceMode = "id") {
  return m.addObjectType({ id: id("ot"), name, kind: "entity", referenceMode });
}

/** A value type; `dataType: null` makes one with no data type. */
function value(
  m: OrmModel,
  name: string,
  dataType: Parameters<OrmModel["addObjectType"]>[0]["dataType"] | null = { name: "text" },
  extra = {},
) {
  return m.addObjectType({
    id: id("ot"),
    name,
    kind: "value",
    ...(dataType ? { dataType } : {}),
    ...extra,
  });
}

/** A fact type over the given players; `uc` and `mandatory` name roles by index. */
function fact(
  m: OrmModel,
  name: string,
  players: readonly { id: string; }[],
  reading: string,
  opts: {
    uc?: number[][];
    mandatory?: number[];
    roleNames?: string[];
    extra?: InternalConstraint[];
  } = {},
) {
  const roles = players.map((p, i) => ({
    id: id("r"),
    name: opts.roleNames?.[i] ?? m.getObjectType(p.id)!.name,
    playerId: p.id,
  }));
  const constraints: InternalConstraint[] = [
    ...(opts.uc ?? []).map((ix) => ({
      type: "internal_uniqueness" as const,
      id: id("uc"),
      roleIds: ix.map((i) => roles[i]!.id),
    })),
    ...(opts.mandatory ?? []).map((i) => ({
      type: "mandatory" as const,
      id: id("m"),
      roleId: roles[i]!.id,
    })),
    ...(opts.extra ?? []),
  ];
  return m.addFactType({ id: id("ft"), name, roles, readings: [reading], constraints });
}

describe("Ossie export: the pinned flights example", () => {
  const source = fixture("flights.ontology.yaml");
  const imported = importer.parse(source);
  const { document, losses, result } = exported(imported.model);

  it("is accepted by the pinned ontology schema", () => {
    const validate = schemaValidator();
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  });

  it("writes nothing to the loss report and no constraint spec", () => {
    expect(losses).toEqual([]);
    expect(result.constraintSpecs).toBeUndefined();
  });

  it("comes back equal in every construct the import did not warn about, compared by meaning", () => {
    const original = parse(source) as OssieDocument;
    // A value-type chain is flattened on import, with a warning naming it.
    const flattened = new Set(
      imported.warnings.flatMap((w) =>
        /^(\w+): extends \w+; barwise has no value-type subtyping/.exec(w)?.[1] ?? []
      ),
    );
    expect([...flattened].sort()).toEqual([
      "Capacity",
      "Delay",
      "Distance",
      "RunwayGeometry",
      "RunwayLength",
    ]);
    expect(meaning(document, flattened)).toEqual(meaning(original, flattened));
  });
});

/**
 * A document as what it means: concepts and relationships keyed by name,
 * `requires` as a set with each bound in one orientation, `extends`
 * dropped for the concepts the import flattened.
 */
function meaning(doc: OssieDocument, flattened: ReadonlySet<string>) {
  const bound = (e: string) => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(<=|>=|<|>)\s*(\w+)\s*$/.exec(e);
    if (!m) return e.trim();
    const flip = { "<=": ">=", ">=": "<=", "<": ">", ">": "<" }[m[2]!]!;
    return `${m[3]} ${flip} ${m[1]}`;
  };
  return {
    name: doc.name,
    description: doc.description,
    requires: [...(doc.requires ?? [])].sort(),
    ontology: Object.fromEntries(doc.ontology.map((c) => [c.concept, {
      ...c,
      extends: flattened.has(c.concept) ? undefined : c.extends,
      requires: c.requires ? [...c.requires].map(bound).sort() : undefined,
      relationships: Object.fromEntries((c.relationships ?? []).map((r) => [r.name, r])),
    }])),
  };
}

describe("Ossie export: a native model", () => {
  function shop() {
    const m = new OrmModel({ name: "Shop" });
    const customer = entity(m, "Customer", "nr");
    const order = entity(m, "Order", "nr");
    const nr = value(m, "CustomerNr", { name: "integer" });
    const ident = fact(m, "Customer has CustomerNr", [nr, customer], "{1} has {0}", {
      uc: [[0], [1]],
      mandatory: [1],
    });
    m.setPreferredIdentifier(
      customer.id,
      ident.internalConstraints.find((c) =>
        c.type === "internal_uniqueness" && c.roleIds[0] === ident.roles[0]!.id
      )!.id!,
    );
    fact(m, "Customer places Order", [customer, order], "{0} places {1}", {
      uc: [[1]],
      roleNames: ["places", "is placed by"],
    });
    return { m, customer, order };
  }

  it("is accepted by the pinned schema and re-imports without refusal", () => {
    const { document, result } = exported(shop().m);
    const validate = schemaValidator();
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    expect(() => importer.parse(result.text)).not.toThrow();
  });

  it("declares an identifier under the identified entity, as identify_by (precedence rule 2)", () => {
    const { document } = exported(shop().m);
    const c = concept(document, "Customer");
    expect(c.identify_by).toEqual(["customer_has_customernr"]);
    expect(relationship(document, "Customer", "customer_has_customernr")).toMatchObject({
      roles: [{ concept: "CustomerNr" }],
      multiplicity: "OneToOne",
      verbalizes: ["{Customer} has {CustomerNr}"],
    });
    // The mandatory on the entity's role is its first role, so a bare Entity.rel.
    expect(c.requires).toEqual(["Customer.customer_has_customernr"]);
  });

  it("puts the role with the only single-role uniqueness first, so it reads ManyToOne (rule 3)", () => {
    const { document } = exported(shop().m);
    expect(relationship(document, "Order", "customer_places_order")).toMatchObject({
      roles: [{ concept: "Customer", name: "places" }],
      multiplicity: "ManyToOne",
      verbalizes: ["{Customer:places} places {Order}"],
    });
  });

  it("puts the role a wide uniqueness leaves out last (rule 4)", () => {
    const m = new OrmModel({ name: "M" });
    const [a, b, c] = [entity(m, "A"), entity(m, "B"), value(m, "Score", { name: "integer" })];
    fact(m, "A with B scores", [c, a, b], "{1} with {2} scores {0}", { uc: [[1, 2]] });
    const r = relationship(exported(m).document, "A", "a_with_b_scores");
    expect(r.roles).toEqual([{ concept: "B" }, { concept: "Score" }]);
    expect(r.multiplicity).toBe("ManyToOne");
  });

  it("moves a built-in off the first role, and writes it as the built-in, not a concept", () => {
    const m = new OrmModel({ name: "M" });
    const s = value(m, "String");
    const a = entity(m, "A");
    fact(m, "label of A", [s, a], "{0} labels {1}");
    const { document } = exported(m);
    expect(document.ontology.map((c) => c.concept)).toEqual(["A"]);
    expect(relationship(document, "A", "label_of_a").roles).toEqual([{ concept: "String" }]);
  });

  it("names a ring's later role, never the first", () => {
    const m = new OrmModel({ name: "M" });
    const p = entity(m, "Person");
    fact(m, "Person manages Person", [p, p], "{0} manages {1}", {
      uc: [[1]],
      roleNames: ["Person", "Person"],
    });
    const r = relationship(exported(m).document, "Person", "person_manages_person");
    expect(r.roles).toEqual([{ concept: "Person", name: "Person_1" }]);
    // The uniqueness is on barwise role 1, so rule 3 puts it first, and the
    // reading's positions follow the order.
    expect(r.multiplicity).toBe("ManyToOne");
    expect(r.verbalizes).toEqual(["{Person:Person_1} manages {Person}"]);
  });
});

describe("Ossie export: the loss report", () => {
  it("names each unexpressible constraint, and gives each with roles a constraint spec", () => {
    const m = new OrmModel({ name: "M" });
    const p = entity(m, "Person");
    const ft = fact(m, "Person knows Person", [p, p], "{0} knows {1}", {
      roleNames: ["Person", "other"],
    });
    ft.addConstraint({
      type: "ring",
      id: "ring-1",
      roleIds: [ft.roles[0]!.id, ft.roles[1]!.id],
      ringType: "irreflexive",
    });
    const { losses, result } = exported(m);
    expect(losses).toContain("fact type Person knows Person: ring is not expressible in Ossie");
    expect(result.constraintSpecs).toHaveLength(1);
    expect(result.constraintSpecs![0]!.pseudocode).toBe("for all x: not Person knows Person(x, x)");
  });

  it("writes a value constraint only in a shape the importer reads back", () => {
    const m = new OrmModel({ name: "M" });
    value(m, "Grade", { name: "text" }, { valueConstraint: { values: ["A", "It's"] } });
    value(m, "Lat", { name: "decimal" }, {
      valueConstraint: { values: [], ranges: [{ min: "-90", max: "90" }] },
    });
    value(m, "Mixed", { name: "integer" }, {
      valueConstraint: { values: ["0"], ranges: [{ min: "10", max: "20" }] },
    });
    value(m, "Day", { name: "date" }, {
      valueConstraint: { values: [], ranges: [{ min: "2020-01-01" }] },
    });
    const { document, losses } = exported(m);
    expect(concept(document, "Grade").requires).toEqual(["Grade == 'A' OR Grade == 'It''s'"]);
    expect(concept(document, "Lat").requires).toEqual(["Lat >= -90", "Lat <= 90"]);
    expect(concept(document, "Mixed").requires).toBeUndefined();
    expect(losses).toEqual([
      "Mixed: value constraint is not a shape Ossie's requires can state",
      "Day: value constraint is not a shape Ossie's requires can state",
    ]);
  });

  it("writes each data type as its built-in, naming the ones that are not exact", () => {
    const m = new OrmModel({ name: "M" });
    value(m, "Price", { name: "money" });
    value(m, "Stamp", { name: "timestamp" });
    value(m, "Code", { name: "text", length: 3 });
    value(m, "Blob", null);
    const { document, losses } = exported(m);
    expect(["Price", "Stamp", "Code", "Blob"].map((n) => concept(document, n).extends)).toEqual([
      ["Decimal"],
      ["DateTime"],
      ["String"],
      ["String"],
    ]);
    expect(losses).toEqual([
      "Price: data type money written as Decimal",
      "Stamp: data type timestamp written as DateTime",
      "Code: data type length or scale not written",
      "Blob: no data type; written as String",
    ]);
  });

  it("renames a concept the importer could not read back, and names the rename", () => {
    const m = new OrmModel({ name: "M" });
    entity(m, "Date");
    entity(m, "Order:Line");
    const { document, losses, result } = exported(m);
    expect(document.ontology.map((c) => c.concept)).toEqual(["Date_", "Order_Line"]);
    expect(losses).toContain("Date: written as Date_, a name Ossie can read back");
    expect(losses).toContain("Order:Line: written as Order_Line, a name Ossie can read back");
    expect(() => importer.parse(result.text)).not.toThrow();
  });

  it("names a mandatory role Ossie cannot state, a semiderived rule, brace text, and what the model holds beyond concepts", () => {
    const m = new OrmModel({ name: "M" });
    const code = value(m, "Code");
    const label = value(m, "Label");
    fact(m, "Code has Label", [code, label], "{0} has {1} {legacy}", { mandatory: [0] });
    const a = entity(m, "A");
    const ft = fact(m, "A is busy", [a], "{0} is busy");
    m.removeFactType(ft.id);
    m.addFactType({
      id: ft.id,
      name: ft.name,
      roles: ft.roles.map((r) => ({ id: r.id, name: r.name, playerId: r.playerId })),
      readings: ["{0} is busy"],
      derivation: { kind: "semiderived", expression: "A.load > 10" },
    });
    const { losses, document } = exported(m);
    expect(losses).toEqual(expect.arrayContaining([
      "fact type Code has Label: mandatory is not expressible in Ossie",
      'fact type Code has Label: reading "{0} has {1} {legacy}" has brace text, written with parentheses',
      "fact type A is busy: semiderived rule written as fully derived",
      "A: no identifier Ossie can state; reference mode id not written",
    ]));
    expect(relationship(document, "Code", "code_has_label").verbalizes).toEqual([
      "{Code} has {Label} (legacy)",
    ]);
  });

  it("writes extends in subtype-fact order, and names a flag or rule the importer would not rebuild", () => {
    const m = new OrmModel({ name: "M" });
    const party = entity(m, "Party");
    const taxpayer = entity(m, "Taxpayer");
    const person = entity(m, "Person");
    m.addSubtypeFact({
      id: "sf1",
      subtypeId: person.id,
      supertypeId: party.id,
      providesIdentification: true,
      definingRule: { kind: "derived", expression: "EXISTS (Party.x)" },
    });
    m.addSubtypeFact({
      id: "sf2",
      subtypeId: person.id,
      supertypeId: taxpayer.id,
      providesIdentification: true,
      definingRule: { kind: "derived", expression: "EXISTS (Taxpayer.y)" },
    });
    const { document, losses } = exported(m);
    expect(concept(document, "Person")).toMatchObject({
      extends: ["Party", "Taxpayer"],
      derived_by: ["EXISTS (Party.x)"],
    });
    expect(losses).toEqual(expect.arrayContaining([
      "Person -> Taxpayer: identification through the supertype not written as it is",
      "Person: its subtype facts' defining rules differ; only the first is written",
    ]));
    // Person is identified through Party, so no "no identifier" loss for it.
    expect(losses.some((l) => l.startsWith("Person: no identifier"))).toBe(false);
  });

  it("names what an object type and the model hold beyond what Ossie carries", () => {
    const m = new OrmModel({ name: "M", domainContext: "sales" });
    m.addObjectType({
      id: "c",
      name: "Customer",
      kind: "entity",
      referenceMode: "id",
      aliases: ["Client"],
      independent: true,
    });
    value(m, "Status", { name: "text" }, { defaultValue: "open" });
    const { losses } = exported(m);
    expect(losses).toEqual(expect.arrayContaining([
      "Customer: aliases Client not written",
      "Customer: independence not written",
      "Status: default value open not written",
      "model: domain context sales not written",
    ]));
  });

  it("does not write a composite identifier over a ring binary, which the importer refuses", () => {
    const m = new OrmModel({ name: "M" });
    const p = entity(m, "Person");
    const name = value(m, "Name");
    const byName = fact(m, "Person.name", [p, name], "{0} has {1}", { uc: [[0]] });
    const byParent = fact(m, "Person.parent", [p, p], "{0} has parent {1}", {
      uc: [[0]],
      roleNames: ["Person", "parent"],
    });
    m.addConstraint({
      type: "external_uniqueness",
      id: "ext",
      roleIds: [byName.roles[1]!.id, byParent.roles[1]!.id],
    });
    const { document, losses, result } = exported(m);
    expect(concept(document, "Person").identify_by).toBeUndefined();
    expect(losses).toContain("constraint ext: external_uniqueness is not expressible in Ossie");
    expect(() => importer.parse(result.text)).not.toThrow();
  });

  it("refuses a model with no concept to declare, rather than writing an invalid document", () => {
    expect(() => exporter.export(new OrmModel({ name: "Empty" }))).toThrow(
      /has no concept to declare/,
    );
  });

  it("names, and does not write, a note line the importer would read back differently", () => {
    const m = new OrmModel({ name: "M" });
    value(m, "Age", { name: "integer" }, {
      valueConstraint: { values: [], ranges: [{ min: "0" }] },
      note: "requires: Age <= 150\nrequires: \nrequires: Age % 2 == 0",
    });
    const a = m.addObjectType({
      id: "a",
      name: "A",
      kind: "entity",
      referenceMode: "id",
      note: "requires: A.label",
    });
    const label = value(m, "Label");
    fact(m, "A.label", [a, label], "{0} has {1}", { uc: [[0]] });
    const { document, losses, result } = exported(m);
    expect(concept(document, "Age").requires).toEqual(["Age >= 0", "Age % 2 == 0"]);
    expect(concept(document, "A").requires).toBeUndefined();
    expect(losses).toEqual(expect.arrayContaining([
      "Age: note line not written, it would read back as a constraint: requires: Age <= 150",
      "Age: note line not written: requires:",
      "A: note line not written, it would read back as a mandatory role: requires: A.label",
    ]));
    expect(() => importer.parse(result.text)).not.toThrow();
  });

  it("names a mix of supertypes with and without a defining rule, and a subtype rule's kind and storage", () => {
    const m = new OrmModel({ name: "M" });
    const [a, b, c] = [entity(m, "A"), entity(m, "B"), entity(m, "C")];
    m.addSubtypeFact({
      id: "s1",
      subtypeId: c.id,
      supertypeId: a.id,
      providesIdentification: true,
    });
    m.addSubtypeFact({
      id: "s2",
      subtypeId: c.id,
      supertypeId: b.id,
      providesIdentification: false,
      definingRule: { kind: "semiderived", storage: "derived_and_stored", expression: "x" },
    });
    const { document, losses } = exported(m);
    expect(concept(document, "C").derived_by).toBeUndefined();
    expect(losses).toEqual(expect.arrayContaining([
      "C: its subtype facts' defining rules differ; only the first is written",
      "C: semiderived defining rule written as fully derived",
      "C: stored defining rule written as on request",
    ]));
  });

  it("names a reference mode a composite identifier cannot carry", () => {
    const m = new OrmModel({ name: "M" });
    const p = entity(m, "Person", "pid");
    const [x, y] = [value(m, "X"), value(m, "Y")];
    const fx = fact(m, "Person.x", [p, x], "{0} has {1}", { uc: [[0]] });
    const fy = fact(m, "Person.y", [p, y], "{0} has {1}", { uc: [[0]] });
    m.addConstraint({
      type: "external_uniqueness",
      id: "pk",
      roleIds: [fx.roles[1]!.id, fy.roles[1]!.id],
    });
    const { document, losses } = exported(m);
    expect(concept(document, "Person").identify_by).toEqual(["x", "y"]);
    expect(losses).toContain("Person: reference mode pid not written");
  });

  it("does not write a built-in whose value type carries anything else, and names a fact type with no uniqueness", () => {
    const m = new OrmModel({ name: "M" });
    const s = value(m, "String", { name: "text" }, { aliases: ["Str"] });
    const a = entity(m, "A");
    fact(m, "A.tag", [a, s], "{0} is tagged {1}");
    const { document, losses } = exported(m);
    expect(document.ontology.map((c) => c.concept)).toEqual(["String_", "A"]);
    expect(losses).toEqual(expect.arrayContaining([
      "String: written as String_, a name Ossie can read back",
      "String: aliases Str not written",
      "fact type A.tag: has no uniqueness; Ossie's set semantics give it one spanning every role",
    ]));
  });

  it("keeps a relationship under a concept whose name holds a dot (rule 1, longest name)", () => {
    const text = `version: 0.2.0.dev0
name: T
ontology:
  - { concept: Org, type: EntityType, identify_by: [ nr ], relationships: [ { name: nr, roles: [ { concept: Integer } ], multiplicity: OneToOne, verbalizes: [ "{Org} has {Integer}" ] } ] }
  - concept: Org.Unit
    type: EntityType
    identify_by: [ code ]
    relationships:
      - { name: code, roles: [ { concept: String } ], multiplicity: OneToOne, verbalizes: [ "{Org.Unit} has {String}" ] }
      - { name: part_of, roles: [ { concept: Org } ], multiplicity: ManyToOne, verbalizes: [ "{Org.Unit} is part of {Org}" ] }
`;
    const { document } = exported(importer.parse(text).model);
    expect(relationship(document, "Org.Unit", "part_of")).toMatchObject({
      roles: [{ concept: "Org" }],
      verbalizes: ["{Org.Unit} is part of {Org}"],
    });
  });

  it("keeps the comment block one line per loss, whatever the lost text holds", () => {
    const m = new OrmModel({ name: "M" });
    entity(m, "A", "id");
    const ft = fact(m, "A ok", [m.getObjectTypeByName("A")!], "{0} is ok");
    m.removeFactType(ft.id);
    m.addFactType({
      id: ft.id,
      name: ft.name,
      roles: ft.roles.map((r) => ({ id: r.id, name: r.name, playerId: r.playerId })),
      readings: ["{0} is ok"],
      note: "legacy rule\nverbalizes: [x]",
    });
    const { result, document } = exported(m);
    // Parses, and the note's second line did not escape into the document.
    expect(Object.keys(document).sort()).toEqual(["name", "ontology", "version"]);
    expect(result.text).toContain(
      "# barwise: fact type A ok: note line not written: verbalizes: [x]",
    );
  });
});
