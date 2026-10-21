/**
 * Constraint identity across NORMA import and export
 * (docs/specs/orm-format-3.spec.md, WS2). The importer keeps NORMA's
 * constraint ids, as it keeps object type ids, and an exported model whose
 * file omitted constraint ids exports the same document every time.
 */
import { OrmModel, OrmYamlSerializer, setIdGenerator } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectExclusiveOrPairs,
  createConstraintIdAllocator,
} from "../src/norma/mapping/context.js";
import { asNormaId, cardinalityId, NORMA_ID_TAGS, type NormaId } from "../src/norma/normaId.js";
import { mapNormaToOrm } from "../src/norma/NormaToOrmMapper.js";
import { parseNormaXml } from "../src/norma/NormaXmlParser.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import type {
  NormaConstraint,
  NormaExclusionConstraint,
  NormaJoinPath,
  NormaMandatoryConstraint,
  NormaRingConstraint,
  NormaUniquenessConstraint,
} from "../src/norma/NormaXmlTypes.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";

const here = dirname(fileURLToPath(import.meta.url));

const FIXTURES = [
  "orderManagement.orm",
  "personCountryDemo.orm",
  "universityEnrollment.orm",
  "employeeProject.orm",
];

function constraintIds(model: OrmModel): (string | undefined)[] {
  return model.everyConstraint().map(([c]) => c.id);
}

function normaIdsOf(doc: { constraints: readonly { id: string; }[]; }): Set<string> {
  return new Set(doc.constraints.map((c) => c.id));
}

function exportXml(model: OrmModel): string {
  return serializeNormaDocument(writeOrmToNorma(model));
}

/** Two unary fact types joined by an exclusive-or, id c-xor. */
function xorModel(): OrmModel {
  const model = new OrmModel({ name: "Xor" });
  const person = model.addObjectType({
    name: "Person",
    id: "ot-person",
    kind: "entity",
    referenceMode: "person_id",
  });
  model.addFactType({
    name: "Person is employed",
    id: "ft-employed",
    roles: [{ id: "r-employed", name: "is employed", playerId: person.id }],
    readings: ["{0} is employed"],
  });
  model.addFactType({
    name: "Person is retired",
    id: "ft-retired",
    roles: [{ id: "r-retired", name: "is retired", playerId: person.id }],
    readings: ["{0} is retired"],
  });
  model.addConstraint({ type: "exclusive_or", id: "c-xor", roleIds: ["r-employed", "r-retired"] });
  return model;
}

describe("NORMA import keeps constraint ids", () => {
  it.each(FIXTURES)("%s: every constraint keeps a NORMA constraint id", (fixture) => {
    // A counting generator makes any id the importer minted visible.
    setIdGenerator(() => "minted");
    try {
      const doc = parseNormaXml(readFileSync(resolve(here, "fixtures", fixture), "utf-8"));
      const normaIds = new Set<string>(doc.constraints.map((c) => c.id));
      const ids = constraintIds(mapNormaToOrm(doc));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(normaIds).toContain(id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      setIdGenerator(undefined);
    }
  });

  it.each(FIXTURES)("%s: imports to the same model every time", (fixture) => {
    // Fact types and subtype facts used to take generator ids, so two
    // imports of one file differed on every fact type id.
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const xml = readFileSync(resolve(here, "fixtures", fixture), "utf-8");
      const yaml = () => new OrmYamlSerializer().serialize(mapNormaToOrm(parseNormaXml(xml)));
      const first = yaml();
      expect(first).not.toContain("minted-");
      expect(yaml()).toBe(first);
    } finally {
      setIdGenerator(undefined);
    }
  });

  it("imports a file with sample data to the same model every time", () => {
    // Populations and fact instances used to take generator ids; the
    // fixtures carry no sample data, so they could not show it.
    const model = new OrmModel({ name: "Sample" });
    const person = model.addObjectType({
      name: "Person",
      id: "ot-person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addFactType({
      name: "Person is employed",
      id: "ft-employed",
      roles: [{ id: "r-employed", name: "is employed", playerId: person.id }],
      readings: ["{0} is employed"],
    });
    model.addFactType({
      name: "Person manages Person",
      id: "ft-manages",
      roles: [
        { id: "r-manager", name: "manages", playerId: person.id },
        { id: "r-managed", name: "is managed by", playerId: person.id },
      ],
      readings: ["{0} manages {1}"],
    });
    model.addPopulation({
      factTypeId: "ft-employed",
      instances: [{ roleValues: { "r-employed": "p1" } }],
    });
    model.addPopulation({
      factTypeId: "ft-manages",
      instances: [{ roleValues: { "r-manager": "p1", "r-managed": "p2" } }],
    });
    const xml = exportXml(model);
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const yaml = () => new OrmYamlSerializer().serialize(mapNormaToOrm(parseNormaXml(xml)));
      const first = yaml();
      expect(first).toContain("populations:");
      expect(first).not.toContain("minted-");
      expect(yaml()).toBe(first);
    } finally {
      setIdGenerator(undefined);
    }
  });

  it("gives an objectification link without a NestedPredicate id one that survives a round trip", () => {
    // The derived id must carry NORMA's _ prefix, or the export adds one and
    // the next import reads a different id.
    const xml = readFileSync(resolve(here, "fixtures", "universityEnrollment.orm"), "utf-8");
    const first = mapNormaToOrm(parseNormaXml(xml));
    const again = mapNormaToOrm(parseNormaXml(exportXml(first)));
    expect(again.objectifiedFactTypes.map((o) => o.id)).toEqual(
      first.objectifiedFactTypes.map((o) => o.id),
    );
  });

  it("keeps a NestedPredicate's own id for the objectification link when the file gives one", () => {
    const xml = readFileSync(resolve(here, "fixtures", "universityEnrollment.orm"), "utf-8");
    const withId = xml.replace(
      "<orm:NestedPredicate ref=",
      '<orm:NestedPredicate id="_np_enrolls" ref=',
    );
    expect(withId).not.toBe(xml);
    const first = mapNormaToOrm(parseNormaXml(withId));
    expect(first.objectifiedFactTypes.map((o) => o.id)).toEqual(["_np_enrolls"]);
    // ... and the export writes it back, so the next import agrees.
    const again = mapNormaToOrm(parseNormaXml(exportXml(first)));
    expect(again.objectifiedFactTypes.map((o) => o.id)).toEqual(["_np_enrolls"]);
  });

  it("keeps a named constraint's id verbatim", () => {
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    expect(constraintIds(mapNormaToOrm(doc))).toEqual(
      expect.arrayContaining(["_uc_emp_fn", "_mc_emp_fn"]),
    );
  });

  it.each(FIXTURES)("%s: a NORMA round trip keeps every constraint id", (fixture) => {
    const first = mapNormaToOrm(
      parseNormaXml(readFileSync(resolve(here, "fixtures", fixture), "utf-8")),
    );
    const second = mapNormaToOrm(parseNormaXml(exportXml(first)));
    expect([...constraintIds(second)].sort()).toEqual([...constraintIds(first)].sort());
  });

  it("never gives one id to two constraints when one NORMA constraint maps twice", () => {
    // A simple mandatory naming two roles maps to a mandatory on each, from
    // the same NORMA id. The fixtures never do this; a hand-edited file can.
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    // Two roles, in different fact types, that no mandatory covers yet; the
    // importer skips a mandatory a role already has.
    const base = mapNormaToOrm(doc);
    const free = base.factTypes.map((ft) =>
      ft.roles.find((r) =>
        !ft.internalConstraints.some((c) => c.type === "mandatory" && c.roleId === r.id)
      )
        ?.id
    ).filter((id): id is string => id !== undefined);
    const [first, second] = free.map(asNormaId);
    expect(second).toBeDefined();
    const twice: NormaMandatoryConstraint = {
      type: "mandatory",
      id: asNormaId("_mc_twice"),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [first!, second!],
    };
    const ids = constraintIds(mapNormaToOrm({ ...doc, constraints: [...doc.constraints, twice] }));
    expect(ids).toEqual(expect.arrayContaining(["_mc_twice", "_mc_twice_2"]));
    expect(ids).not.toContain(undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never gives one id to two constraints when two fact types list one NORMA constraint", () => {
    // A uniqueness whose roles fall in two fact types, listed in both
    // InternalConstraints, maps once per fact type; resolveConstraintsForFactType
    // deduplicates within one fact type only.
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    const [a, b] = doc.factTypes;
    // Deontic, so neither half says what the fixture's own uniqueness on
    // that role already says (the importer keeps one of two identical rules).
    const split: NormaUniquenessConstraint = {
      type: "uniqueness",
      id: asNormaId("_uc_split"),
      name: "",
      modality: "deontic",
      isInternal: true,
      isPreferred: false,
      roleRefs: [a!.roles[0]!.id, b!.roles[0]!.id],
    };
    const listedTwice = {
      ...doc,
      constraints: [...doc.constraints, split],
      factTypes: [
        { ...a!, internalConstraintRefs: [...a!.internalConstraintRefs, split.id] },
        { ...b!, internalConstraintRefs: [...b!.internalConstraintRefs, split.id] },
        ...doc.factTypes.slice(2),
      ],
    };
    const ids = constraintIds(mapNormaToOrm(listedTwice));
    expect(ids).toEqual(expect.arrayContaining(["_uc_split", "_uc_split_2"]));
    expect(ids).not.toContain(undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never hands a duplicate an id a real constraint holds", () => {
    // The duplicate of _mc_twice would be _mc_twice_2; a real constraint
    // already holds that id, so the duplicate must skip it.
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    const base = mapNormaToOrm(doc);
    const free = base.factTypes.map((ft) =>
      ft.roles.find((r) =>
        !ft.internalConstraints.some((c) => c.type === "mandatory" && c.roleId === r.id)
      )
        ?.id
    ).filter((id): id is string => id !== undefined).map(asNormaId);
    const twice: NormaMandatoryConstraint = {
      type: "mandatory",
      id: asNormaId("_mc_twice"),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [free[0]!, free[1]!],
    };
    const squatter: NormaMandatoryConstraint = {
      ...twice,
      id: asNormaId("_mc_twice_2"),
      roleRefs: [free[2]!],
    };
    // The squatter comes later in the document, so it claims after the duplicate.
    const ids = constraintIds(
      mapNormaToOrm({ ...doc, constraints: [...doc.constraints, twice, squatter] }),
    );
    expect(ids).toEqual(expect.arrayContaining(["_mc_twice", "_mc_twice_2", "_mc_twice_3"]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives an inline cardinality without an id one from its role, the same every time", () => {
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    const [ft, ...rest] = doc.factTypes;
    const [role, ...others] = ft!.roles;
    const withCard = {
      ...doc,
      factTypes: [
        {
          ...ft!,
          roles: [
            { ...role!, cardinality: { id: asNormaId(""), ranges: [{ from: 0, to: 1 }] } },
            ...others,
          ],
        },
        ...rest,
      ],
    };
    const cardinalityOf = (m: OrmModel) =>
      m.everyConstraint().map(([c]) => c).find((c) => c.type === "cardinality")?.id;
    // The importer's derived id for a cardinality NORMA wrote without one.
    expect(cardinalityOf(mapNormaToOrm(withCard))).toBe(cardinalityId(role!.id));

    // ... unless a real constraint holds that id; then it steps aside, and
    // the real constraint keeps its own whichever claims first.
    const squatter: NormaMandatoryConstraint = {
      type: "mandatory",
      id: cardinalityId(role!.id),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [role!.id],
    };
    const crowded = { ...withCard, constraints: [...withCard.constraints, squatter] };
    const ids = createConstraintIdAllocator(crowded, collectExclusiveOrPairs(crowded));
    expect(ids.claimCardinality(asNormaId(""), role!.id)).toBe(`${cardinalityId(role!.id)}_2`);
    expect(ids.claim(squatter)).toBe(cardinalityId(role!.id));
  });

  it("maps an exclusive-or once when two fact types list its halves", () => {
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )!;
    const [first, second] = doc.factTypes;
    for (const [inFirst, inSecond] of [[exclusion, exclusion], [mandatory, exclusion]]) {
      const listed = {
        ...doc,
        factTypes: [
          { ...first!, internalConstraintRefs: [...first!.internalConstraintRefs, inFirst!.id] },
          { ...second!, internalConstraintRefs: [...second!.internalConstraintRefs, inSecond!.id] },
          ...doc.factTypes.slice(2),
        ],
      };
      const xors = mapNormaToOrm(listed).everyConstraint().map(([c]) => c).filter((c) =>
        c.type === "exclusive_or"
      );
      expect(xors.map((c) => c.id)).toEqual(["_c-xor"]);
    }
  });

  it("names an exclusive-or by the mandatory's own coupler, whatever the document order", () => {
    // A file whose couplers disagree: the mandatory names one exclusion,
    // and a second exclusion names that mandatory.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )!;
    const rival = { ...exclusion, id: asNormaId("_rival"), exclusiveOrMandatoryRef: mandatory.id };
    const others = doc.constraints.filter((c) => c !== exclusion && c !== mandatory);
    for (const order of [[mandatory, exclusion, rival], [rival, exclusion, mandatory]]) {
      const xors = mapNormaToOrm({ ...doc, constraints: [...others, ...order] })
        .everyConstraint().map(([c]) => c).filter((c) => c.type === "exclusive_or");
      expect(xors.map((c) => c.id)).toEqual(["_c-xor"]);
    }
  });

  it("builds an exclusive-or from a coupled half whose partner cannot build it", () => {
    // Before, a coupled exclusion was always left to its mandatory, so a
    // deleted, one-role or losing partner meant the constraint was lost.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) =>
      c.type === "exclusion"
    )! as NormaExclusionConstraint;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )! as NormaMandatoryConstraint;
    const others = doc.constraints.filter((c) => c !== exclusion && c !== mandatory);
    const xorIds = (constraints: NormaConstraint[]) =>
      mapNormaToOrm({ ...doc, constraints }).everyConstraint().map(([c]) => c)
        .filter((c) => c.type === "exclusive_or").map((c) => c.id);

    // The mandatory is gone.
    expect(xorIds([...others, exclusion])).toEqual([exclusion.id]);
    // The exclusion is gone: the mandatory builds it, under its own id,
    // since no exclusion holds the pair's.
    expect(xorIds([...others, mandatory])).toEqual([mandatory.id]);
    // The mandatory names one role, so it cannot be an exclusive-or.
    expect(
      xorIds([...others, exclusion, { ...mandatory, roleRefs: mandatory.roleRefs.slice(0, 1) }]),
    )
      .toEqual([exclusion.id]);
    // A second exclusion, over other roles, names the mandatory, whose own
    // coupler names the first: the loser is not lost. Over one role it
    // cannot be an exclusive-or, so it maps as the exclusion it is.
    const rival = {
      ...exclusion,
      id: asNormaId("_rival"),
      roleSequences: exclusion.roleSequences.slice(0, 1),
    };
    const withRival = mapNormaToOrm({
      ...doc,
      constraints: [...others, mandatory, exclusion, rival],
    })
      .everyConstraint().map(([c]) => c);
    expect(withRival.filter((c) => c.type === "exclusive_or").map((c) => c.id)).toEqual([
      exclusion.id,
    ]);
    expect(withRival.find((c) => c.id === "_rival")?.type).toBe("exclusion");
  });

  it("keeps a coupled constraint that cannot be an exclusive-or under its own id", () => {
    // A simple mandatory carrying a coupler is still a plain mandatory: it
    // must not give its NORMA id up to an exclusive-or nothing will build.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const role = doc.factTypes[0]!.roles[0]!.id;
    const simple: NormaMandatoryConstraint = {
      type: "mandatory",
      id: asNormaId("_mc_simple"),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [role],
      exclusiveOrExclusionRef: exclusion.id,
    };
    const all = mapNormaToOrm({ ...doc, constraints: [...doc.constraints, simple] })
      .everyConstraint().map(([c]) => c);
    expect(all.find((c) => c.type === "mandatory")?.id).toBe("_mc_simple");
  });

  it("never counts an exclusion with a join path as an exclusive-or half", () => {
    // It maps as a join exclusion whatever its coupler says, so it must keep
    // its own id rather than hold one for an exclusive-or it never builds.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) =>
      c.type === "exclusion"
    )! as NormaExclusionConstraint;
    const joined = {
      ...exclusion,
      joinPaths: [{} as NormaJoinPath, undefined],
    };
    const crowded = { ...doc, constraints: [joined] };
    const pairs = collectExclusiveOrPairs(crowded);
    expect(pairs.exclusiveOrIds.has(joined.id)).toBe(false);
    expect(createConstraintIdAllocator(crowded, pairs).claim(joined)).toBe(joined.id);
  });

  it("consumes a paired exclusion into its exclusive-or, whatever its join path says", () => {
    // A path that does not decode used to drop the exclusion to a flat one,
    // and the exclusive-or then took the mandatory half's id: two
    // constraints where the file had one, and an id that moved every trip.
    const doc = parseNormaXml(exportXml(xorModel()));
    const constraints = doc.constraints.map((c) =>
      c.type === "exclusion" ? { ...c, joinPaths: [{} as NormaJoinPath, undefined] } : c
    );
    const exclusionId = constraints.find((c) => c.type === "exclusion")!.id;
    const [first, ...rest] = doc.factTypes;
    // Unlisted, and listed in a fact type, so both phases are asked.
    const listed = [
      doc.factTypes,
      [
        { ...first!, internalConstraintRefs: [...first!.internalConstraintRefs, exclusionId] },
        ...rest,
      ],
    ];
    for (const factTypes of listed) {
      const all = mapNormaToOrm({ ...doc, constraints, factTypes })
        .everyConstraint().map(([c]) => c);
      expect(all.filter((c) => c.type === "exclusion" || c.type === "join_exclusion")).toEqual([]);
      expect(all.filter((c) => c.type === "exclusive_or").map((c) => c.id)).toEqual(["_c-xor"]);
    }
  });

  it("builds a pair's exclusive-or from its mandatory, whichever half maps first", () => {
    // A listed exclusion whose sequences carry more roles, or another
    // modality, must not decide the pair's shape by being reached first.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) =>
      c.type === "exclusion"
    )! as NormaExclusionConstraint;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )! as NormaMandatoryConstraint;
    const [r1, r2] = exclusion.roleSequences.flat();
    const wider = {
      ...exclusion,
      roleSequences: [[r1!, r2!], [r2!]],
      modality: "deontic" as const,
    };
    const constraints = doc.constraints.map((c) => c === exclusion ? wider : c);
    const [first, ...rest] = doc.factTypes;
    const factTypes = [
      { ...first!, internalConstraintRefs: [...first!.internalConstraintRefs, exclusion.id] },
      ...rest,
    ];
    const xors = mapNormaToOrm({ ...doc, constraints, factTypes })
      .everyConstraint().map(([c]) => c).filter((c) => c.type === "exclusive_or");
    expect(xors).toHaveLength(1);
    expect(xors[0]).toMatchObject({ id: "_c-xor", roleIds: mandatory.roleRefs });
    expect(xors[0]!.modality).toBeUndefined();
  });

  it("pairs couplers that agree both ways before a one-way claim", () => {
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) =>
      c.type === "exclusion"
    )! as NormaExclusionConstraint;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )! as NormaMandatoryConstraint;
    // M1 claims the exclusion one way and comes first; M2 and the exclusion
    // name each other.
    const m1 = { ...mandatory, id: asNormaId("_m1") };
    const m2 = { ...mandatory, id: asNormaId("_m2") };
    const agreeing = { ...exclusion, exclusiveOrMandatoryRef: m2.id };
    const others = doc.constraints.filter((c) => c !== exclusion && c !== mandatory);
    const pairs = collectExclusiveOrPairs({ ...doc, constraints: [...others, m1, agreeing, m2] });
    expect(pairs.exclusionByMandatory.get("_m2")).toBe(exclusion.id);
    expect(pairs.exclusionByMandatory.has("_m1")).toBe(false);
  });

  it("never reads an exclusion over role pairs as an exclusive-or half", () => {
    // A coupled exclusion whose partner is gone builds the exclusive-or
    // itself only when it excludes single roles; flattening [r1, r2], [r3, r4]
    // would build a stronger constraint than the file states.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) =>
      c.type === "exclusion"
    )! as NormaExclusionConstraint;
    const [r1, r2] = exclusion.roleSequences.flat();
    const pairwise = { ...exclusion, roleSequences: [[r1!, r2!], [r2!, r1!]] };
    const pairs = collectExclusiveOrPairs({ ...doc, constraints: [pairwise] });
    expect(pairs.exclusiveOrIds.has(pairwise.id)).toBe(false);
    expect(
      collectExclusiveOrPairs({ ...doc, constraints: [exclusion] }).exclusiveOrIds.has(
        exclusion.id,
      ),
    )
      .toBe(true);
  });

  it("pairs an exclusion with one mandatory only", () => {
    // Two mandatories naming one exclusion: the second must not be skipped
    // as if the first had built its constraint.
    const doc = parseNormaXml(exportXml(xorModel()));
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )! as NormaMandatoryConstraint;
    const second: NormaMandatoryConstraint = {
      ...mandatory,
      id: asNormaId("_m_second"),
      modality: "deontic",
    };
    const xors = mapNormaToOrm({ ...doc, constraints: [...doc.constraints, second] })
      .everyConstraint().map(([c]) => c).filter((c) => c.type === "exclusive_or");
    expect(xors.map((c) => c.id)).toEqual(expect.arrayContaining(["_c-xor", "_m_second"]));
  });

  it("does not add an exclusive-or twice when its exclusion mapped onto another fact type", () => {
    // The exclusion half is listed in the second fact type, so phase 2
    // maps the pair there; the mandatory half names the first fact type's
    // role first, so the xor pass looks at the first fact type.
    const model = new OrmModel({ name: "Xor" });
    const person = model.addObjectType({
      name: "Person",
      id: "ot-person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addFactType({
      name: "Person is employed",
      id: "ft-employed",
      roles: [{ id: "r-employed", name: "is employed", playerId: person.id }],
      readings: ["{0} is employed"],
    });
    model.addFactType({
      name: "Person is retired",
      id: "ft-retired",
      roles: [{ id: "r-retired", name: "is retired", playerId: person.id }],
      readings: ["{0} is retired"],
    });
    model.addConstraint({
      type: "exclusive_or",
      id: "c-xor",
      roleIds: ["r-employed", "r-retired"],
    });
    const doc = parseNormaXml(exportXml(model));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const [first, second] = doc.factTypes;
    const listed = {
      ...doc,
      factTypes: [
        first!,
        { ...second!, internalConstraintRefs: [...second!.internalConstraintRefs, exclusion.id] },
        ...doc.factTypes.slice(2),
      ],
    };
    const xors = mapNormaToOrm(listed).everyConstraint().map(([c]) => c).filter((c) =>
      c.type === "exclusive_or"
    );
    expect(xors).toHaveLength(1);
    expect(xors[0]!.id).toBe("_c-xor");
  });

  it("never lets a fallback id take an id another kind of element holds", () => {
    // NORMA ids share one space: an object type, a role or the model itself
    // may hold the id a fallback would derive.
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    const role = doc.factTypes[0]!.roles[0]!;
    const fallback = cardinalityId(role.id);
    const [et, ...ets] = doc.entityTypes;
    const subtypeFact = {
      id: asNormaId("_sf"),
      subtypePlayerRef: et!.id,
      supertypePlayerRef: et!.id,
      providesIdentification: true,
    };
    for (
      const crowded of [
        { ...doc, entityTypes: [{ ...et!, id: fallback }, ...ets] },
        { ...doc, modelId: fallback },
        {
          ...doc,
          subtypeFacts: [{
            ...subtypeFact,
            subtypeRoleId: fallback,
            supertypeRoleId: asNormaId("_sup"),
          }],
        },
      ]
    ) {
      const ids = createConstraintIdAllocator(crowded, collectExclusiveOrPairs(crowded));
      expect(ids.claimCardinality(asNormaId(""), role.id)).toBe(`${fallback}_2`);
    }
  });

  it("pairs nothing through an empty id or an empty coupler ref", () => {
    // Keyed by "", one id-less half or one ref-less coupler would make every
    // id-less constraint in the file an exclusive-or half.
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )!;
    const others = doc.constraints.filter((c) => c !== exclusion && c !== mandatory);
    const pairs = collectExclusiveOrPairs({
      ...doc,
      constraints: [
        ...others,
        { ...mandatory, id: asNormaId("") },
        { ...exclusion, exclusiveOrMandatoryRef: asNormaId("") },
      ],
    });
    expect(pairs.exclusionByMandatory.has("")).toBe(false);
    expect(pairs.mandatoryByExclusion.has("")).toBe(false);
    expect(pairs.mandatoryByExclusion.has(exclusion.id)).toBe(false);
    expect(pairs.exclusiveOrIds.has("")).toBe(false);
  });

  it("refuses to build an exclusive-or from a constraint that pairs with nothing", () => {
    // Only a coupled half maps to an exclusive_or; anything else means the
    // mapper and the pairing disagree, which must not pass as a fresh id.
    const doc = parseNormaXml(exportXml(xorModel()));
    const ids = createConstraintIdAllocator(doc, collectExclusiveOrPairs(doc));
    const lone: NormaMandatoryConstraint = {
      type: "mandatory",
      id: asNormaId("_lone"),
      name: "",
      isSimple: false,
      isImplied: false,
      roleRefs: [],
    };
    expect(() => ids.buildExclusiveOr(lone, [])).toThrow(/pairs with nothing/);
  });

  it("maps either listed half as the exclusive-or, whichever coupler the file carries", () => {
    // Phase 1 asks the document's pairing, not the half's own coupler: with
    // only the other half's coupler, a listed half would otherwise map as a
    // plain exclusion or disjunctive mandatory, and the exclusive-or would
    // come out twice or not at all, by document order.
    const xml = exportXml(xorModel());
    const oneCoupler = [
      xml.replace(/<orm:ExclusiveOrMandatoryConstraint[^>]*\/>/g, ""),
      xml.replace(/<orm:ExclusiveOrExclusionConstraint[^>]*\/>/g, ""),
    ];
    for (const variant of oneCoupler) {
      expect(variant).not.toBe(xml);
      const doc = parseNormaXml(variant);
      for (const kind of ["exclusion", "mandatory"] as const) {
        const half = doc.constraints.find((c) =>
          c.type === kind && !("isSimple" in c && c.isSimple)
        )!;
        const [first, ...rest] = doc.factTypes;
        const listed = {
          ...doc,
          factTypes: [
            { ...first!, internalConstraintRefs: [...first!.internalConstraintRefs, half.id] },
            ...rest,
          ],
        };
        const all = mapNormaToOrm(listed).everyConstraint().map(([c]) => c);
        expect(all.filter((c) => c.type === "exclusion" || c.type === "disjunctive_mandatory"))
          .toEqual([]);
        expect(all.filter((c) => c.type === "exclusive_or").map((c) => c.id)).toEqual(["_c-xor"]);
      }
    }
  });

  it("builds a pair's exclusive-or once, under the exclusion's id", () => {
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )!;
    const ids = createConstraintIdAllocator(doc, collectExclusiveOrPairs(doc));
    expect(ids.buildExclusiveOr(mandatory, ["a", "b"])).toBe(exclusion.id);
    // The pair has its constraint now, whatever roles the other half names.
    expect(ids.buildExclusiveOr(exclusion, ["c", "d"])).toBeUndefined();
  });

  it("derives an id for a NORMA constraint the file gives none, from its content", () => {
    // The parser reads a missing id attribute as "". The generator would
    // fill it with a new id on every import, and a position would hand the
    // id to another constraint when one is inserted before it.
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    const base = mapNormaToOrm(doc);
    const free = base.factTypes.map((ft) =>
      ft.roles.find((r) =>
        !ft.internalConstraints.some((c) => c.type === "mandatory" && c.roleId === r.id)
      )
        ?.id
    ).filter((id): id is string => id !== undefined).map(asNormaId);
    const anonymous = (roleId: NormaId): NormaMandatoryConstraint => ({
      type: "mandatory",
      id: asNormaId(""),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [roleId],
    });
    const withAnonymous = {
      ...doc,
      constraints: [...doc.constraints, anonymous(free[0]!), anonymous(free[1]!)],
    };
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const first = constraintIds(mapNormaToOrm(withAnonymous));
      const second = constraintIds(mapNormaToOrm(withAnonymous));
      expect(second).toEqual(first);
      expect(first).not.toContain("");
      expect(first.some((id) => id?.startsWith("minted"))).toBe(false);
      expect(new Set(first).size).toBe(first.length);
      const derived = first.filter((id) => !normaIdsOf(doc).has(id!));
      expect(derived).toHaveLength(2);
      for (const id of derived) expect(id).toMatch(/^_[0-9a-f]{8}-[0-9a-f]{4}-8/);

      // Inserting another id-less constraint before them moves neither id.
      const inserted = {
        ...withAnonymous,
        constraints: [anonymous(free[2]!), ...withAnonymous.constraints],
      };
      expect(constraintIds(mapNormaToOrm(inserted))).toEqual(expect.arrayContaining(derived));
    } finally {
      setIdGenerator(undefined);
    }
  });

  /** The xor model's document with a second, distinct pair over the same roles. */
  function twoPairs() {
    const doc = parseNormaXml(exportXml(xorModel()));
    const exclusion = doc.constraints.find((c) => c.type === "exclusion")!;
    const mandatory = doc.constraints.find((c) =>
      c.type === "mandatory" && c.exclusiveOrExclusionRef !== undefined
    )! as NormaMandatoryConstraint;
    const exclusion2 = {
      ...exclusion,
      id: asNormaId("_x2"),
      exclusiveOrMandatoryRef: asNormaId("_m2"),
    };
    const mandatory2: NormaMandatoryConstraint = {
      ...mandatory,
      id: asNormaId("_m2"),
      exclusiveOrExclusionRef: asNormaId("_x2"),
    };
    return { doc, mandatory, mandatory2, exclusion2 };
  }

  it("keeps one exclusive-or when two pairs over the same roles are listed in one fact type", () => {
    const { doc, mandatory, mandatory2, exclusion2 } = twoPairs();
    const [first, ...rest] = doc.factTypes;
    const listed = {
      ...doc,
      constraints: [...doc.constraints, exclusion2, mandatory2],
      factTypes: [
        {
          ...first!,
          internalConstraintRefs: [...first!.internalConstraintRefs, mandatory.id, mandatory2.id],
        },
        ...rest,
      ],
    };
    const xors = mapNormaToOrm(listed).everyConstraint().map(([c]) => c).filter((c) =>
      c.type === "exclusive_or"
    );
    expect(xors.map((c) => c.id)).toEqual(["_c-xor"]);
  });

  it("keeps a deontic exclusive-or beside an alethic one over the same roles", () => {
    // The two say different things, so neither is merged into the other.
    const { doc, mandatory2, exclusion2 } = twoPairs();
    const deontic = {
      ...doc,
      constraints: [
        ...doc.constraints,
        { ...exclusion2, modality: "deontic" as const },
        { ...mandatory2, modality: "deontic" as const },
      ],
    };
    const xors = mapNormaToOrm(deontic).everyConstraint().map(([c]) => c).filter((c) =>
      c.type === "exclusive_or"
    );
    expect(xors.map((c) => [c.id, c.modality ?? "alethic"])).toEqual([
      ["_c-xor", "alethic"],
      ["_x2", "deontic"],
    ]);
  });

  it("keeps one exclusive-or when two pairs over the same roles map in different phases", () => {
    // The first pair is listed in the second fact type, so phase 1 maps it
    // there; the second is listed nowhere, and phase 2 would put it on the
    // first fact type, which holds no exclusive_or of its own.
    const { doc, mandatory, mandatory2, exclusion2 } = twoPairs();
    const [first, second, ...rest] = doc.factTypes;
    const listed = {
      ...doc,
      constraints: [...doc.constraints, exclusion2, mandatory2],
      factTypes: [
        first!,
        { ...second!, internalConstraintRefs: [...second!.internalConstraintRefs, mandatory.id] },
        ...rest,
      ],
    };
    const xors = mapNormaToOrm(listed).everyConstraint().map(([c]) => c).filter((c) =>
      c.type === "exclusive_or"
    );
    expect(xors.map((c) => c.id)).toEqual(["_c-xor"]);
  });

  it("gives an exclusive-or its exclusion's id, which the exporter writes it under", () => {
    const model = new OrmModel({ name: "Xor" });
    const person = model.addObjectType({
      name: "Person",
      id: "ot-person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addFactType({
      name: "Person is employed",
      id: "ft-employed",
      roles: [{ id: "r-employed", name: "is employed", playerId: person.id }],
      readings: ["{0} is employed"],
    });
    model.addFactType({
      name: "Person is retired",
      id: "ft-retired",
      roles: [{ id: "r-retired", name: "is retired", playerId: person.id }],
      readings: ["{0} is retired"],
    });
    model.addConstraint({
      type: "exclusive_or",
      id: "c-xor",
      roleIds: ["r-employed", "r-retired"],
    });
    const xml = exportXml(model);
    const back = mapNormaToOrm(parseNormaXml(xml));
    const xor = back.everyConstraint().map(([c]) => c).find((c) => c.type === "exclusive_or");
    expect(xor?.id).toBe("_c-xor");
    expect(xml).toContain('id="_c-xor"');

    // A hand-authored file may carry only the mandatory side's coupler.
    const mandatoryOnly = xml.replace(/<orm:ExclusiveOrMandatoryConstraint[^>]*\/>/g, "");
    expect(mandatoryOnly).not.toBe(xml);
    const back2 = mapNormaToOrm(parseNormaXml(mandatoryOnly));
    const xor2 = back2.everyConstraint().map(([c]) => c).find((c) => c.type === "exclusive_or");
    expect(xor2?.id).toBe("_c-xor");

    // ... or only the exclusion side's.
    const exclusionOnly = xml.replace(/<orm:ExclusiveOrExclusionConstraint[^>]*\/>/g, "");
    expect(exclusionOnly).not.toBe(xml);
    const back3 = mapNormaToOrm(parseNormaXml(exclusionOnly));
    const xor3 = back3.everyConstraint().map(([c]) => c).find((c) => c.type === "exclusive_or");
    expect(xor3?.id).toBe("_c-xor");
  });
});

describe("NORMA import keeps modality in every phase", () => {
  /** The xor model's document with its couplers removed: a plain exclusion and disjunctive mandatory. */
  function uncoupled() {
    const doc = parseNormaXml(exportXml(xorModel()));
    const constraints = doc.constraints.map((c) => {
      if (c.type === "exclusion") {
        const { exclusiveOrMandatoryRef: _drop, ...plain } = c;
        return plain;
      }
      if (c.type === "mandatory") {
        const { exclusiveOrExclusionRef: _drop, ...plain } = c;
        return plain;
      }
      return c;
    });
    return { doc, constraints };
  }

  it("keeps a deontic multi-fact constraint deontic when no fact type lists it", () => {
    const { doc, constraints } = uncoupled();
    const deontic = constraints.map((c) =>
      c.type === "exclusion" ? { ...c, modality: "deontic" as const } : c
    );
    const exclusion = mapNormaToOrm({ ...doc, constraints: deontic })
      .everyConstraint().map(([c]) => c).find((c) => c.type === "exclusion");
    expect(exclusion?.modality).toBe("deontic");
  });

  it("keeps a deontic external uniqueness beside an alethic one over the same roles", () => {
    const { doc, constraints } = uncoupled();
    const roleRefs = doc.factTypes.map((f) => f.roles[0]!.id);
    const external = (id: string, modality?: "deontic"): NormaUniquenessConstraint => ({
      type: "uniqueness",
      id: asNormaId(id),
      name: "",
      isInternal: false,
      isPreferred: false,
      roleRefs,
      ...(modality ? { modality } : {}),
    });
    const all = mapNormaToOrm({
      ...doc,
      constraints: [...constraints, external("_eu_a"), external("_eu_d", "deontic")],
    }).everyConstraint().map(([c]) => c).filter((c) => c.type === "external_uniqueness");
    expect(all.map((c) => [c.id, c.modality ?? "alethic"])).toEqual([
      ["_eu_a", "alethic"],
      ["_eu_d", "deontic"],
    ]);
  });

  it("keeps a deontic constraint beside an alethic one over the same roles", () => {
    const { doc, constraints } = uncoupled();
    const plain = constraints.find((c) => c.type === "mandatory" && !c.isSimple)!;
    const deontic = { ...plain, id: asNormaId("_dm_deontic"), modality: "deontic" as const };
    const disjunctive = mapNormaToOrm({ ...doc, constraints: [...constraints, deontic] })
      .everyConstraint().map(([c]) => c).filter((c) => c.type === "disjunctive_mandatory");
    expect(disjunctive.map((c) => c.modality ?? "alethic").sort()).toEqual(["alethic", "deontic"]);
  });
});

describe("NORMA import keeps every distinct constraint", () => {
  /** Three unary fact types and a ring-shaped binary, all played by Person. */
  function people() {
    const model = new OrmModel({ name: "People" });
    const person = model.addObjectType({
      name: "Person",
      id: "ot-person",
      kind: "entity",
      referenceMode: "person_id",
    });
    for (const name of ["employed", "retired", "insured"]) {
      model.addFactType({
        name: `Person is ${name}`,
        id: `ft-${name}`,
        roles: [{ id: `r-${name}`, name: `is ${name}`, playerId: person.id }],
        readings: [`{0} is ${name}`],
      });
    }
    model.addFactType({
      name: "Person manages Person",
      id: "ft-manages",
      roles: [
        { id: "r-manager", name: "manages", playerId: person.id },
        { id: "r-managed", name: "is managed by", playerId: person.id },
      ],
      readings: ["{0} manages {1}"],
    });
    return parseNormaXml(exportXml(model));
  }

  const ids = (doc: ReturnType<typeof people>, extra: NormaConstraint[]) =>
    mapNormaToOrm({ ...doc, constraints: [...doc.constraints, ...extra] })
      .everyConstraint().map(([c]) => c).map((c) => c.id);

  it("keeps two subsets from one role into different roles", () => {
    // NORMA writes this whenever one role is a subset of two others.
    const subset = (id: string, superset: string): NormaConstraint => ({
      type: "subset",
      id: asNormaId(id),
      name: "",
      subsetRoleRefs: [asNormaId("_r-employed")],
      supersetRoleRefs: [asNormaId(superset)],
    });
    expect(ids(people(), [subset("_s1", "_r-retired"), subset("_s2", "_r-insured")]))
      .toEqual(expect.arrayContaining(["_s1", "_s2"]));
  });

  it("keeps two equalities that share their first role sequence", () => {
    const equality = (id: string, second: string): NormaConstraint => ({
      type: "equality",
      id: asNormaId(id),
      name: "",
      roleSequences: [["_r-employed"], [second]],
    });
    expect(ids(people(), [equality("_e1", "_r-retired"), equality("_e2", "_r-insured")]))
      .toEqual(expect.arrayContaining(["_e1", "_e2"]));
  });

  it("keeps two ring constraints of different types on one role pair", () => {
    const ring = (id: string, ringType: NormaRingConstraint["ringType"]): NormaConstraint => ({
      type: "ring",
      id: asNormaId(id),
      name: "",
      ringType,
      roleRefs: [asNormaId("_r-manager"), asNormaId("_r-managed")],
    });
    expect(ids(people(), [ring("_ring1", "irreflexive"), ring("_ring2", "asymmetric")]))
      .toEqual(expect.arrayContaining(["_ring1", "_ring2"]));
  });

  it("keeps one of two identical rules whether or not a fact type lists them", () => {
    // Phase 3 always kept one of two constraints saying the same thing;
    // phase 1 kept both, so listing decided the outcome.
    const doc = people();
    const role = asNormaId("_r-employed");
    const mc = (id: string): NormaMandatoryConstraint => ({
      type: "mandatory",
      id: asNormaId(id),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [role],
    });
    const ft = doc.factTypes.find((f) => f.roles.some((r) => r.id === role))!;
    // Neither listed, one listed, both listed.
    for (const listed of [[], ["_u1"], ["_u1", "_u2"]]) {
      const all = mapNormaToOrm({
        ...doc,
        constraints: [...doc.constraints, mc("_u1"), mc("_u2")],
        factTypes: doc.factTypes.map((f) =>
          f === ft
            ? {
              ...f,
              internalConstraintRefs: [...f.internalConstraintRefs, ...listed.map(asNormaId)],
            }
            : f
        ),
      }).everyConstraint().map(([c]) => c).map((c) => c.id);
      expect(all.filter((id) => id === "_u1" || id === "_u2")).toHaveLength(1);
    }
  });

  it("still adds one constraint once when it says what another already says", () => {
    const subset = (id: string): NormaConstraint => ({
      type: "subset",
      id: asNormaId(id),
      name: "",
      subsetRoleRefs: [asNormaId("_r-employed")],
      supersetRoleRefs: [asNormaId("_r-retired")],
    });
    const all = ids(people(), [subset("_s1"), subset("_s2")]);
    expect(all).toContain("_s1");
    expect(all).not.toContain("_s2");
  });
});

describe("NORMA id derivation tags", () => {
  it("are pinned: editing one re-keys every model ever imported", () => {
    expect(NORMA_ID_TAGS).toEqual({
      constraint: "barwise.norma-constraint",
      population: "barwise.norma-population",
      unaryInstance: "barwise.norma-unary-instance",
      objectification: "barwise.norma-objectification",
    });
  });
});

describe("NORMA export of a file that omits constraint ids", () => {
  it("drops an exclusive-or whose mandatory half's id is already written", () => {
    // The exporter writes an exclusive-or's mandatory half as
    // `<exclusion-id>_xormand`; a constraint already holding that id makes
    // the exclusive-or a repeat, never a second element with one id.
    const model = xorModel();
    model.addConstraint({
      type: "disjunctive_mandatory",
      id: "c-xor_xormand",
      roleIds: ["r-employed", "r-retired"],
    });
    const ids = writeOrmToNorma(model).constraints.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops a repeated constraint id whole, leaving no second InternalConstraints entry", () => {
    // WS4 refuses a duplicate id on load; until then the writer keeps the
    // first constraint, and must not name the id twice in the fact.
    const model = new OrmModel({ name: "Dup" });
    const person = model.addObjectType({
      name: "Person",
      id: "ot-person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addFactType({
      name: "Person is employed",
      id: "ft-employed",
      roles: [{ id: "r-employed", name: "is employed", playerId: person.id }],
      readings: ["{0} is employed"],
      constraints: [
        { type: "mandatory", id: "c-dup", roleId: "r-employed" },
        { type: "internal_uniqueness", id: "c-dup", roleIds: ["r-employed"] },
      ],
    });
    const doc = writeOrmToNorma(model);
    expect(doc.factTypes[0]!.internalConstraintRefs).toEqual(["_c-dup"]);
    expect(doc.constraints.filter((c) => c.id === "_c-dup")).toHaveLength(1);
  });

  it("exports a constraint added in code under the id addConstraint gave it (barwise-nkq)", () => {
    // The writer once fell back to a positional `<ft>_c<i>` id for a
    // constraint with none; addConstraint now fills one, and the writer
    // uses it rather than inventing another.
    const model = xorModel();
    const ft = model.getFactType("ft-employed")!;
    ft.addConstraint({ type: "mandatory", roleId: "r-employed" });
    const filled = ft.internalConstraints.at(-1)!.id!;
    expect(filled).toEqual(expect.any(String));

    const doc = writeOrmToNorma(model);
    expect(normaIdsOf(doc).has(`_${filled}`)).toBe(true);
    expect([...normaIdsOf(doc)].some((id) => /_c\d+$/.test(id))).toBe(false);
  });

  it("writes the same document on every export", () => {
    const shop = readFileSync(
      resolve(here, "../../../examples/getting-started/shop.orm.yaml"),
      "utf-8",
    );
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const first = exportXml(new OrmYamlSerializer().deserialize(shop));
      const second = exportXml(new OrmYamlSerializer().deserialize(shop));
      expect(second).toBe(first);
    } finally {
      setIdGenerator(undefined);
    }
  });
});
