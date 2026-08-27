/**
 * Licensed names (docs/specs/eval-name-licensing.spec.md, workstream 1).
 *
 * The shape under test is the recorded university-enrollment collapse:
 * a candidate that models the offering correctly, names it with the
 * transcript's dominant word ("Offering"), and records no alias -- so
 * alias and normalization matching have nothing to work with. A case
 * declaring the two words one concept must rescue both check families;
 * a case declaring nothing must resolve exactly as before.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { evaluateCandidate } from "../src/evaluate/evaluateCandidate.js";
import { getObjectTypeByNameOrAlias } from "../src/evaluate/nameResolution.js";
import { ExerciseParseError, parseVocabulary } from "../src/exercise/parseExercise.js";
import type { GymCheck, GymExercise, NameLicence } from "../src/exercise/types.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const LICENCE: NameLicence = [["CourseOffering", "Offering"]];

/** The reference's shape: the rubric's own word, constraint encoded. */
function referenceModel(): OrmModel {
  return new ModelBuilder("ref")
    .withEntityType("Course")
    .withEntityType("CourseOffering")
    .withEntityType("Student")
    .withBinaryFactType("CourseOffering is of Course", {
      role1: { player: "CourseOffering", name: "is of" },
      role2: { player: "Course", name: "has" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Student enrolls in CourseOffering", {
      role1: { player: "Student", name: "enrolls in" },
      role2: { player: "CourseOffering", name: "has enrolled" },
    })
    .build();
}

/** The collapsed run's shape: same structure, the domain's other word, no alias. */
function synonymCandidate(): OrmModel {
  return new ModelBuilder("cand")
    .withEntityType("Course")
    .withEntityType("Offering")
    .withEntityType("Student")
    .withBinaryFactType("Offering is of Course", {
      role1: { player: "Offering", name: "is of" },
      role2: { player: "Course", name: "has" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Student enrolls in Offering", {
      role1: { player: "Student", name: "enrolls in" },
      role2: { player: "Offering", name: "has enrolled" },
    })
    .build();
}

function exercise(checks: GymCheck[], vocabulary?: NameLicence): GymExercise {
  return {
    id: "university-enrollment",
    title: "University enrollment",
    transition: { from: "novice", to: "initiate" },
    exitPerformance: "n/a (test)",
    brief: "n/a (test)",
    ...(vocabulary !== undefined ? { vocabulary } : {}),
    checks,
  };
}

const RUBRIC: GymCheck[] = [
  { kind: "requires_element", element: { entity: "CourseOffering" } },
  { kind: "requires_element", element: { factTypeBetween: ["Student", "CourseOffering"] } },
  {
    kind: "forbids_population",
    factType: "CourseOffering is of Course",
    constraint: "internal_uniqueness",
  },
];

describe("getObjectTypeByNameOrAlias with a licence", () => {
  it("resolves a licensed synonym the candidate recorded no alias for", () => {
    const found = getObjectTypeByNameOrAlias(synonymCandidate(), "CourseOffering", LICENCE);
    expect(found?.name).toBe("Offering");
  });

  it("resolves nothing without the licence (the pre-licence behaviour)", () => {
    expect(getObjectTypeByNameOrAlias(synonymCandidate(), "CourseOffering")).toBeUndefined();
  });

  it("is append-only: an exact match wins over a licensed one", () => {
    // A model carrying BOTH words as distinct types must resolve each
    // to itself -- the licence may never redirect a lookup that already
    // succeeds.
    const both = new ModelBuilder("both")
      .withEntityType("CourseOffering")
      .withEntityType("Offering")
      .build();
    expect(getObjectTypeByNameOrAlias(both, "CourseOffering", LICENCE)?.name)
      .toBe("CourseOffering");
    expect(getObjectTypeByNameOrAlias(both, "Offering", LICENCE)?.name).toBe("Offering");
  });

  it("never matches by substring: Course stays distinct from CourseOffering", () => {
    // Synonymy is declared, not inferred. "Course" is in no licence
    // set, so a model carrying only CourseOffering must not satisfy a
    // lookup for Course -- with or without the licence declared.
    const model = new ModelBuilder("sub").withEntityType("CourseOffering").build();
    expect(getObjectTypeByNameOrAlias(model, "Course", LICENCE)).toBeUndefined();
    expect(getObjectTypeByNameOrAlias(model, "Course")).toBeUndefined();
  });
});

describe("evaluateCandidate with a licensed vocabulary", () => {
  it("passes both check families for the synonym candidate", () => {
    const report = evaluateCandidate(
      synonymCandidate(),
      exercise(RUBRIC, LICENCE),
      referenceModel(),
    );
    expect(report.results.map((r) => r.passed)).toEqual([true, true, true]);
  });

  it("mutation check: dropping the licence restores every failure", () => {
    // Guards against the resolver having been loosened instead of
    // licensed: if the passes above came from substring or fuzzy
    // matching, they would survive the licence's removal.
    const report = evaluateCandidate(
      synonymCandidate(),
      exercise(RUBRIC),
      referenceModel(),
    );
    expect(report.results.map((r) => r.passed)).toEqual([false, false, false]);
  });

  it("changes nothing for a candidate using the rubric's own word", () => {
    const report = evaluateCandidate(
      referenceModel(),
      exercise(RUBRIC, LICENCE),
      referenceModel(),
    );
    expect(report.passed).toBe(true);
  });
});

describe("parseVocabulary", () => {
  it("accepts licence sets and returns undefined when absent", () => {
    expect(parseVocabulary(undefined, "exercise")).toBeUndefined();
    expect(parseVocabulary([["CourseOffering", "Offering"]], "exercise"))
      .toEqual([["CourseOffering", "Offering"]]);
  });

  it("rejects a set of fewer than two words", () => {
    expect(() => parseVocabulary([["CourseOffering"]], "exercise"))
      .toThrow(ExerciseParseError);
  });

  it("rejects a word licensed in two sets, comparing normalized", () => {
    // "Course Offering" and "CourseOffering" are one word to the
    // resolver, so declaring them in two sets would make the sets
    // collide through it.
    expect(() =>
      parseVocabulary(
        [["CourseOffering", "Offering"], ["Course Offering", "Section"]],
        "exercise",
      )
    ).toThrow(/licenses "Course Offering" twice/);
  });

  it("rejects a non-list and a set of non-strings", () => {
    expect(() => parseVocabulary("CourseOffering", "exercise")).toThrow(ExerciseParseError);
    expect(() => parseVocabulary([[1, 2]], "exercise")).toThrow(ExerciseParseError);
  });
});
