/**
 * What each Ossie loss line covers in the read-back check
 * (`docs/specs/ossie-export-precise-losses.spec.md`).
 *
 * An object-type loss line names the changes it explains, and the read-back
 * check stays silent only about those. The names are a hand-kept copy of
 * what `diffModels` reports for each line, so each case here builds a model
 * on which one line fires and holds the copy to the diff both ways: with
 * the line's own set the element adds no line (the set is wide enough), and
 * with any one kind taken out it does (no kind in the set is spare).
 */
import { OrmModel } from "@barwise/core";
import type { ChangeKind } from "@barwise/core/diff";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { OssieExportFormat } from "../src/ossie/OssieExportFormat.js";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";
import { verifyOssie } from "../src/ossie/verifyOssie.js";
import { lossKey, writeOssie } from "../src/ossie/writeOssie.js";

let seq = 0;
const id = (tag: string) => `${tag}-${++seq}`;

type Config = Parameters<OrmModel["addObjectType"]>[0];

/** A model holding one object type built from `config`, and its id. */
function one(config: Omit<Config, "id">): { m: OrmModel; otId: string; } {
  const m = new OrmModel({ name: "M" });
  const ot = m.addObjectType({ id: id("ot"), ...config } as Config);
  return { m, otId: ot.id };
}

/** An entity identified by a code it has, so it writes no identifier line. */
function coded(config: Partial<Config> = {}): { m: OrmModel; otId: string; } {
  const m = new OrmModel({ name: "M" });
  const thing = m.addObjectType({
    id: id("ot"),
    name: "Thing",
    kind: "entity",
    referenceMode: "thing_code",
    ...config,
  } as Config);
  const code = m.addObjectType({
    id: id("ot"),
    name: "ThingCode",
    kind: "value",
    dataType: { name: "text" },
  });
  const roles = [
    { id: id("r"), name: "Thing", playerId: thing.id },
    { id: id("r"), name: "ThingCode", playerId: code.id },
  ];
  const pid = id("uc");
  m.addFactType({
    id: id("ft"),
    name: "Thing.thing_code",
    roles,
    readings: ["{0} has {1}"],
    constraints: [
      { type: "internal_uniqueness", id: id("uc"), roleIds: [roles[0]!.id] },
      { type: "internal_uniqueness", id: pid, roleIds: [roles[1]!.id] },
      { type: "mandatory", id: id("m"), roleId: roles[0]!.id },
    ],
  });
  m.setPreferredIdentifier(thing.id, pid);
  return { m, otId: thing.id };
}

/** Student, a subtype of Thing that takes its identifier from Thing. */
function subtype(config: Partial<Config>): { m: OrmModel; otId: string; } {
  const { m, otId: thingId } = coded();
  const student = m.addObjectType(
    { id: id("ot"), name: "Student", kind: "entity", ...config } as Config,
  );
  m.addSubtypeFact({ subtypeId: student.id, supertypeId: thingId, providesIdentification: true });
  return { m, otId: student.id };
}

const value = (config: Partial<Config>) =>
  one({ name: "Code", kind: "value", dataType: { name: "text" }, ...config } as Config);

/** The read-back lines on one object type, given what the writer's lines cover. */
function linesOn(
  m: OrmModel,
  otId: string,
  scope: (covers: Map<string, ReadonlySet<ChangeKind> | "all">) => void,
): string[] {
  const written = writeOssie(m);
  const back = new OssieImportFormat().parse(stringify(written.document)).model;
  const covers = new Map(written.covers);
  scope(covers);
  const name = m.getObjectType(otId)!.name;
  return verifyOssie(m, back, written.written, covers).losses
    .filter((l) => l.startsWith(`Object type: ${name}:`));
}

const CASES: readonly {
  readonly line: RegExp;
  readonly explains: readonly ChangeKind[];
  readonly model: () => { m: OrmModel; otId: string; };
}[] = [
  {
    line: /aliases .* not written/,
    explains: ["aliases"],
    model: () => coded({ aliases: ["Item"] }),
  },
  {
    line: /independence not written/,
    explains: ["independent"],
    model: () => coded({ independent: true }),
  },
  {
    line: /population cardinality not written/,
    explains: ["cardinality"],
    model: () => coded({ cardinality: { min: 1, max: 5 } }),
  },
  {
    line: /source context .* not written/,
    explains: ["sourceContext"],
    model: () => coded({ sourceContext: "sales" }),
  },
  {
    line: /note line not written/,
    explains: ["note"],
    model: () => coded({ note: "Kept by hand." }),
  },
  {
    line: /default value .* not written/,
    explains: ["defaultValue"],
    model: () => value({ defaultValue: "A" }),
  },
  {
    line: /no data type; written as String/,
    explains: ["dataTypeAdded"],
    model: () => value({ dataType: undefined }),
  },
  {
    line: /data type money written as Decimal/,
    explains: ["dataTypeChanged"],
    model: () => value({ dataType: { name: "money" } }),
  },
  {
    line: /data type length or scale not written/,
    explains: ["dataTypeChanged"],
    model: () => value({ dataType: { name: "text", length: 10 } }),
  },
  {
    line: /value constraint is not a shape/,
    explains: ["valueConstraint"],
    model: () =>
      value({
        dataType: { name: "integer" },
        valueConstraint: { values: ["1"], ranges: [{ min: "5", max: "9" }] },
      }),
  },
  {
    line: /no identifier Ossie can state; reference mode/,
    explains: ["referenceMode"],
    model: () => one({ name: "Thing", kind: "entity", referenceMode: "thing_code" }),
  },
  {
    line: /^Thing: reference mode thing_number not written/,
    explains: ["referenceMode"],
    model: () => coded({ referenceMode: "thing_number" }),
  },
  {
    line: /note comes back reordered/,
    explains: ["note"],
    model: () => coded({ note: "derived_by: a\n\nderived_by: b" }),
  },
  {
    line: /note line not written, it would read back as a mandatory role/,
    explains: ["note"],
    model: () => coded({ note: "requires: Thing.thing_code" }),
  },
  {
    // A stored identifier that is not one: the uniqueness on Thing's own
    // role. Its line and the no-identifier line fire together.
    line: /its preferred identifier is not one Ossie's identify_by can name/,
    explains: ["preferredIdentifier", "referenceMode"],
    model: () => {
      const c = coded();
      const ft = c.m.factTypes[0]!;
      const near = ft.internalConstraints.find((k) =>
        k.type === "internal_uniqueness" && k.roleIds[0] === ft.roles[0]!.id
      )!;
      c.m.setPreferredIdentifier(c.otId, near.id!);
      return c;
    },
  },
  {
    line: /^Student: reference mode student_number not written/,
    explains: ["referenceMode"],
    model: () => subtype({ referenceMode: "student_number" }),
  },
  {
    line: /note line not written: derived_by/,
    explains: ["note"],
    model: () => subtype({ referenceMode: "student_id", note: "derived_by: enrolled" }),
  },
  {
    line: /note line not written, it would read back as a constraint/,
    explains: ["note"],
    model: () => value({ note: "requires: Code == 'A'" }),
  },
  {
    line: /written as A_B, a name Ossie can read back/,
    explains: ["name"],
    model: () => value({ name: "A:B" }),
  },
];

describe("Ossie export: an object-type loss line covers what it explains", () => {
  for (const c of CASES) {
    it(`"${c.line.source}" explains ${c.explains.join(", ")}`, () => {
      const { m, otId } = c.model();
      const key = lossKey({ kind: "object_type", id: otId });
      const all = new OssieExportFormat().export(m).text;
      expect(all).toMatch(new RegExp(`# barwise: .*${c.line.source.replace(/^\^/, "")}`));
      expect(writeOssie(m).covers.get(key)).toEqual(new Set(c.explains));
      // Wide enough: with the line's set, nothing on the element is left.
      expect(linesOn(m, otId, () => {})).toEqual([]);
      // No spare kind: each one, taken out, leaves a change unexplained.
      for (const kind of c.explains) {
        const rest = c.explains.filter((k) => k !== kind);
        expect(linesOn(m, otId, (cv) => cv.set(key, new Set(rest)))).toHaveLength(1);
      }
    });
  }

  it("reports a preferred identifier that comes back, beside a reference-mode line (barwise-huw)", () => {
    // No stored identifier; an external uniqueness core reads as one, so
    // the writer writes it as identify_by. The reference mode is one Ossie
    // cannot write, and its line used to silence the identifier's change.
    const m = new OrmModel({ name: "M" });
    const student = m.addObjectType({
      id: id("ot"),
      name: "Student",
      kind: "entity",
      referenceMode: "pidm",
    });
    const binary = (name: string, playerName: string) => {
      const player = m.addObjectType({
        id: id("ot"),
        name: playerName,
        kind: "value",
        dataType: { name: "text" },
      });
      const roles = [
        { id: id("r"), name: "Student", playerId: student.id },
        { id: id("r"), name: playerName, playerId: player.id },
      ];
      m.addFactType({
        id: id("ft"),
        name,
        roles,
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", id: id("uc"), roleIds: [roles[0]!.id] },
          { type: "mandatory", id: id("m"), roleId: roles[0]!.id },
        ],
      });
      return roles[1]!.id;
    };
    m.addConstraint({
      type: "external_uniqueness",
      id: id("eu"),
      roleIds: [binary("Student.number", "StudentNumber"), binary("Student.campus", "Campus")],
    });
    const lines = linesOn(m, student.id, () => {});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^Object type: Student: comes back changed: preferred identifier: \(none\) -> external/,
    );
    expect(lines[0]).not.toMatch(/reference mode/);
  });
});

describe("Ossie export: a constraint naming another fact type's role (barwise-5x3)", () => {
  it("is reported once with a constraint spec, and the export completes", () => {
    const m = new OrmModel({ name: "M" });
    const person = m.addObjectType({
      id: id("ot"),
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const name = m.addObjectType({
      id: id("ot"),
      name: "Name",
      kind: "value",
      dataType: { name: "text" },
    });
    const age = m.addObjectType({
      id: id("ot"),
      name: "Age",
      kind: "value",
      dataType: { name: "integer" },
    });
    const nameRoles = [
      { id: id("r"), name: "Person", playerId: person.id },
      { id: id("r"), name: "Name", playerId: name.id },
    ];
    m.addFactType({
      id: id("ft"),
      name: "Person has Name",
      roles: nameRoles,
      readings: ["{0} has {1}"],
    });
    const ageRoles = [
      { id: id("r"), name: "Person", playerId: person.id },
      { id: id("r"), name: "Age", playerId: age.id },
    ];
    // The validation-errors fixture's shape: a uniqueness on Person has Age
    // over a role of Person has Name. The model loads; validation reports it.
    m.addFactType(
      {
        id: id("ft"),
        name: "Person has Age",
        roles: ageRoles,
        readings: ["{0} has {1}"],
        constraints: [{ type: "internal_uniqueness", id: "uc-stray", roleIds: [nameRoles[0]!.id] }],
        skipPlayerValidation: true,
      } as Parameters<OrmModel["addFactType"]>[0],
    );
    const result = new OssieExportFormat().export(m);
    const stray = result.text.split("\n").filter((l) =>
      l.includes("not one of this fact type's roles")
    );
    expect(stray).toEqual([
      "# barwise: fact type Person has Age: internal_uniqueness names a role that is not one of this fact type's roles; not written",
    ]);
    // Its one spec, the stray uniqueness: the other loss lines name no constraint.
    expect(result.constraintSpecs).toHaveLength(1);
    expect(result.constraintSpecs![0]!.verbalization).toMatch(/Person/);
  });
});
