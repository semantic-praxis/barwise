/**
 * The Apache Ossie ontology importer
 * (`docs/specs/ossie-ontology-format.spec.md`, WS1): each mapping in the
 * spec's Scope against a small document, the version refusal, every
 * warning, and the pinned `flights.ontology.yaml`.
 */
import { type OrmModel, resolvePreferredIdentifier, ValidationEngine } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";
import { OssieImportError } from "../src/ossie/OssieTypes.js";

const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/ossie/flights.ontology.yaml",
);

const HEADER = "version: 0.2.0.dev0\nname: Test\n";

function load(body: string) {
  return new OssieImportFormat().parse(HEADER + body);
}

function factType(model: OrmModel, name: string) {
  const ft = model.getFactTypeByName(name);
  if (!ft) throw new Error(`no fact type ${name}`);
  return ft;
}

/** Each uniqueness on a fact type as the role names it spans. */
function uniquenesses(model: OrmModel, name: string): string[][] {
  const ft = factType(model, name);
  return ft.internalConstraints
    .filter((c) => c.type === "internal_uniqueness")
    .map((c) =>
      (c as { roleIds: readonly string[]; }).roleIds.map((id) =>
        ft.roles.find((r) => r.id === id)!.name
      )
    );
}

describe("Ossie import: concepts", () => {
  it("maps each built-in to its data type, through value-type chains", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: Nr, type: ValueType, extends: [ Integer ] }
  - { concept: Code, type: ValueType, extends: [ String ] }
  - { concept: Amount, type: ValueType, extends: [ Decimal ] }
  - { concept: Ratio, type: ValueType, extends: [ Float ] }
  - { concept: Flag, type: ValueType, extends: [ Boolean ] }
  - { concept: Day, type: ValueType, extends: [ Date ] }
  - { concept: At, type: ValueType, extends: [ DateTime ] }
  - { concept: Seats, type: ValueType, extends: [ Nr ] }
`);
    const dataType = (n: string) => {
      const ot = model.getObjectTypeByName(n);
      return ot?.kind === "value" ? ot.dataType?.name : undefined;
    };
    expect(["Nr", "Code", "Amount", "Ratio", "Flag", "Day", "At", "Seats"].map(dataType))
      .toEqual(["integer", "text", "decimal", "float", "boolean", "date", "datetime", "integer"]);
    expect(warnings).toEqual([
      "Seats: extends Nr; barwise has no value-type subtyping, so Seats takes the integer data type at the chain's root and the chain is not kept.",
    ]);
  });

  it("makes an entity type, with its description as the definition", () => {
    const { model } = load(`
ontology:
  - concept: Person
    type: EntityType
    description: Someone we know.
`);
    const person = model.getObjectTypeByName("Person")!;
    expect(person.kind).toBe("entity");
    expect(person.definition).toBe("Someone we know.");
  });

  it("creates a built-in a role names as a value type of that name", () => {
    const { model } = load(`
ontology:
  - concept: Person
    type: EntityType
    relationships:
      - { name: nick, roles: [ { concept: String } ], verbalizes: [ "{Person} has nick {String}" ] }
      - { name: alias, roles: [ { concept: String } ], verbalizes: [ "{Person} has alias {String}" ] }
`);
    const string = model.getObjectTypeByName("String")!;
    expect(string.kind === "value" && string.dataType?.name).toBe("text");
    // One value type for both roles, not one per use.
    expect(model.objectTypes.filter((o) => o.name === "String")).toHaveLength(1);
  });
});

describe("Ossie import: relationships", () => {
  const doc = `
ontology:
  - { concept: NrDays, type: ValueType, extends: [ Integer ] }
  - concept: Store
    type: EntityType
    relationships:
      - name: ships_to_in_days
        description: Shipping time between stores.
        roles: [ { concept: Store, name: destination }, { concept: NrDays } ]
        multiplicity: ManyToOne
        verbalizes: [ "{Store} ships to {Store:destination} in {NrDays}" ]
      - name: closed
        verbalizes: [ "{Store} is closed" ]
      - name: trades_with
        roles: [ { concept: Store, name: partner } ]
        verbalizes: [ "{Store} trades with {Store:partner}", "{Store:partner} trades with {Store}" ]
      - name: twin
        roles: [ { concept: Store, name: other } ]
        multiplicity: OneToOne
        verbalizes: [ "{Store} is twinned with {Store:other}" ]
`;

  it("puts the containing concept on the first role and keeps role names", () => {
    const { model } = load(doc);
    const ft = factType(model, "Store.ships_to_in_days");
    expect(ft.roles.map((r) => [r.name, model.getObjectType(r.playerId)!.name])).toEqual([
      ["Store", "Store"],
      ["destination", "Store"],
      ["NrDays", "NrDays"],
    ]);
    expect(ft.definition).toBe("Shipping time between stores.");
  });

  it("turns each verbalization into a reading, placeholders into role positions", () => {
    const { model } = load(doc);
    expect(factType(model, "Store.ships_to_in_days").readings.map((r) => r.template))
      .toEqual(["{0} ships to {1} in {2}"]);
    expect(factType(model, "Store.trades_with").readings.map((r) => r.template))
      .toEqual(["{0} trades with {1}", "{1} trades with {0}"]);
    expect(factType(model, "Store.closed").readings.map((r) => r.template)).toEqual([
      "{0} is closed",
    ]);
  });

  it("reads ManyToOne as uniqueness over all roles but the last", () => {
    expect(uniquenesses(load(doc).model, "Store.ships_to_in_days")).toEqual([[
      "Store",
      "destination",
    ]]);
  });

  it("reads OneToOne as a uniqueness on each role of a binary", () => {
    expect(uniquenesses(load(doc).model, "Store.twin")).toEqual([["Store"], ["other"]]);
  });

  it("reads no multiplicity as a uniqueness spanning every role (set semantics)", () => {
    const { model } = load(doc);
    expect(uniquenesses(model, "Store.trades_with")).toEqual([["Store", "partner"]]);
    expect(uniquenesses(model, "Store.closed")).toEqual([["Store"]]);
  });

  it("carries derived_by as a fact type's derivation rule", () => {
    const { model } = load(`
ontology:
  - concept: Person
    type: EntityType
    relationships:
      - name: ancestor_of
        roles: [ { concept: Person, name: descendant } ]
        derived_by: [ "Person.parent_of(descendant)", "Person.ancestor_of.parent_of(descendant)" ]
        verbalizes: [ "{Person} is an ancestor of {Person:descendant}" ]
`);
    expect(factType(model, "Person.ancestor_of").derivation).toEqual({
      kind: "derived",
      expression: "Person.parent_of(descendant)\n\nPerson.ancestor_of.parent_of(descendant)",
    });
  });

  it("refuses a verbalization placeholder that names no role", () => {
    expect(() =>
      load(`
ontology:
  - concept: Person
    type: EntityType
    relationships:
      - { name: walks, verbalizes: [ "{Dog} walks" ] }
`)
    ).toThrow(/names \{Dog\}, which is no role/);
  });

  it("refuses a role played by a concept the ontology does not declare", () => {
    expect(() =>
      load(`
ontology:
  - concept: Person
    type: EntityType
    relationships:
      - { name: owns, roles: [ { concept: Dog } ], verbalizes: [ "{Person} owns {Dog}" ] }
`)
    ).toThrow(/names concept Dog, which the ontology does not declare/);
  });
});

describe("Ossie import: subtypes and identifiers", () => {
  it("makes a subtype fact per supertype, ignoring the implicit Any", () => {
    const { model } = load(`
ontology:
  - { concept: Party, type: EntityType }
  - { concept: Taxpayer, type: EntityType }
  - concept: Person
    type: EntityType
    extends: [ Any, Party, Taxpayer ]
    derived_by: [ "EXISTS ( Party.files )" ]
`);
    const facts = model.subtypeFacts.map((sf) => ({
      sup: model.getObjectType(sf.supertypeId)!.name,
      ident: sf.providesIdentification,
      rule: sf.definingRule?.expression,
    }));
    expect(facts).toEqual([
      { sup: "Party", ident: true, rule: "EXISTS ( Party.files )" },
      { sup: "Taxpayer", ident: false, rule: "EXISTS ( Party.files )" },
    ]);
  });

  it("keeps an entity's derived_by in its note when it has no supertype to hold it", () => {
    const { model, warnings } = load(`
ontology:
  - concept: Employee
    type: EntityType
    derived_by: [ "EXISTS ( Employee.earns )" ]
`);
    expect(model.getObjectTypeByName("Employee")!.note).toBe(
      "derived_by: EXISTS ( Employee.earns )",
    );
    expect(warnings).toEqual([
      "Employee: derived_by on an entity type with no supertype is kept in the note: EXISTS ( Employee.earns )",
      "no identify_by and no supertype, so nothing identifies them; each is given a reference mode no relationship carries: Employee.",
    ]);
  });

  it("names the uniqueness on a single identifying relationship's far role as the preferred identifier", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: Carrier
    type: EntityType
    identify_by: [ code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: OneToOne, verbalizes: [ "{Carrier} uses {Code}" ] }
`);
    const ft = factType(model, "Carrier.code");
    const carrier = model.getObjectTypeByName("Carrier")!;
    const preferred = ft.internalConstraints.find((c) =>
      c.id === model.preferredIdentifierOf(carrier.id)
    );
    expect(preferred).toMatchObject({ type: "internal_uniqueness", roleIds: [ft.roles[1]!.id] });
    expect(warnings).toEqual([]);
  });

  it("adds the far-role uniqueness identify_by implies when the multiplicity did not state it", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: Carrier
    type: EntityType
    identify_by: [ code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: ManyToOne, verbalizes: [ "{Carrier} uses {Code}" ] }
`);
    expect(uniquenesses(model, "Carrier.code")).toEqual([["Carrier"], ["Code"]]);
    expect(model.preferredIdentifierOf(model.getObjectTypeByName("Carrier")!.id)).toBeDefined();
    expect(warnings).toEqual([
      "Carrier: identify_by code implies each Code identifies at most one Carrier; added that uniqueness, which the multiplicity did not state.",
    ]);
  });

  it("stores a composite identifier as an external uniqueness and names it preferred", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: Name, type: ValueType, extends: [ String ] }
  - { concept: State, type: EntityType }
  - concept: City
    type: EntityType
    identify_by: [ name, state ]
    relationships:
      - { name: name, roles: [ { concept: Name } ], multiplicity: ManyToOne, verbalizes: [ "{City} has {Name}" ] }
      - { name: state, roles: [ { concept: State } ], multiplicity: ManyToOne, verbalizes: [ "{City} is in {State}" ] }
`);
    const external = model.constraints.find((c) => c.type === "external_uniqueness");
    expect(external).toMatchObject({
      roleIds: [
        factType(model, "City.name").roles[1]!.id,
        factType(model, "City.state").roles[1]!.id,
      ],
    });
    // ManyToOne already makes each City's role unique, so nothing is added
    // (external-preferred-identifier.spec.md, WS2).
    expect(model.preferredIdentifierOf(model.getObjectTypeByName("City")!.id)).toBe(external!.id);
    expect(warnings).toEqual([
      "no identify_by and no supertype, so nothing identifies them; each is given a reference mode no relationship carries: State.",
    ]);
  });

  it("adds the uniqueness identify_by implies on a component the multiplicity left open", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: Name, type: ValueType, extends: [ String ] }
  - { concept: State, type: EntityType, identify_by: [ code ], relationships: [ { name: code, roles: [ { concept: Name } ], multiplicity: OneToOne, verbalizes: [ "{State} has code {Name}" ] } ] }
  - concept: City
    type: EntityType
    identify_by: [ name, state ]
    relationships:
      - { name: name, roles: [ { concept: Name } ], verbalizes: [ "{City} has {Name}" ] }
      - { name: state, roles: [ { concept: State } ], multiplicity: ManyToOne, verbalizes: [ "{City} is in {State}" ] }
`);
    const city = model.getObjectTypeByName("City")!.id;
    const near = factType(model, "City.name").roles[0]!.id;
    expect(
      factType(model, "City.name").internalConstraints.some((c) =>
        c.type === "internal_uniqueness" && c.roleIds.length === 1 && c.roleIds[0] === near
      ),
    ).toBe(true);
    expect(resolvePreferredIdentifier(model, city).ok).toBe(true);
    expect(warnings).toContain(
      "City: identify_by [name, state] implies each City has at most one name; added that uniqueness, which the multiplicity did not state.",
    );
  });
});

/** Each mandatory on a fact type as the role name it constrains, with its modality. */
function mandatories(model: OrmModel, name: string): string[] {
  const ft = factType(model, name);
  return ft.internalConstraints.flatMap((c) =>
    c.type === "mandatory"
      ? [`${ft.roles.find((r) => r.id === c.roleId)!.name}:${c.modality ?? "alethic"}`]
      : []
  );
}

describe("Ossie import: identify_by makes its roles mandatory", () => {
  // ossie-identifier-implies-mandatory.spec.md, barwise-3ik.
  it("makes the concept's role of a single identifying relationship mandatory, without a warning", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: Carrier
    type: EntityType
    identify_by: [ code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: OneToOne, verbalizes: [ "{Carrier} has {Code}" ] }
`);
    expect(mandatories(model, "Carrier.code")).toEqual(["Carrier:alethic"]);
    expect(warnings).toEqual([]);
  });

  it("makes each component of a composite identifier mandatory", () => {
    const { model } = load(`
ontology:
  - { concept: Name, type: ValueType, extends: [ String ] }
  - { concept: State, type: EntityType, identify_by: [ code ], relationships: [ { name: code, roles: [ { concept: Name } ], multiplicity: OneToOne, verbalizes: [ "{State} has code {Name}" ] } ] }
  - concept: City
    type: EntityType
    identify_by: [ name, state ]
    relationships:
      - { name: name, roles: [ { concept: Name } ], multiplicity: ManyToOne, verbalizes: [ "{City} has {Name}" ] }
      - { name: state, roles: [ { concept: State } ], multiplicity: ManyToOne, verbalizes: [ "{City} is in {State}" ] }
`);
    expect(mandatories(model, "City.name")).toEqual(["City:alethic"]);
    expect(mandatories(model, "City.state")).toEqual(["City:alethic"]);
  });

  it("adds no second mandatory when requires already states it", () => {
    const { model } = load(`
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: Party
    type: EntityType
    identify_by: [ code ]
    requires: [ Party.code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: OneToOne, verbalizes: [ "{Party} has {Code}" ] }
`);
    expect(mandatories(model, "Party.code")).toEqual(["Party:alethic"]);
  });

  it("leaves the pinned flights example with no optional identifier", () => {
    const { model } = new OssieImportFormat().parse(readFileSync(fixture, "utf8"));
    const optional = new ValidationEngine().validate(model)
      .filter((d) => d.ruleId === "completeness/preferred-identifier-optional");
    expect(optional).toEqual([]);
  });
});

describe("Ossie import: requires", () => {
  it("reads an enumeration and a range as a value constraint, either operand order", () => {
    const { model, warnings } = load(`
ontology:
  - concept: Grade
    type: ValueType
    extends: [ String ]
    requires: [ "Grade == 'A' OR Grade == 'B' OR Grade == 'It''s'" ]
  - concept: Lat
    type: ValueType
    extends: [ Decimal ]
    requires: [ "Lat <= 90", "-90 < Lat" ]
`);
    const vc = (n: string) => {
      const ot = model.getObjectTypeByName(n)!;
      return ot.kind === "value" ? ot.valueConstraint : undefined;
    };
    expect(vc("Grade")).toEqual({ values: ["A", "B", "It's"] });
    expect(vc("Lat")).toEqual({
      values: [],
      ranges: [{ max: "90", maxInclusive: true, min: "-90", minInclusive: false }],
    });
    expect(warnings).toEqual([]);
  });

  it("never combines an enumeration with another item: the items all hold, a value constraint's are alternatives", () => {
    const { model, warnings } = load(`
ontology:
  - concept: G
    type: ValueType
    extends: [ String ]
    requires: [ "G >= 3", "G == '1' OR G == '5'", "G == '5' OR G == '7'" ]
`);
    const g = model.getObjectTypeByName("G")!;
    expect(g.kind === "value" && g.valueConstraint).toEqual({ values: ["1", "5"] });
    expect(g.note).toBe("requires: G >= 3\nrequires: G == '5' OR G == '7'");
    expect(warnings).toEqual([
      "G: requires is not carried as a constraint (kept in the note): G >= 3",
      "G: requires is not carried as a constraint (kept in the note): G == '5' OR G == '7'",
    ]);
  });

  it("keeps bounds no value meets as text, not as a range that refuses everything", () => {
    const { model, warnings } = load(`
ontology:
  - { concept: X, type: ValueType, extends: [ Integer ], requires: [ "X >= 10", "X < 5" ] }
`);
    const x = model.getObjectTypeByName("X")!;
    expect(x.kind === "value" && x.valueConstraint).toBeUndefined();
    expect(x.note).toBe("requires: X >= 10\nrequires: X < 5");
    expect(warnings).toEqual([
      "X: the bounds X >= 10, X < 5 admit no value; kept in the note rather than stored as a constraint nothing satisfies.",
    ]);
  });

  it("writes a multi-line expression as one line, in the note and the warning", () => {
    const { model, warnings } = load(`
ontology:
  - concept: Trip
    type: EntityType
    identify_by: [ id ]
    relationships:
      - { name: id, roles: [ { concept: String } ], multiplicity: OneToOne, verbalizes: [ "{Trip} has id {String}" ] }
      - name: ends
        roles: [ { concept: DateTime } ]
        requires:
          - |
            Trip.ends > Trip.starts
              AND Trip.ends < NOW()
        verbalizes: [ "{Trip} ends at {DateTime}" ]
`);
    expect(factType(model, "Trip.ends").note).toBe(
      "requires: Trip.ends > Trip.starts AND Trip.ends < NOW()",
    );
    expect(warnings).toEqual([
      "Trip.ends: requires is not carried as a constraint (kept in the note): Trip.ends > Trip.starts AND Trip.ends < NOW()",
    ]);
  });

  it("keeps what the model stores exactly: an enumeration's literals and a derivation's lines", () => {
    const { model } = load(`
ontology:
  - concept: City
    type: ValueType
    extends: [ String ]
    requires: [ "City == 'New  York' OR City == 'Rome'" ]
  - concept: Flight
    type: EntityType
    identify_by: [ id ]
    relationships:
      - { name: id, roles: [ { concept: String } ], multiplicity: OneToOne, verbalizes: [ "{Flight} has id {String}" ] }
      - name: late
        derived_by:
          - |
            EXISTS (SELECT 1 -- delayed only
              WHERE Flight.delay > 0)
        verbalizes: [ "{Flight} is late" ]
`);
    const city = model.getObjectTypeByName("City")!;
    expect(city.kind === "value" && city.valueConstraint).toEqual({
      values: ["New  York", "Rome"],
    });
    // The line end ends the SQL comment; one line would comment out the WHERE.
    expect(factType(model, "Flight.late").derivation?.expression)
      .toBe("EXISTS (SELECT 1 -- delayed only\n  WHERE Flight.delay > 0)\n");
  });

  it("reads a bare Entity.rel as a mandatory first role", () => {
    const { model } = load(`
ontology:
  - { concept: Lat, type: ValueType, extends: [ Decimal ] }
  - concept: Airport
    type: EntityType
    requires: [ Airport.latitude, Airport.latitude ]
    relationships:
      - { name: latitude, roles: [ { concept: Lat } ], multiplicity: ManyToOne, verbalizes: [ "{Airport} is at {Lat}" ] }
`);
    const ft = factType(model, "Airport.latitude");
    // Stated twice in the document, one constraint in the model.
    expect(ft.internalConstraints.filter((c) => c.type === "mandatory"))
      .toEqual([expect.objectContaining({ roleId: ft.roles[0]!.id })]);
  });

  it("keeps every other requires expression in the note and names it", () => {
    const { model, warnings } = load(`
ontology:
  - concept: Size
    type: ValueType
    extends: [ Integer ]
    requires: [ "Size % 2 == 0", "Size >= 1", "Size >= 2" ]
  - concept: Trip
    type: EntityType
    requires: [ "COUNT[Trip] > 0", Trip.nowhere ]
    relationships:
      - name: starts
        roles: [ { concept: DateTime } ]
        requires: [ "Trip.starts < NOW()" ]
        verbalizes: [ "{Trip} starts at {DateTime}" ]
`);
    expect(model.getObjectTypeByName("Size")!.note).toBe(
      "requires: Size % 2 == 0\nrequires: Size >= 2",
    );
    expect(model.getObjectTypeByName("Trip")!.note).toBe(
      "requires: COUNT[Trip] > 0\nrequires: Trip.nowhere",
    );
    expect(factType(model, "Trip.starts").note).toBe("requires: Trip.starts < NOW()");
    expect(warnings).toEqual([
      "Size: requires is not carried as a constraint (kept in the note): Size % 2 == 0",
      "Size: requires is not carried as a constraint (kept in the note): Size >= 2",
      "Trip: requires is not carried as a constraint (kept in the note): COUNT[Trip] > 0",
      "Trip: requires is not carried as a constraint (kept in the note): Trip.nowhere",
      "Trip.starts: requires is not carried as a constraint (kept in the note): Trip.starts < NOW()",
      "no identify_by and no supertype, so nothing identifies them; each is given a reference mode no relationship carries: Trip.",
    ]);
  });
});

describe("Ossie import: the model, readings and reference modes", () => {
  it("names the model after the ontology, with its description as the note, unless the caller names it", () => {
    const text = HEADER.replace("name: Test", "name: Flights\ndescription: Ontology of flights.")
      + "ontology:\n  - { concept: Airport, type: EntityType }\n";
    const own = new OssieImportFormat().parse(text).model;
    expect([own.name, own.note]).toEqual(["Flights", "Ontology of flights."]);
    // The ontology-level requires has nowhere else to live.
    const withRequires = new OssieImportFormat().parse(
      text.replace("ontology:", 'requires: [ "COUNT[Airport] > 0" ]\nontology:'),
    ).model;
    expect(withRequires.note).toBe("Ontology of flights.\nrequires: COUNT[Airport] > 0");
    expect(new OssieImportFormat().parse(text, { modelName: "mine" }).model.name).toBe("mine");
  });

  it("reads a blank description as absent", () => {
    const { model } = load(`
ontology:
  - concept: Airport
    type: EntityType
    description:
    relationships:
      - { name: closed, description: "", verbalizes: [ "{Airport} is closed" ] }
`);
    expect(model.getObjectTypeByName("Airport")!.definition).toBeUndefined();
    expect(factType(model, "Airport.closed").definition).toBeUndefined();
  });

  it("reads {Concept} as the only role that concept plays, even when the role is named", () => {
    const { model } = load(`
ontology:
  - { concept: Airport, type: EntityType }
  - concept: Flight
    type: EntityType
    relationships:
      - { name: origin, roles: [ { concept: Airport, name: from } ], verbalizes: [ "{Flight} departs from {Airport}" ] }
`);
    expect(factType(model, "Flight.origin").readings.map((r) => r.template)).toEqual([
      "{0} departs from {1}",
    ]);
  });

  it("refuses a pattern that names one role twice and so leaves another out", () => {
    expect(() =>
      load(`
ontology:
  - concept: Person
    type: EntityType
    relationships:
      - { name: manages, roles: [ { concept: Person, name: report } ], verbalizes: [ "{Person} manages {Person}" ] }
`)
    ).toThrow(/leaves out the role report/);
  });

  it("takes an entity's reference mode from its single identifying relationship, else <snake_name>_id", () => {
    const { model } = load(`
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: Carrier
    type: EntityType
    identify_by: [ code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: OneToOne, verbalizes: [ "{Carrier} uses {Code}" ] }
  - { concept: FlightLeg, type: EntityType }
`);
    const mode = (n: string) => {
      const ot = model.getObjectTypeByName(n)!;
      return ot.kind === "entity" ? ot.referenceMode : undefined;
    };
    expect([mode("Carrier"), mode("FlightLeg")]).toEqual(["code", "flight_leg_id"]);
  });

  it("keeps a hyphen-bound reading as written, and warns only about a hyphen that binds nothing", () => {
    // barwise applies ORM's hyphen binding (reading-hyphen-binding.spec.md),
    // so "departure- {Delay}" needs no warning; "minutes-" at the end binds
    // to nothing.
    const { model, warnings } = load(`
ontology:
  - { concept: Delay, type: ValueType, extends: [ Decimal ] }
  - concept: Flight
    type: EntityType
    relationships:
      - { name: dep, roles: [ { concept: Delay } ], multiplicity: ManyToOne, verbalizes: [ "{Flight} has departure- {Delay}" ] }
      - { name: late, roles: [ { concept: Delay } ], multiplicity: ManyToOne, verbalizes: [ "{Flight} is late by {Delay} minutes-" ] }
`);
    expect(factType(model, "Flight.dep").readings.map((r) => r.template)).toEqual([
      "{0} has departure- {1}",
    ]);
    expect(warnings).toEqual([
      'Flight.late: reading "{Flight} is late by {Delay} minutes-" has a hyphen that binds nothing; a word ending in a hyphen binds to the role player that follows it. Kept as written.',
      "no identify_by and no supertype, so nothing identifies them; each is given a reference mode no relationship carries: Flight.",
    ]);
  });
});

describe("Ossie import: malformed documents", () => {
  const refuses = (body: string, message: RegExp) => () => {
    expect(() => load(body)).toThrow(OssieImportError);
    expect(() => load(body)).toThrow(message);
  };

  it(
    "a relationship name repeated on one concept",
    refuses(
      `
ontology:
  - concept: A
    type: EntityType
    relationships:
      - { name: x, verbalizes: [ "{A} is x" ] }
      - { name: x, verbalizes: [ "{A} is also x" ] }
`,
      /A declares relationship x twice/,
    ),
  );

  it(
    "an entity extending itself",
    refuses(
      "ontology:\n  - { concept: A, type: EntityType, extends: [ A ] }\n",
      /A extends itself/,
    ),
  );

  it(
    "an entity extending a value type",
    refuses(
      `
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - { concept: A, type: EntityType, extends: [ Code ] }
`,
      /A extends Code, which is not a declared entity type/,
    ),
  );

  it(
    "an extends cycle",
    refuses(
      `
ontology:
  - { concept: A, type: EntityType, extends: [ B ] }
  - { concept: B, type: EntityType, extends: [ A ] }
`,
      /extends forms a cycle: A -> B -> A/,
    ),
  );

  it(
    "identify_by naming a relationship the entity does not itself declare",
    refuses(
      `
ontology:
  - { concept: Nr, type: ValueType, extends: [ Integer ] }
  - concept: Person
    type: EntityType
    relationships:
      - { name: nr, roles: [ { concept: Nr } ], multiplicity: OneToOne, verbalizes: [ "{Person} has {Nr}" ] }
  - { concept: Employee, type: EntityType, extends: [ Person ], identify_by: [ nr ] }
`,
      /Employee: identify_by names nr, which Employee does not itself declare/,
    ),
  );

  it(
    "identify_by naming a relationship that is not binary",
    refuses(
      `
ontology:
  - concept: A
    type: EntityType
    identify_by: [ flag ]
    relationships:
      - { name: flag, verbalizes: [ "{A} is flagged" ] }
`,
      /identify_by names flag, which is not binary/,
    ),
  );

  it(
    "identify_by listing a relationship twice",
    refuses(
      `
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
  - concept: A
    type: EntityType
    identify_by: [ code, code ]
    relationships:
      - { name: code, roles: [ { concept: Code } ], multiplicity: OneToOne, verbalizes: [ "{A} has {Code}" ] }
`,
      /A: identify_by lists a relationship twice/,
    ),
  );

  it(
    "identify_by naming a ring relationship",
    refuses(
      `
ontology:
  - concept: Person
    type: EntityType
    identify_by: [ twin ]
    relationships:
      - { name: twin, roles: [ { concept: Person, name: other } ], multiplicity: OneToOne, verbalizes: [ "{Person} is the twin of {Person:other}" ] }
`,
      /Person: identify_by names twin, which relates Person to itself/,
    ),
  );

  it(
    "a value type whose later supertype is not a value type",
    refuses(
      `
ontology:
  - { concept: Flight, type: EntityType }
  - { concept: Code, type: ValueType, extends: [ String, Flight ] }
`,
      /Code extends Flight, which is not a declared value type/,
    ),
  );

  it(
    "a value type naming itself as a later supertype",
    refuses(
      "ontology:\n  - { concept: Code, type: ValueType, extends: [ String, Code ] }\n",
      /Code extends itself/,
    ),
  );

  it(
    "an empty verbalizes",
    refuses(
      `
ontology:
  - concept: A
    type: EntityType
    relationships:
      - { name: x, verbalizes: [] }
`,
      /A.x: verbalizes lists no reading/,
    ),
  );

  it(
    "a pattern that leaves a role out",
    refuses(
      `
ontology:
  - concept: A
    type: EntityType
    relationships:
      - { name: at, roles: [ { concept: DateTime } ], verbalizes: [ "{A} happened" ] }
`,
      /leaves out the role DateTime/,
    ),
  );

  it(
    "a value type that reaches no built-in",
    refuses(
      `
ontology:
  - { concept: A, type: EntityType }
  - { concept: Code, type: ValueType, extends: [ A ] }
`,
      /Code extends A, which is not a declared value type/,
    ),
  );

  it(
    "an unknown multiplicity",
    refuses(
      `
ontology:
  - concept: A
    type: EntityType
    relationships:
      - { name: x, roles: [ { concept: String } ], multiplicity: ManyToMany, verbalizes: [ "{A} has {String}" ] }
`,
      /multiplicity must be ManyToOne or OneToOne/,
    ),
  );
});

describe("Ossie import: what the export could not split back", () => {
  it("names a derived_by item holding a blank line, and a description line the export would misread", () => {
    const text =
      HEADER.replace("name: Test", "name: T\ndescription: |\n  Flights.\n  requires: none")
      + `ontology:
  - concept: Person
    type: EntityType
    identify_by: [ nr ]
    relationships:
      - { name: nr, roles: [ { concept: Integer } ], multiplicity: OneToOne, verbalizes: [ "{Person} has {Integer}" ] }
      - name: old
        derived_by:
          - |
            EXISTS (SELECT 1

              WHERE Person.age > 90)
        verbalizes: [ "{Person} is old" ]
`;
    expect(new OssieImportFormat().parse(text).warnings).toEqual([
      "Person.old: a derived_by expression holds a blank line, where the export splits items; it will be written back as more than one.",
      'description: a line begins "requires:", which the export would read as an ontology requires.',
    ]);
  });
});

describe("Ossie import: refusals and warnings", () => {
  it("refuses a version other than the pinned one, naming both", () => {
    expect(() => new OssieImportFormat().parse("version: 0.3.0\nname: X\nontology: []\n")).toThrow(
      new OssieImportError(
        'Ossie version "0.3.0" is not supported; barwise reads version 0.2.0.dev0 only.',
      ),
    );
  });

  it("names what a value type's chain and declarations lose", () => {
    const { warnings } = load(`
ontology:
  - { concept: Lat, type: ValueType, extends: [ Decimal ], requires: [ "Lat <= 90" ] }
  - { concept: MyLat, type: ValueType, extends: [ Lat, Float ], identify_by: [ x ] }
`);
    expect(warnings).toEqual([
      "MyLat: identify_by on a value type is not carried; a value identifies itself.",
      "MyLat: extends Lat, Float; barwise keeps one data type, from Lat.",
      "MyLat: extends Lat; barwise has no value-type subtyping, so MyLat takes the decimal data type at the chain's root and the chain is not kept.",
      "MyLat: inherits Lat's requires, which the flattened type does not carry: Lat <= 90",
    ]);
  });

  it("names everything the model cannot carry", () => {
    const { warnings, confidence } = load(`
prefixes: { ex: "http://example.com/" }
ai_context: Airline data.
requires: [ "COUNT[Person] > 0" ]
ontology_mappings: []
ontology:
  - concept: Person
    type: EntityType
    iri: ex:Person
    relationships:
      - { name: walks, iri: ex:walks, verbalizes: [ "{Person} walks" ] }
`);
    expect(warnings).toEqual([
      "prefixes: barwise has no field for namespace prefixes; dropped.",
      "ai_context: barwise has no field for AI context; dropped.",
      "ontology_mappings: embedded mappings (deprecated in Ossie) are not imported; dropped.",
      "requires on the ontology is not carried as a constraint (kept in the model's note): COUNT[Person] > 0",
      "Person: iri ex:Person dropped; barwise has no field for IRIs.",
      "Person.walks: iri ex:walks dropped; barwise has no field for IRIs.",
      "no identify_by and no supertype, so nothing identifies them; each is given a reference mode no relationship carries: Person.",
    ]);
    expect(confidence).toBe("medium");
  });
});

describe("Ossie import: fields the pinned schema does not define", () => {
  // docs/specs/ossie-unknown-fields.spec.md: each is named by path, and the
  // rest of the document imports as it would without it.
  const unknown = (path: string) =>
    `${path}: the Ossie 0.2.0.dev0 schema defines no such field; ignored.`;

  it("names one at the top level, in a concept, a relationship and a role", () => {
    const { model, warnings, confidence } = load(`
colour: blue
ontology:
  - concept: Person
    type: EntityType
    shoe_size: 42
    identify_by: [ has_name ]
    relationships:
      - name: has_name
        multiplicity: OneToOne
        cardinality: 1
        roles:
          - { concept: Name, nickname: n }
        verbalizes: [ "{Person} has {Name}" ]
  - { concept: Name, type: ValueType, extends: [ String ] }
`);
    expect(warnings).toEqual([
      unknown("colour"),
      unknown("concept Person.shoe_size"),
      unknown("concept Person.relationships[0].cardinality"),
      unknown("concept Person.relationships[0].roles[0].nickname"),
    ]);
    expect(confidence).toBe("medium");
    // The rest of the document imported as written.
    expect(model.getObjectTypeByName("Person")?.kind).toBe("entity");
    expect(factType(model, "Person.has_name").readings.map((r) => r.template))
      .toEqual(["{0} has {1}"]);
  });

  it("names one inside ontology_mappings too, beside the block's own drop", () => {
    const { warnings } = load(`
ontology_mappings:
  - { name: m, semantic_model: {}, concept_mappings: [], extra: 1 }
ontology:
  - { concept: Code, type: ValueType, extends: [ String ] }
`);
    expect(warnings).toEqual([
      unknown("ontology_mappings[0].extra"),
      "ontology_mappings: embedded mappings (deprecated in Ossie) are not imported; dropped.",
    ]);
  });

  it("brackets a key that is not a plain identifier, so it cannot read as an index", () => {
    const { warnings } = load(`
ontology:
  - concept: Code
    type: ValueType
    extends: [ String ]
    "a/b~c": 1
    0: zero
`);
    expect(warnings).toEqual([
      unknown(`concept Code["0"]`),
      unknown(`concept Code["a/b~c"]`),
    ]);
  });

  it("quotes a concept name that is not a plain identifier, so its dots are not path steps", () => {
    const { warnings } = load(`
ontology:
  - { concept: "x.y", type: ValueType, extends: [ String ], z: 1 }
`);
    expect(warnings).toEqual([unknown(`concept "x.y".z`)]);
  });
});

describe("Ossie import: the pinned flights example", () => {
  const { model, warnings } = new OssieImportFormat().parse(readFileSync(fixture, "utf8"));

  it("validates with no errors", () => {
    const errors = new ValidationEngine().validate(model).filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("imports every concept and relationship", () => {
    // 44 declared concepts plus the four built-ins roles name (String, Integer,
    // DateTime, Date); 58 relationships. Counted from the fixture:
    // `grep -c "^- concept:"` and `grep -cE "^\s+- name:"`.
    expect(model.objectTypes).toHaveLength(48);
    expect(model.factTypes).toHaveLength(58);
  });

  // The full list, so a change to what is carried is a visible diff here.
  it("names exactly what it could not carry", () => {
    expect(warnings).toEqual([
      "requires on the ontology is not carried as a constraint (kept in the model's note): COUNT[Airport] > 0",
      "requires on the ontology is not carried as a constraint (kept in the model's note): COUNT[Carrier] > 0",
      "Capacity: extends NrPounds; barwise has no value-type subtyping, so Capacity takes the integer data type at the chain's root and the chain is not kept.",
      "Delay: extends NrMinutes; barwise has no value-type subtyping, so Delay takes the decimal data type at the chain's root and the chain is not kept.",
      "Distance: extends NrMiles; barwise has no value-type subtyping, so Distance takes the decimal data type at the chain's root and the chain is not kept.",
      "RunwayGeometry: extends Polygon; barwise has no value-type subtyping, so RunwayGeometry takes the text data type at the chain's root and the chain is not kept.",
      "RunwayLength: extends NrFeet; barwise has no value-type subtyping, so RunwayLength takes the decimal data type at the chain's root and the chain is not kept.",
      "Flight.scheduled_departure: requires is not carried as a constraint (kept in the note): Flight.scheduled_departure < Flight.scheduled_arrival",
      "Flight.departs_at: requires is not carried as a constraint (kept in the note): Flight.departs_at < Flight.arrives_at",
      "Flight.aircraft: requires is not carried as a constraint (kept in the note): Flight.operated_by(Aircraft.carrier)",
      "Route.destination: requires is not carried as a constraint (kept in the note): NOT Route.departure(Airport)",
      "Route.departure: requires is not carried as a constraint (kept in the note): NOT Route.destination(Airport)",
    ]);
  });
});
