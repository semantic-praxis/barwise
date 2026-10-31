/**
 * The 3.x replay into format 4.0 (iri-identity WS6, 6b-2b-2a): every
 * tracked model replays to one that states the same things -- the same
 * elements, readings, constraints over the same roles, populations and
 * diagrams -- under new ids. Checked by writing the replayed model as a 3.0
 * document, mapping each id-bearing field back through the model's prior
 * ids, and requiring the document the original model writes. Only fields
 * that hold ids are mapped, so a name equal to some new id stays a name.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { LOCAL_NAME_PATTERN, REFERENCE_PATTERN, ROLE_ID_PATTERN } from "../../src/model/name.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer, writeDocument } from "../../src/serialization/OrmYamlSerializer.js";
import { replayInto40 } from "../../src/serialization/replay.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

/** Fields whose string value, or each string in whose list, is an id. */
const ID_FIELDS = new Set([
  "id",
  "player",
  "subtype",
  "supertype",
  "fact_type",
  "object_type",
  "preferred_identifier",
  "role",
  "roles",
  "role_1",
  "role_2",
  "roles_1",
  "roles_2",
  "subset_roles",
  "superset_roles",
  "subtype_facts",
  "elements",
  "root",
  "entry",
  "exit",
]);
/** Fields whose object's keys are ids. */
const ID_KEYED = new Set(["role_values", "positions", "orientations"]);

function mapIds(value: unknown, back: (id: string) => string, field?: string): unknown {
  if (typeof value === "string") {
    return field !== undefined && ID_FIELDS.has(field)
      ? back(value)
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapIds(v, back, field));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        field !== undefined && ID_KEYED.has(field) ? back(k) : k,
        mapIds(v, back, k),
      ]),
    );
  }
  return value;
}

/** Each old id to the id it now has, from the model's map back. */
const oldToNew = (model: OrmModel) => new Map([...model.priorIds!].map(([now, old]) => [old, now]));

const asText = (model: OrmModel) => JSON.parse(JSON.stringify(writeDocument(model)));

describe("replaying a 3.x model into format 4.0", () => {
  const corpus = modelCorpus();

  it("reads the corpus", () => {
    expect(corpus.length).toBeGreaterThan(40);
  });

  it.each(corpus.map((c) => [c.file, c] as const))(
    "%s states the same model under new ids",
    (_, c) => {
      const source = new OrmYamlSerializer().deserialize(new OrmYamlSerializer().serialize(
        new OrmYamlSerializer().deserialize(JSON.stringify(c.doc)),
      ));
      const model = replayInto40(source);
      const ids = oldToNew(model);
      const prior = model.priorIds!;
      const back = (id: string) => prior.get(id) ?? id;
      expect(mapIds(asText(model), back)).toEqual(c.doc);
      // And the ids are 4.0's: a replay that kept the old ones would pass
      // the line above with an empty map.
      const off = [
        ...model.objectTypes.map((o) => [o.id, REFERENCE_PATTERN] as const),
        ...model.factTypes.flatMap((ft) => [
          [ft.id, LOCAL_NAME_PATTERN] as const,
          ...ft.roles.map((r) => [r.id, ROLE_ID_PATTERN] as const),
        ]),
        ...model.populations.map((p) => [p.id, ROLE_ID_PATTERN] as const),
      ].filter(([id, pattern]) => !pattern.test(id)).map(([id]) => id);
      expect(off).toEqual([]);
      // No reference left on an old id: an unmapped one maps back to itself,
      // so the comparison above cannot see it.
      const fresh = new Set(ids.values());
      const left: string[] = [];
      mapIds(asText(model), (id) => {
        if (ids.has(id) && !fresh.has(id)) left.push(id);
        return id;
      });
      expect(left).toEqual([]);
    },
  );

  it("names a shadow, an objectified fact type, repeated roles and the rest by 4.0's rules", () => {
    const source = new OrmYamlSerializer().deserialize(
      `orm_version: "3.0"
model:
  name: School
  object_types:
    - { id: u1, name: Student, kind: entity, reference_mode: nr, preferred_identifier: c1 }
    - { id: u2, name: Course, kind: entity, reference_mode: code, source_context: catalog }
    - { id: u3, name: Enrollment, kind: entity, reference_mode: nr }
    - { id: u4, name: Nr, kind: value }
  fact_types:
    - id: f1
      name: Student has Nr
      roles:
        - { id: r1, player: u1, role_name: has }
        - { id: r2, player: u4, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: c1, type: internal_uniqueness, roles: [r2] }
    - id: f2
      name: Enrollment
      roles:
        - { id: r3, player: u1, role_name: is in }
        - { id: r4, player: u2, role_name: is in }
      readings: ["{0} enrolls in {1}"]
      constraints:
        - { id: c2, type: internal_uniqueness, roles: [r3, r4] }
        - { id: bad, type: internal_uniqueness, roles: [r1] }
  objectified_fact_types:
    - { id: o1, fact_type: f2, object_type: u3 }
  populations:
    - id: p1
      fact_type: f1
      instances:
        - { id: i1, role_values: { r1: s1, r2: "7" } }
  diagrams:
    - { name: Main, elements: [u1, u2], positions: { u1: { x: 1, y: 2 } } }
`,
      { lenient: true },
    );
    const model = replayInto40(source);
    const ids = oldToNew(model);
    expect(Object.fromEntries(ids)).toMatchObject({
      u1: "Student",
      u2: "catalog:Course",
      u3: "Enrollment",
      // Decision 20: named like its objectifier, so its id is its reading's.
      f2: "Student_enrolls_in_Course",
      // Two roles named alike take the suffix rule (decision 5).
      r3: "Student_enrolls_in_Course.is_in",
      r4: "Student_enrolls_in_Course.is_in_2",
      c1: "For_each_Nr,_at_most_one_Student_has_that_Nr",
      // An internal constraint naming another fact type's role cannot be
      // named, so it keeps its old id.
      bad: "bad",
      p1: "Student_has_Nr.population",
      i1: "Student_has_Nr.population.1",
    });
    expect(model.getFactType("Student_enrolls_in_Course")!.name).toBe("Enrollment");
    expect(model.preferredIdentifierOf("Student")).toBe(
      "For_each_Nr,_at_most_one_Student_has_that_Nr",
    );
    expect(model.populations[0]!.instances[0]!.roleValues).toEqual({
      "Student_has_Nr.has": "s1",
      "Student_has_Nr.is_of": "7",
    });
    expect(model.diagramLayouts[0]).toMatchObject({
      elements: ["Student", "catalog:Course"],
      positions: { Student: { x: 1, y: 2 } },
    });
  });

  it("lets diff pair two replayed revisions of one file by their old ids", () => {
    const revision = (cardName: string, ownMax: string, exclusion: string) =>
      replayInto40(new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: u1, name: Customer, kind: entity, reference_mode: nr }
    - { id: u2, name: ${cardName}, kind: entity, reference_mode: nr }
  fact_types:
    - id: f1
      name: Customer owns ${cardName}
      roles:
        - { id: r1, player: u1, role_name: owns }
        - { id: r2, player: u2, role_name: is owned by }
      readings: ["{0} owns {1}"]
      constraints:
        - { id: c1, type: ${ownMax} }
    - id: f2
      name: Customer lends ${cardName}
      roles:
        - { id: r3, player: u1, role_name: lends }
        - { id: r4, player: u2, role_name: is lent by }
      readings: ["{0} lends {1}"]
  constraints:
    - { id: x1, type: exclusion, roles: [r1, r3]${exclusion} }
`));
    // The second revision renames the card and changes the constraint, so
    // every replayed id that names them differs between the two.
    const before = revision("Card", "internal_uniqueness, roles: [r2]", "");
    const after = revision(
      "Voucher",
      "internal_uniqueness, roles: [r1, r2]",
      ", modality: deontic",
    );
    expect(before.getObjectType("Card")).toBeDefined();
    expect(after.getObjectType("Voucher")).toBeDefined();
    const deltas = diffModels(before, after).deltas
      .filter((d) => d.kind !== "unchanged")
      .map((d) => [d.elementType, d.kind]);
    // Paired through the old ids: a change each, nothing removed or added
    // (a fact type's own constraint changes with its fact type).
    expect(deltas).toEqual([
      ["object_type", "modified"],
      ["fact_type", "modified"],
      ["fact_type", "modified"],
      ["constraint", "modified"],
    ]);
    // Without the old ids, the same two models pair by name and lose them.
    const plain = (m: OrmModel) =>
      new OrmYamlSerializer().deserialize(new OrmYamlSerializer().serialize(m));
    expect(diffModels(plain(before), plain(after)).deltas.some((d) => d.kind === "removed")).toBe(
      true,
    );
  });

  it("keeps two kinds that shared an old id apart, and leaves a dangling reference dangling", () => {
    // Built in code: a 3.0 file refuses a repeated constraint id, and a 2.0
    // file or a model built in code is how one reaches the replay.
    const source = new OrmModel({ name: "Shared" });
    source.addObjectType({ id: "x1", name: "Person", kind: "entity", referenceMode: "nr" });
    source.addObjectType({ id: "ot-7", name: "Order", kind: "entity", referenceMode: "nr" });
    source.addFactType({
      id: "x1",
      name: "Person places Order",
      roles: [
        { id: "r1", name: "places", playerId: "x1" },
        { id: "r2", name: "is placed by", playerId: "Order" },
      ],
      readings: ["{0} places {1}"],
      // A ring over two players: no sentence names it.
      constraints: [{
        id: "c9",
        type: "ring",
        roleId1: "r1",
        roleId2: "r2",
        ringType: "irreflexive",
      }],
    }, { skipPlayerValidation: true });
    source.addConstraint({ id: "c9", type: "exclusion", roleIds: ["r1", "gone"] } as never);
    // A reference to the object type x1 read after the fact type x1 is in.
    source.addDiagramLayout({ name: "Main", elements: ["x1"], positions: {}, orientations: {} });
    const model = replayInto40(source);
    const ft = model.factTypes[0]!;
    // The role's player is the object type, though a fact type shared x1.
    expect(ft.id).toBe("Person_places_Order");
    expect(ft.roles[0]!.playerId).toBe("Person");
    // "Order" was a dangling player in the file; the object type named
    // Order is not given that id, so the reference still resolves to nothing.
    expect(model.getObjectTypeByName("Order")!.id).toBe("Order_2");
    expect(ft.roles[1]!.playerId).toBe("Order");
    expect(model.diagramLayouts[0]!.elements).toEqual(["Person"]);
    // Two constraints the model cannot name, sharing an old id: the second
    // takes one derived from it, rather than the replay refusing the file.
    const kept = model.everyConstraint().map(([c]) => c.id).filter((id) =>
      id?.startsWith("c9") || /^[0-9a-f]{8}-/.test(id ?? "")
    );
    expect(new Set(kept).size).toBe(kept.length);
  });

  it("replays one fact type's two unnamable constraints sharing an id, as a 2.0 file may hold them", () => {
    const source = new OrmModel({ name: "Rings" });
    source.addObjectType({ id: "a", name: "A", kind: "entity", referenceMode: "nr" });
    source.addObjectType({ id: "b", name: "B", kind: "entity", referenceMode: "nr" });
    const ring = {
      id: "k",
      type: "ring",
      roleId1: "r1",
      roleId2: "r2",
      ringType: "irreflexive",
    } as const;
    source.addFactType({
      id: "f",
      name: "A r B",
      roles: [{ id: "r1", name: "r", playerId: "a" }, { id: "r2", name: "s", playerId: "b" }],
      readings: ["{0} r {1}"],
      constraints: [ring, { ...ring, ringType: "acyclic" }],
    });
    const ids = replayInto40(source).factTypes[0]!.internalConstraints.map((c) => c.id);
    expect(ids[0]).toBe("k");
    expect(new Set(ids).size).toBe(2);
  });

  it("leaves a reference to a subtype fact it leaves unnamed dangling (decisions 17 and 19)", () => {
    const source = new OrmYamlSerializer().deserialize(
      `orm_version: "3.0"
model:
  name: Gone
  object_types:
    - { id: a, name: A, kind: entity, reference_mode: nr }
    - { id: b, name: B, kind: entity, reference_mode: nr }
  subtype_facts:
    - { id: sf1, subtype: a, supertype: gone }
    - { id: sf2, subtype: b, supertype: gone }
  constraints:
    - { id: x, type: exclusion, subtype_facts: [sf1, sf2] }
`,
      { lenient: true },
    );
    const model = replayInto40(source);
    expect(model.subtypeFacts.map((sf) => sf.id)).toEqual([undefined, undefined]);
    // Nothing may refer to an unnamed element by id, so the constraint
    // names the old ids, which resolve to nothing, and validation says so.
    expect(model.constraints[0]).toMatchObject({ subtypeFactIds: ["sf1", "sf2"] });
  });

  it("maps a diagram's orientations by fact type, keeps stale position and orientation keys apart, and names a shadow's context locally", () => {
    const source = new OrmModel({ name: "Layout" });
    source.addObjectType({ id: "x1", name: "Person", kind: "entity", referenceMode: "nr" });
    source.addObjectType({ id: "u1", name: "Customer", kind: "entity", referenceMode: "nr" });
    source.addObjectType({
      id: "s1",
      name: "Order",
      kind: "entity",
      referenceMode: "nr",
      sourceContext: "Order Management",
    });
    source.addFactType({
      id: "x1",
      name: "Person knows Customer",
      roles: [{ id: "r1", name: "knows", playerId: "x1" }, {
        id: "r2",
        name: "is known by",
        playerId: "u1",
      }],
      readings: ["{0} knows {1}"],
    });
    source.addDiagramLayout({
      name: "Main",
      // "Customer" and "Person_knows_Customer" are stale keys: no element
      // holds either id in the file, and each is a name the replay would mint.
      positions: { u1: { x: 1, y: 1 }, Customer: { x: 9, y: 9 } },
      orientations: { x1: "vertical", Person_knows_Customer: "horizontal" },
    });
    const model = replayInto40(source);
    const layout = model.diagramLayouts[0]!;
    expect(model.getObjectTypeByName("Customer")!.id).toBe("Customer_2");
    expect(layout.positions).toEqual({ Customer_2: { x: 1, y: 1 }, Customer: { x: 9, y: 9 } });
    expect(layout.orientations).toEqual({
      Person_knows_Customer_2: "vertical",
      Person_knows_Customer: "horizontal",
    });
    expect(model.getObjectTypeByName("Order")!.id).toBe("Order_Management:Order");
  });

  it("gives one model for one input, on every run", () => {
    for (const c of corpus) {
      const load = () => new OrmYamlSerializer().deserialize(JSON.stringify(c.doc));
      expect([c.file, asText(replayInto40(load()))]).toEqual([
        c.file,
        asText(replayInto40(load())),
      ]);
    }
  });
});
