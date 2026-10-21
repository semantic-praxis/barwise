/**
 * Constraint ids under format 2.0 (docs/specs/orm-format-3.spec.md, WS2).
 * A file may omit a constraint's id; the loader derives one from the
 * constraint's content, so one unchanged file always loads to the same ids.
 * Before this, the fill came from the id generator and differed per load.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FactType } from "../../src/model/FactType.js";
import { setIdGenerator } from "../../src/model/id.js";
import { canonicalJson, CONSTRAINT_ID_TAG, derivedId } from "../../src/serialization/derivedId.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const shopPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../examples/getting-started/shop.orm.yaml",
);

function withConstraints(constraints: string): string {
  return `orm_version: "2.0"
model:
  name: Ids
  object_types:
    - id: ot-p
      name: Person
      kind: entity
      reference_mode: id
    - id: ot-n
      name: Name
      kind: value
  fact_types:
    - id: ft-1
      name: Person has Name
      roles:
        - id: r-1
          player: ot-p
          role_name: has
        - id: r-2
          player: ot-n
          role_name: is of
      readings:
        - "{0} has {1}"
      constraints:
${constraints}`;
}

/** Constraint ids of ft-1, loaded from a whole document. */
function idsIn(yaml: string): (string | undefined)[] {
  const model = new OrmYamlSerializer().deserialize(yaml);
  return model.getFactType("ft-1")!.internalConstraints.map((c) => c.id);
}

/** Constraint ids of ft-1, from its constraints list alone. */
function idsOf(constraints: string): (string | undefined)[] {
  return idsIn(withConstraints(constraints));
}

function constraintIds(yaml: string): string[] {
  const model = new OrmYamlSerializer().deserialize(yaml);
  return model.everyConstraint().map(([c]) => c.id!);
}

describe("constraint ids a 2.0 file omits", () => {
  it("are the same on every load of one unchanged file", () => {
    // Counters make any generator-minted id visible: if the loader still
    // filled ids from the generator, the two loads would disagree.
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const shop = readFileSync(shopPath, "utf-8");
      const first = constraintIds(shop);
      const second = constraintIds(shop);
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
      expect(first.every((id) => UUID_V8.test(id))).toBe(true);
    } finally {
      setIdGenerator(undefined);
    }
  });

  it("keeps an id the file states, and derives one for a missing or empty id", () => {
    const ids = idsOf(`        - id: c-stated
          type: mandatory
          role: r-1
        - type: internal_uniqueness
          roles: [r-1]
        - id: ""
          type: internal_uniqueness
          roles: [r-2]
`);
    expect(ids[0]).toBe("c-stated");
    expect(ids[1]).toMatch(UUID_V8);
    expect(ids[2]).toMatch(UUID_V8);
    expect(ids[1]).not.toBe(ids[2]);
  });

  it("does not change when another constraint is inserted before it", () => {
    const uniqueness = `        - type: internal_uniqueness
          roles: [r-1]
`;
    const mandatory = `        - type: mandatory
          role: r-1
`;
    const before = idsOf(uniqueness + mandatory);
    const after = idsOf(mandatory + uniqueness);
    expect(after[1]).toBe(before[0]);
    expect(after[0]).toBe(before[1]);
  });

  it("does not depend on the order a file writes a constraint's keys in", () => {
    const a = idsOf(`        - type: internal_uniqueness
          roles: [r-1]
`);
    const b = idsOf(`        - roles: [r-1]
          type: internal_uniqueness
`);
    expect(b).toEqual(a);
  });

  it("does not depend on spellings the reader folds", () => {
    // A frequency may name its role either way, and alethic is the default
    // modality whether or not the file says so.
    const a = idsOf(`        - type: frequency
          role: r-1
          min: 1
          max: 2
        - type: mandatory
          role: r-1
`);
    const b = idsOf(`        - type: frequency
          roles: [r-1]
          min: 1
          max: 2
        - type: mandatory
          role: r-1
          modality: alethic
`);
    expect(b).toEqual(a);
  });

  it("never repeats an id another fact type states", () => {
    // A saved constraint moved to another fact type keeps the id derived
    // under its old one; an identical constraint added back there would
    // derive that id again.
    const saved = idsOf(`        - type: mandatory
          role: r-1
`)[0]!;
    const yaml = withConstraints(`        - type: mandatory
          role: r-1
`).replace(
      "  fact_types:\n",
      `  fact_types:
    - id: ft-0
      name: Person was named
      roles:
        - id: r-0
          player: ot-p
          role_name: was named
      readings:
        - "{0} was named"
      constraints:
        - id: ${saved}
          type: mandatory
          role: r-0
`,
    );
    const ids = constraintIds(yaml);
    expect(ids).toContain(saved);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tells identical constraints in one fact type apart", () => {
    const ids = idsOf(`        - type: mandatory
          role: r-1
        - type: mandatory
          role: r-1
`);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("never repeats an id the fact type already states", () => {
    // A saved constraint states the id once derived for it; an identical
    // constraint added later without an id would derive that same id.
    const saved = idsOf(`        - type: mandatory
          role: r-1
`)[0]!;
    const ids = idsOf(`        - id: ${saved}
          type: mandatory
          role: r-1
        - type: mandatory
          role: r-1
`);
    expect(ids[0]).toBe(saved);
    expect(ids[1]).toMatch(UUID_V8);
    expect(ids[1]).not.toBe(saved);
  });

  it("is written to the file on save, so a reload states it", () => {
    const serializer = new OrmYamlSerializer();
    const model = serializer.deserialize(withConstraints(`        - type: mandatory
          role: r-1
`));
    const saved = serializer.serialize(model);
    const derived = model.getFactType("ft-1")!.internalConstraints[0]!.id!;
    expect(saved).toContain(`id: ${derived}`);
    expect(idsIn(saved)).toEqual([derived]);
  });

  it("are pinned: a change to the derivation or the read shape moves them", () => {
    // Every saved 2.0 file that omitted an id now states the one derived
    // here, so a change to the hash input, the tag, or what the reader
    // builds from a constraint would silently re-key unsaved files. The
    // value was recomputed by hand from the documented recipe: SHA-256 over
    // length-prefixed "barwise.constraint", "ft-1",
    // '{"roleId":"r-1","type":"mandatory"}', "0", then the v8 bits.
    expect(idsOf(`        - type: mandatory
          role: r-1
`)).toEqual(["db9511fc-9703-8533-8786-bac29c9aff87"]);
  });

  it("leaves code-built constraints to the generator, as before", () => {
    // A constraint built in code is new, so a fresh id is right; only a
    // file's omitted ids are derived.
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const ft = new FactType({
        id: "ft-code",
        name: "Person has Name",
        roles: [
          { id: "r-1", name: "has", playerId: "ot-p" },
          { id: "r-2", name: "is of", playerId: "ot-n" },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ type: "mandatory", roleId: "r-1" }],
      });
      expect(ft.internalConstraints[0]!.id).toBe("minted-1");
    } finally {
      setIdGenerator(undefined);
    }
  });
});

describe("derivedId", () => {
  it("keeps inputs apart by their lengths", () => {
    // Plain concatenation makes both "ft-1mandatory".
    expect(derivedId(CONSTRAINT_ID_TAG, ["ft-1", "mandatory"]))
      .not.toBe(derivedId(CONSTRAINT_ID_TAG, ["ft-1m", "andatory"]));
  });

  it("keeps derivations apart by their tags", () => {
    expect(derivedId("barwise.constraint", ["x"]))
      .not.toBe(derivedId("barwise.subtype-constraint", ["x"]));
  });

  it("is pinned to its recipe", () => {
    expect(derivedId(CONSTRAINT_ID_TAG, ["ft-1", "mandatory"]))
      .toBe("e29ae2e4-9f50-8a0a-9325-508d075e898e");
  });

  it("is a UUIDv8 and a pure function of its inputs", () => {
    const id = derivedId(CONSTRAINT_ID_TAG, ["ft-1", "mandatory"]);
    expect(id).toMatch(UUID_V8);
    expect(derivedId(CONSTRAINT_ID_TAG, ["ft-1", "mandatory"])).toBe(id);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } }))
      .toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });

  it("drops undefined fields, as YAML would never write them", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("writes an undefined array element as null, as JSON does", () => {
    expect(canonicalJson([undefined])).toBe("[null]");
    expect(canonicalJson([undefined])).not.toBe(canonicalJson([]));
    expect(canonicalJson([undefined, 1])).toBe(JSON.stringify([undefined, 1]));
  });
});
