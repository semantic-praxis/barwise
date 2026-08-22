/**
 * The rest of the validator, swept the same way
 * (docs/specs/validation-rule-audit.spec.md, barwise-834).
 *
 * barwise-831 audited `constraintConsistency` and deferred the other
 * eight rule modules. This covers them, and the result is worth stating
 * because it inverts the run that preceded it: 51 error-severity sites
 * across eight modules, and **one** gap.
 *
 * Most of the validator is unreachable from the extraction path, and
 * unreachable by construction rather than by luck -- the parser
 * resolves every name against what it has already built and skips what
 * it cannot resolve, so a dangling role, a subtype naming a missing
 * entity, and an objectification pointing at a missing fact type are
 * all dropped before a model exists. The sweep below asserts that,
 * rather than trusting it: a parser change that started admitting
 * unresolved names would fail these.
 *
 * The one gap is `structural/subtype-cycle`. Both edges of a two-node
 * cycle resolve perfectly well, so nothing stopped them.
 */
import { ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseDraftModel } from "../src/DraftModelParser.js";
import { enforceConformance } from "../src/ExtractionConformance.js";
import type { ExtractionResponse } from "../src/ExtractionTypes.js";

const REF = [{ lines: [1, 2] as [number, number], excerpt: "test" }];
const ot = (name: string, kind: "entity" | "value" = "entity") => ({
  name,
  kind,
  source_references: REF,
});
const st = (subtype: string, supertype: string) => ({
  subtype,
  supertype,
  description: `${subtype} is a ${supertype}`,
  source_references: REF,
});

function response(over: Partial<ExtractionResponse> = {}): ExtractionResponse {
  return {
    object_types: [ot("Staff"), ot("Manager"), ot("Director"), ot("Person")],
    fact_types: [{
      name: "Staff reports to Manager",
      reading: "Staff reports to Manager",
      roles: [
        { player: "Staff", role_name: "reports to" },
        { player: "Manager", role_name: "manages" },
      ],
      source_references: REF,
    }],
    subtypes: [],
    inferred_constraints: [],
    ambiguities: [],
    ...over,
  } as ExtractionResponse;
}

function subtypeNames(res: ExtractionResponse): string[] {
  return res.subtypes.map((s) => `${s.subtype}<${s.supertype}`);
}

describe("a subtype cycle", () => {
  it("is broken by dropping the edge that closes it", () => {
    const { response: cleaned, corrections } = enforceConformance(response({
      subtypes: [st("Manager", "Staff"), st("Staff", "Manager")],
    }));

    // Order-dependent by design, so this asserts WHICH edge survives.
    // The first declaration is the one the extraction committed to
    // first; dropping it instead would be equally cycle-free and
    // arbitrary.
    expect(subtypeNames(cleaned)).toEqual(["Manager<Staff"]);
    expect(corrections.filter((c) => c.category === "subtype_cycle")).toHaveLength(1);
  });

  it("catches a self-edge, which is a cycle of length one", () => {
    // A two-node-minimum assumption would let this through, and
    // "Manager is a Manager" is exactly the kind of thing a confused
    // extraction emits.
    const { response: cleaned, corrections } = enforceConformance(response({
      subtypes: [st("Manager", "Manager")],
    }));

    expect(cleaned.subtypes).toEqual([]);
    expect(corrections.filter((c) => c.category === "subtype_cycle")).toHaveLength(1);
  });

  it("catches a longer cycle, not just a pair", () => {
    const { response: cleaned } = enforceConformance(response({
      subtypes: [st("Director", "Manager"), st("Manager", "Staff"), st("Staff", "Director")],
    }));

    expect(subtypeNames(cleaned)).toEqual(["Director<Manager", "Manager<Staff"]);
  });

  it("leaves the model free of subtype-cycle errors, end to end", () => {
    const { response: cleaned } = enforceConformance(response({
      subtypes: [st("Manager", "Staff"), st("Staff", "Manager")],
    }));
    const { model } = parseDraftModel(cleaned, "Cycle");

    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("a legal hierarchy survives", () => {
  it("keeps a deep chain", () => {
    const { response: cleaned, corrections } = enforceConformance(response({
      subtypes: [st("Director", "Manager"), st("Manager", "Staff"), st("Staff", "Person")],
    }));

    expect(cleaned.subtypes).toHaveLength(3);
    expect(corrections.filter((c) => c.category === "subtype_cycle")).toEqual([]);
  });

  it("keeps a diamond, which is not a cycle", () => {
    // Two paths from Director up to Person is legal ORM. A check
    // written with one visited-set across the whole walk would reject
    // the second path as already-seen, which is why reachability is
    // tested per edge.
    const { response: cleaned, corrections } = enforceConformance(response({
      object_types: [ot("Person"), ot("Staff"), ot("Manager"), ot("Director")],
      subtypes: [
        st("Staff", "Person"),
        st("Manager", "Person"),
        st("Director", "Staff"),
        st("Director", "Manager"),
      ],
    }));

    expect(cleaned.subtypes).toHaveLength(4);
    expect(corrections.filter((c) => c.category === "subtype_cycle")).toEqual([]);
  });
});

/**
 * One malformed shape per structural error rule the extraction
 * vocabulary can express. Eleven of these are stopped by the parser
 * rather than by conformance, and the sweep asserts the outcome -- no
 * error reaches the model -- rather than the mechanism, so a fix that
 * moved responsibility between the two still passes.
 */
const MALFORMED: ReadonlyArray<readonly [string, ExtractionResponse]> = [
  [
    "duplicate object type name",
    response({
      object_types: [ot("Staff"), ot("Manager"), ot("Staff")],
    }),
  ],
  [
    "duplicate fact type name",
    response({
      fact_types: [
        {
          name: "Staff reports to Manager",
          reading: "r",
          roles: [{ player: "Staff", role_name: "a" }, { player: "Manager", role_name: "b" }],
          source_references: REF,
        },
        {
          name: "Staff reports to Manager",
          reading: "r",
          roles: [{ player: "Staff", role_name: "c" }, { player: "Manager", role_name: "d" }],
          source_references: REF,
        },
      ],
    }),
  ],
  ["subtype naming a missing entity", response({ subtypes: [st("Ghost", "Staff")] })],
  ["supertype naming a missing entity", response({ subtypes: [st("Staff", "Ghost")] })],
  [
    "subtype of a value type",
    response({
      object_types: [ot("Staff"), ot("Manager"), ot("Colour", "value")],
      subtypes: [st("Colour", "Staff")],
    }),
  ],
  [
    "subtype cycle",
    response({
      subtypes: [st("Manager", "Staff"), st("Staff", "Manager")],
    }),
  ],
  [
    "objectification of a missing fact type",
    response({
      objectified_fact_types: [{
        fact_type: "Ghost fact",
        object_type: "Person",
        description: "d",
        source_references: REF,
      }],
    }),
  ],
  [
    "objectification naming a missing object type",
    response({
      objectified_fact_types: [{
        fact_type: "Staff reports to Manager",
        object_type: "Ghost",
        description: "d",
        source_references: REF,
      }],
    }),
  ],
  [
    "objectification as a value type",
    response({
      object_types: [ot("Staff"), ot("Manager"), ot("Reporting", "value")],
      objectified_fact_types: [{
        fact_type: "Staff reports to Manager",
        object_type: "Reporting",
        description: "d",
        source_references: REF,
      }],
    }),
  ],
  [
    "a role naming a missing player",
    response({
      fact_types: [{
        name: "Staff reports to Manager",
        reading: "r",
        roles: [{ player: "Staff", role_name: "a" }, { player: "Ghost", role_name: "b" }],
        source_references: REF,
      }],
    }),
  ],
];

describe("nothing surviving conformance produces a structural error", () => {
  it.each(MALFORMED)("%s", (_label, payload) => {
    const { response: cleaned } = enforceConformance(payload);
    const { model } = parseDraftModel(cleaned, "Structural");

    // Severity `error` only, for the same reason as the constraint
    // sweep: `structural/binary-missing-inverse-reading` is a warning
    // and is deliberately not suppressed -- it is the feedback a
    // modeller wants, and one of the promotion candidates barwise-813
    // is trying to price.
    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error" && d.ruleId?.startsWith("structural/"));

    expect(errors.map((d) => `${d.ruleId}: ${d.message}`)).toEqual([]);
  });
});
