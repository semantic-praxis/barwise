/**
 * The store refuses an id it already holds (model invariants, WS3).
 *
 * Each of the five id-keyed stores is a `Map`, and `set` overwrites, so a
 * second element under a held id used to replace the first without a word.
 * These pin the refusal for each kind in code, through both readers with
 * and without `lenient`, and the one merge path that would otherwise reach
 * it: an objectification whose id the merged model already holds.
 */
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeAndValidate } from "../../src/diff/ModelMerge.js";
import { DuplicateIdError, type IdKeyedKind, OrmModel } from "../../src/model/OrmModel.js";
import {
  DeserializationError,
  OrmYamlSerializer,
  readDocument20,
  writeDocument,
} from "../../src/serialization/OrmYamlSerializer.js";

/** A, B, C entities and V a value; B is a subtype of A; C objectifies "A has V". */
function base(): OrmModel {
  const m = new OrmModel({ name: "M" });
  for (const [id, name] of [["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]] as const) {
    m.addObjectType({ id, name, kind: "entity", referenceMode: `${id}_id` });
  }
  m.addObjectType({ id: "v", name: "V", kind: "value" });
  for (const [id, player] of [["f1", "a"], ["f2", "b"]] as const) {
    m.addFactType({
      id,
      name: `${player.toUpperCase()} has V`,
      roles: [{ id: `${id}r0`, name: "has", playerId: player }, {
        id: `${id}r1`,
        name: "of",
        playerId: "v",
      }],
      readings: ["{0} has {1}"],
    });
  }
  m.addSubtypeFact({ id: "sf1", subtypeId: "b", supertypeId: "a" });
  m.addObjectifiedFactType({ id: "of1", factTypeId: "f1", objectTypeId: "c" });
  m.addPopulation({ id: "pop1", factTypeId: "f1", instances: [] });
  return m;
}

interface Case {
  readonly kind: IdKeyedKind;
  readonly id: string;
  readonly add: (m: OrmModel, skip: boolean) => unknown;
  readonly message: string;
  /** The same second element, as a file states it, under `model`. */
  readonly yamlKey: string;
  readonly yamlEntry: Record<string, unknown>;
}

const CASES: readonly Case[] = [
  {
    kind: "object type",
    id: "a",
    add: (m) => m.addObjectType({ id: "a", name: "E", kind: "entity", referenceMode: "e_id" }),
    message: 'Id "a" is held by object type "A", so object type "E" cannot be added.',
    yamlKey: "object_types",
    yamlEntry: { id: "a", name: "E", kind: "entity", reference_mode: "e_id" },
  },
  {
    kind: "fact type",
    id: "f1",
    add: (m, skip) =>
      m.addFactType({
        id: "f1",
        name: "D has V",
        roles: [{ id: "x0", name: "has", playerId: "d" }, { id: "x1", name: "of", playerId: "v" }],
        readings: ["{0} has {1}"],
      }, { skipPlayerValidation: skip }),
    message: 'Id "f1" is held by fact type "A has V", so fact type "D has V" cannot be added.',
    yamlKey: "fact_types",
    yamlEntry: {
      id: "f1",
      name: "D has V",
      roles: [{ id: "x0", player: "d", role_name: "has" }, {
        id: "x1",
        player: "v",
        role_name: "of",
      }],
      readings: ["{0} has {1}"],
    },
  },
  {
    kind: "subtype fact",
    id: "sf1",
    add: (m, skip) =>
      m.addSubtypeFact({ id: "sf1", subtypeId: "d", supertypeId: "a" }, {
        skipPlayerValidation: skip,
      }),
    message:
      'Id "sf1" is held by subtype fact "B" -> "A", so subtype fact "D" -> "A" cannot be added.',
    yamlKey: "subtype_facts",
    yamlEntry: { id: "sf1", subtype: "d", supertype: "a" },
  },
  {
    kind: "objectification",
    id: "of1",
    add: (m, skip) =>
      m.addObjectifiedFactType({ id: "of1", factTypeId: "f2", objectTypeId: "d" }, {
        skipPlayerValidation: skip,
      }),
    message: 'Id "of1" is held by objectification of "A has V", '
      + 'so objectification of "B has V" cannot be added.',
    yamlKey: "objectified_fact_types",
    yamlEntry: { id: "of1", fact_type: "f2", object_type: "d" },
  },
  {
    kind: "population",
    id: "pop1",
    add: (m, skip) =>
      m.addPopulation({ id: "pop1", factTypeId: "f2", instances: [] }, {
        skipPlayerValidation: skip,
      }),
    message: 'Id "pop1" is held by population of fact type "A has V", '
      + 'so population of fact type "B has V" cannot be added.',
    yamlKey: "populations",
    yamlEntry: { id: "pop1", fact_type: "f2", instances: [] },
  },
];

describe("each add* refuses an id its store holds", () => {
  for (const c of CASES) {
    for (const skip of [false, true]) {
      it(`${c.kind}${skip ? ", with skipPlayerValidation" : ""}`, () => {
        const m = base();
        let thrown: unknown;
        try {
          c.add(m, skip);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(DuplicateIdError);
        const err = thrown as DuplicateIdError;
        expect([err.id, err.kind, err.message]).toEqual([c.id, c.kind, c.message]);
      });
    }
  }

  it("leaves the held element in place", () => {
    const m = base();
    expect(() => CASES[0]!.add(m, false)).toThrow(DuplicateIdError);
    expect(m.getObjectType("a")?.name).toBe("A");
    expect(m.objectTypes).toHaveLength(5);
  });
});

describe("both readers turn a repeated id into a DeserializationError", () => {
  const serializer = new OrmYamlSerializer();
  // The base model as a file, with the second element appended. Both
  // versions state these five kinds the same way.
  const document = (version: string, c: Case) => {
    const doc = writeDocument(base()) as unknown as {
      orm_version: string;
      model: Record<string, unknown[] | undefined>;
    };
    doc.orm_version = version;
    doc.model[c.yamlKey] = [...(doc.model[c.yamlKey] ?? []), c.yamlEntry];
    return stringify(doc);
  };

  for (const version of ["2.0", "3.0"]) {
    for (const c of CASES) {
      for (const lenient of [false, true]) {
        it(`${version} ${c.kind}${lenient ? ", lenient" : ""}`, () => {
          let thrown: unknown;
          try {
            serializer.deserialize(document(version, c), { lenient });
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(DeserializationError);
          expect((thrown as Error).message).toBe(c.message);
        });
      }
    }
  }
});

describe("merge gives an objectification a fresh id when its own is held", () => {
  it("keeps both, and reports nothing", () => {
    const existing = base();
    // The incoming model objectifies another fact type under the same id
    // and drops the existing objectification: an addition and a removal.
    const incoming = base();
    incoming.removeObjectifiedFactType("of1");
    incoming.addObjectifiedFactType({ id: "of1", factTypeId: "f2", objectTypeId: "d" });
    const { deltas } = diffModels(existing, incoming);
    const policy = new Set(deltas.flatMap((d, i) => (d.kind === "removed" ? [] : [i])));

    const result = mergeAndValidate(existing, incoming, deltas, policy);
    expect(result.diagnostics).toEqual([]);
    const ofts = result.model!.objectifiedFactTypes;
    expect(ofts.map((o) => o.factTypeId).sort()).toEqual(["f1", "f2"]);
    expect(new Set(ofts.map((o) => o.id)).size).toBe(2);
    expect(ofts.find((o) => o.factTypeId === "f1")?.id).toBe("of1");
  });
});

describe("the exported 2.0 reader converts too", () => {
  it("readDocument20 throws DeserializationError, not DuplicateIdError", () => {
    const doc = writeDocument(base()) as unknown as {
      orm_version: string;
      model: Record<string, unknown[] | undefined>;
    };
    doc.orm_version = "2.0";
    doc.model.object_types = [...doc.model.object_types!, CASES[0]!.yamlEntry];
    expect(() => readDocument20(doc as never)).toThrow(DeserializationError);
  });
});
