/**
 * Format 3.0's own guarantees (orm-format-3 WS4b-ii): the schema places
 * each constraint kind where `PLACEMENT` says it lives, a document that
 * misplaces one or repeats an id is refused by name, and an entity's
 * preferred identifier is a stored reference that survives a save, a load,
 * and the removals that would leave it naming nothing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import {
  CONSTRAINT_TYPES,
  type ExternalConstraint,
  placementOf,
} from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";

const yaml = new OrmYamlSerializer();
const schema = JSON.parse(
  readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
) as { definitions: Record<string, unknown>; };

/** Every `type` const anywhere under a schema node. */
function typeConsts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(typeConsts);
  if (typeof node !== "object" || node === null) return [];
  const own = (node as { properties?: { type?: { const?: unknown; }; }; }).properties?.type?.const;
  return [
    ...(typeof own === "string" ? [own] : []),
    ...Object.values(node).flatMap(typeConsts),
  ];
}

/** Customer identified by CustomerId, with a second fact type and an external key. */
function shop(): OrmModel {
  const model = new OrmModel({ name: "Shop" });
  model.addObjectType({ id: "ot-c", name: "Customer", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-cid", name: "CustomerId", kind: "value" });
  model.addObjectType({ id: "ot-n", name: "Name", kind: "value" });
  model.addFactType({
    id: "ft-id",
    name: "Customer has CustomerId",
    roles: [
      { id: "r-c", name: "has", playerId: "ot-c" },
      { id: "r-cid", name: "is of", playerId: "ot-cid" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "u-c", type: "internal_uniqueness", roleIds: ["r-c"] },
      { id: "u-cid", type: "internal_uniqueness", roleIds: ["r-cid"] },
    ],
  });
  model.addFactType({
    id: "ft-n",
    name: "Customer has Name",
    roles: [
      { id: "r-cn", name: "has", playerId: "ot-c" },
      { id: "r-n", name: "is of", playerId: "ot-n" },
    ],
    readings: ["{0} has {1}"],
    constraints: [{ id: "u-cn", type: "internal_uniqueness", roleIds: ["r-cn"] }],
  });
  model.addConstraint({ id: "x-key", type: "external_uniqueness", roleIds: ["r-cid", "r-n"] });
  model.setPreferredIdentifier("ot-c", "u-cid");
  return model;
}

describe("the 3.0 schema places each constraint kind as PLACEMENT does", () => {
  // The schema's two lists are a hand copy of the table, so this is the
  // copy's check: a kind added to PLACEMENT, or moved in it, fails here
  // until the schema agrees.
  const defs = schema.definitions;
  const internal = [...new Set(typeConsts(defs["internal_constraint"]))].sort();
  const external = [...new Set(typeConsts(defs["external_constraint"]))].sort();

  it("lists every internal kind under internal_constraint and nothing else", () => {
    expect(internal).toEqual(CONSTRAINT_TYPES.filter((t) => placementOf(t) === "internal").sort());
  });

  it("lists every external kind under external_constraint and nothing else", () => {
    expect(external).toEqual(CONSTRAINT_TYPES.filter((t) => placementOf(t) === "external").sort());
  });
});

describe("a 3.0 document that misplaces a constraint", () => {
  const load = (edit: (doc: any) => void) => {
    const doc = parse(yaml.serialize(shop()));
    edit(doc);
    return () => yaml.deserialize(stringify(doc));
  };

  it("is refused by name when an external kind sits under a fact type", () => {
    const read = load((doc) => {
      const key = doc.model.constraints.pop();
      doc.model.fact_types[0].constraints.push(key);
      delete doc.model.constraints;
    });
    expect(read).toThrow(DeserializationError);
    expect(read).toThrow(
      'The external_uniqueness constraint "x-key" is listed under fact type "Customer has CustomerId", '
        + "but its kind lives in the model: move it to model.constraints.",
    );
  });

  it("is refused by name when an internal kind sits in model.constraints", () => {
    const read = load((doc) => {
      doc.model.constraints.push(doc.model.fact_types[1].constraints.pop());
      delete doc.model.fact_types[1].constraints;
    });
    expect(read).toThrow(
      'The internal_uniqueness constraint "u-cn" is listed in model.constraints, but its kind lives in '
        + "its fact type: move it under the fact type whose roles it names.",
    );
  });

  it("is refused when two constraints share an id, naming it", () => {
    const read = load((doc) => {
      doc.model.fact_types[1].constraints[0].id = "u-cid";
    });
    expect(read).toThrow(
      'Constraint ids are held by more than one constraint: "u-cid" (internal_uniqueness in fact type '
        + '"Customer has CustomerId" over roles r-cid; internal_uniqueness in fact type "Customer has Name" '
        + "over roles r-cn). A constraint id names one constraint.",
    );
  });
});

describe("a stored preferred identifier", () => {
  it("survives a 3.0 save and load, and the load saves to the same bytes", () => {
    const text = yaml.serialize(shop());
    const back = yaml.deserialize(text);
    expect(back.preferredIdentifierRefs).toEqual([["ot-c", "u-cid"]]);
    expect(yaml.serialize(back)).toBe(text);
  });

  it("is refused on a value type in a 3.0 document", () => {
    const doc = parse(yaml.serialize(shop()));
    doc.model.object_types[1].preferred_identifier = "u-cid";
    expect(() => yaml.deserialize(stringify(doc))).toThrow(DeserializationError);
  });

  it("is refused on a value type in memory, and on an object type that does not exist", () => {
    const model = shop();
    expect(() => model.setPreferredIdentifier("ot-cid", "u-cid")).toThrow(
      '"CustomerId" is a value type; only an entity type has a preferred identifier.',
    );
    expect(() => model.setPreferredIdentifier("ot-missing", "u-cid")).toThrow(
      'Object type with id "ot-missing" not found.',
    );
  });

  it("is cleared when the constraint it names is removed", () => {
    // A reference to an external constraint identifies nothing, and is
    // stored all the same (validation reports it); removing the
    // constraint must not leave it naming an id that is gone.
    const model = shop();
    model.setPreferredIdentifier("ot-c", "x-key");
    model.removeConstraint(model.getConstraint("x-key") as ExternalConstraint);
    expect(model.preferredIdentifierRefs).toEqual([]);
  });

  it("is cleared when the fact type holding its constraint is removed", () => {
    const model = shop();
    model.removeFactType("ft-id");
    expect(model.preferredIdentifierRefs).toEqual([]);
  });

  it("is cleared when its entity is removed", () => {
    const model = shop();
    model.addObjectType({ id: "ot-p", name: "Prospect", kind: "entity", referenceMode: "id" });
    model.setPreferredIdentifier("ot-p", "u-cid");
    model.removeObjectType("ot-p");
    expect(model.preferredIdentifierRefs).toEqual([["ot-c", "u-cid"]]);
  });

  it("is kept when an unrelated constraint is removed", () => {
    const model = shop();
    model.removeConstraint(model.getConstraint("x-key") as ExternalConstraint);
    expect(model.preferredIdentifierRefs).toEqual([["ot-c", "u-cid"]]);
  });
});

describe("a version between 2.0 and 3.0", () => {
  it("is refused as one no release wrote, not as one from a newer build", () => {
    const doc = parse(yaml.serialize(shop()));
    doc.orm_version = "2.1";
    expect(() => yaml.deserialize(stringify(doc))).toThrow(
      'Unsupported orm_version "2.1" (this build reads 3.0): no migration path is available; '
        + "re-export from a compatible version.",
    );
  });
});

describe("a 2.0 file that omits its constraint ids", () => {
  // Pinned literals: the ids the 2.0 reader of the release before 3.0
  // derived for this file, when a flag was part of the constraint it
  // hashed. Hashing without the flag moved the NORMA ids of 271 flagged
  // uniquenesses across the tracked corpus; only a before-and-after
  // capture caught it.
  const v20 = `orm_version: "2.0"
model:
  name: Shop
  object_types:
    - { id: ot-c, name: Customer, kind: entity, reference_mode: nr }
    - { id: ot-nr, name: CustomerNr, kind: value }
  fact_types:
    - id: ft-nr
      name: Customer has CustomerNr
      roles:
        - { id: r-c, player: ot-c, role_name: has }
        - { id: r-nr, player: ot-nr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r-c] }
        - { type: internal_uniqueness, roles: [r-nr], is_preferred: true }
`;

  it("derives the ids earlier releases gave it, the flag included", () => {
    const model = yaml.deserialize(v20);
    expect(model.getFactType("ft-nr")!.internalConstraints.map((c) => c.id)).toEqual([
      "b55e8e65-fa16-8edd-92ed-08d0a611508e",
      "bb330124-3808-8a8f-9650-02c81dfc37f0",
    ]);
    expect(model.preferredIdentifierRefs).toEqual([[
      "ot-c",
      "bb330124-3808-8a8f-9650-02c81dfc37f0",
    ]]);
  });
});

describe("migrate", () => {
  const twoFlags = `orm_version: "2.0"
model:
  name: Shop
  object_types:
    - { id: ot-c, name: Customer, kind: entity, reference_mode: nr }
    - { id: ot-nr, name: CustomerNr, kind: value }
    - { id: ot-n, name: Name, kind: value }
    - { id: ot-e, name: Email, kind: value }
  fact_types:
    - id: ft-nr
      name: Customer has CustomerNr
      roles:
        - { id: r-c, player: ot-c, role_name: has }
        - { id: r-nr, player: ot-nr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-nr, type: internal_uniqueness, roles: [r-nr], is_preferred: true }
    - id: ft-e
      name: Customer has Email
      roles:
        - { id: r-ce, player: ot-c, role_name: has }
        - { id: r-e, player: ot-e, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-e, type: internal_uniqueness, roles: [r-e], is_preferred: true }
    - id: ft-n
      name: Customer has Name
      roles:
        - { id: r-cn, player: ot-c, role_name: has }
        - { id: r-n, player: ot-n, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-cn, type: internal_uniqueness, roles: [r-cn], is_preferred: true }
`;

  it("names each flag the 2.0 reader dropped, and the identifier it kept of several", () => {
    const result = yaml.migrate(twoFlags);
    expect(result.from).toBe("2.0");
    expect(result.notes).toEqual([
      { kind: "flag-dropped", factType: "Customer has Name", constraintId: "u-cn" },
      { kind: "identifier-chosen", entity: "Customer", kept: "u-nr", others: ["u-e"] },
    ]);
    expect(result.model.preferredIdentifierOf("ot-c")).toBe("u-nr");
  });

  it("reports nothing for a 3.0 file, and the same model deserialize gives", () => {
    const text = yaml.serialize(shop());
    const result = yaml.migrate(text);
    expect(result.from).toBe("3.0");
    expect(result.notes).toEqual([]);
    expect(yaml.serialize(result.model)).toBe(yaml.serialize(yaml.deserialize(text)));
  });
});

describe("migrate on a file that names what it does not define", () => {
  it("judges no flag, and names every missing id, a population's fact type included", () => {
    const fragment = `orm_version: "2.0"
model:
  name: Fragment
  object_types:
    - { id: ot-nr, name: CustomerNr, kind: value }
  fact_types:
    - id: ft-nr
      name: Customer has CustomerNr
      roles:
        - { id: r-c, player: ot-c, role_name: has }
        - { id: r-nr, player: ot-nr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-nr, type: internal_uniqueness, roles: [r-nr], is_preferred: true }
  populations:
    - { id: p, fact_type: ft-base, instances: [] }
`;
    expect(yaml.migrate(fragment, { lenient: true }).notes).toEqual([
      { kind: "flags-unplaceable", missing: ["ft-base", "ot-c"] },
    ]);
  });
});
