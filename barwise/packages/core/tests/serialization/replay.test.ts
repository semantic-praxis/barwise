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
import { LOCAL_NAME_PATTERN, REFERENCE_PATTERN, ROLE_ID_PATTERN } from "../../src/model/name.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
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
      const { model, ids } = replayInto40(source);
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
    const { model, ids } = replayInto40(source);
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

  it("gives one model for one input, on every run", () => {
    for (const c of corpus) {
      const load = () => new OrmYamlSerializer().deserialize(JSON.stringify(c.doc));
      expect([c.file, asText(replayInto40(load()).model)]).toEqual([
        c.file,
        asText(replayInto40(load()).model),
      ]);
    }
  });
});
