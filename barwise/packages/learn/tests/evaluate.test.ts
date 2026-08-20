import type { OrmModel } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import { describe, expect, it } from "vitest";
import { mustValidate } from "../src/evaluate/checks/mustValidate.js";
import { evaluateCandidate } from "../src/evaluate/evaluateCandidate.js";
import { getObjectTypeByNameOrAlias } from "../src/evaluate/nameResolution.js";
import type { GymCheck, GymExercise } from "../src/exercise/types.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

/** "Customer places Order", with the Order role optionally unique. */
function customerOrder(withUniqueness: boolean): OrmModel {
  const role1 = { player: "Customer", name: "places" } as const;
  const role2 = { player: "Order", name: "is placed by" } as const;
  return new ModelBuilder("CO")
    .withEntityType("Customer")
    .withEntityType("Order")
    .withBinaryFactType(
      "Customer places Order",
      withUniqueness ? { role1, role2, uniqueness: "role2" } : { role1, role2 },
    )
    .build();
}

/** Just the two object types, no fact type between them. */
function bareEntities(): OrmModel {
  return new ModelBuilder("bare")
    .withEntityType("Customer")
    .withEntityType("Order")
    .build();
}

function exercise(checks: GymCheck[]): GymExercise {
  return {
    id: "customer-order",
    title: "Customer places Order",
    transition: { from: "novice", to: "initiate" },
    exitPerformance: "Model the fact type and constrain it unaided.",
    brief: "Model that a customer places orders, each order by one customer.",
    checks,
  };
}

const uniquenessSentence = new Verbalizer()
  .verbalizeModel(customerOrder(true))
  .map((v) => v.text)
  .find((t) => t.includes("at most one"))!;

describe("mustValidate", () => {
  it("passes a structurally valid model", () => {
    expect(mustValidate(customerOrder(true)).passed).toBe(true);
  });
});

describe("requires_verbalization", () => {
  it("passes when the required sentence is produced", () => {
    const report = evaluateCandidate(
      customerOrder(true),
      exercise([{ kind: "requires_verbalization", sentence: uniquenessSentence }]),
    );
    expect(report.passed).toBe(true);
  });

  it("fails when the sentence is absent", () => {
    const report = evaluateCandidate(
      customerOrder(false),
      exercise([{
        kind: "requires_verbalization",
        sentence: uniquenessSentence,
        hint: "Add a uniqueness constraint.",
      }]),
    );
    expect(report.passed).toBe(false);
    expect(report.results[0]!.hint).toBe("Add a uniqueness constraint.");
  });
});

describe("requires_element", () => {
  it("passes when the object type exists", () => {
    const report = evaluateCandidate(
      customerOrder(true),
      exercise([{ kind: "requires_element", element: { entity: "Order" } }]),
    );
    expect(report.passed).toBe(true);
  });

  it("fails when the object type is missing", () => {
    const report = evaluateCandidate(
      customerOrder(true),
      exercise([{ kind: "requires_element", element: { entity: "Invoice" } }]),
    );
    expect(report.passed).toBe(false);
  });

  it("passes when a fact type connects two object types", () => {
    const report = evaluateCandidate(
      customerOrder(true),
      exercise([{ kind: "requires_element", element: { factTypeBetween: ["Customer", "Order"] } }]),
    );
    expect(report.passed).toBe(true);
  });

  it("fails when no fact type connects them", () => {
    const report = evaluateCandidate(
      bareEntities(),
      exercise([{ kind: "requires_element", element: { factTypeBetween: ["Customer", "Order"] } }]),
    );
    expect(report.passed).toBe(false);
  });
});

describe("forbids_population", () => {
  const check: GymCheck = {
    kind: "forbids_population",
    factType: "Customer places Order",
    constraint: "internal_uniqueness",
    hint: "Each order is placed by at most one customer.",
  };
  const reference = customerOrder(true);

  it("passes when the candidate encodes the constraint", () => {
    const report = evaluateCandidate(customerOrder(true), exercise([check]), reference);
    expect(report.passed).toBe(true);
  });

  it("fails when the candidate omits the constraint", () => {
    const report = evaluateCandidate(customerOrder(false), exercise([check]), reference);
    expect(report.passed).toBe(false);
    expect(report.results[0]!.hint).toBe(check.hint);
  });

  it("fails when the candidate lacks the relationship entirely", () => {
    const report = evaluateCandidate(bareEntities(), exercise([check]), reference);
    expect(report.passed).toBe(false);
  });

  it("does not mutate the candidate", () => {
    const candidate = customerOrder(true);
    const before = candidate.populations.length;
    evaluateCandidate(candidate, exercise([check]), reference);
    expect(candidate.populations.length).toBe(before);
  });

  it("reports an exercise error when no reference is provided", () => {
    const report = evaluateCandidate(customerOrder(true), exercise([check]));
    expect(report.passed).toBe(false);
    expect(report.results[0]!.message).toContain("reference");
  });
});

describe("evaluateCandidate", () => {
  it("is deterministic (byte-identical reports)", () => {
    const ex = exercise([
      { kind: "must_validate" },
      { kind: "requires_element", element: { entity: "Order" } },
    ]);
    const a = evaluateCandidate(customerOrder(true), ex);
    const b = evaluateCandidate(customerOrder(true), ex);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("passes only when every check passes", () => {
    const report = evaluateCandidate(
      customerOrder(false),
      exercise([
        { kind: "must_validate" },
        { kind: "requires_verbalization", sentence: uniquenessSentence },
      ]),
    );
    expect(report.passed).toBe(false);
    expect(report.results[0]!.passed).toBe(true); // must_validate
    expect(report.results[1]!.passed).toBe(false); // missing uniqueness sentence
  });
});

describe("alias-aware matching", () => {
  /** Like customerOrder(true) but the customer concept is named "Client",
   *  recording the rubric's vocabulary ("Customer") as an alias. */
  function clientOrder(): OrmModel {
    return new ModelBuilder("alias")
      .withEntityType("Client", { aliases: ["Customer"] })
      .withEntityType("Order")
      .withBinaryFactType("Client places Order", {
        role1: { player: "Client", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .build();
  }

  it("requires_element resolves an entity by alias", () => {
    const report = evaluateCandidate(
      clientOrder(),
      exercise([{ kind: "requires_element", element: { entity: "Customer" } }]),
    );
    expect(report.passed).toBe(true);
  });

  it("requires_element resolves factTypeBetween endpoints by alias", () => {
    const report = evaluateCandidate(
      clientOrder(),
      exercise([{ kind: "requires_element", element: { factTypeBetween: ["Customer", "Order"] } }]),
    );
    expect(report.passed).toBe(true);
  });

  it("forbids_population maps the reference population onto an aliased player", () => {
    const report = evaluateCandidate(
      clientOrder(),
      exercise([{
        kind: "forbids_population",
        factType: "Customer places Order",
        constraint: "internal_uniqueness",
      }]),
      customerOrder(true),
    );
    expect(report.passed).toBe(true);
  });

  it("still fails when neither name nor alias matches", () => {
    const report = evaluateCandidate(
      clientOrder(),
      exercise([{ kind: "requires_element", element: { entity: "Purchaser" } }]),
    );
    expect(report.passed).toBe(false);
  });
});

describe("compound-term matching across spellings", () => {
  /** The shape the extractor actually produces on the
   *  university-enrollment eval case: the concept is reified, named
   *  "Offering", and records the rubric's term with a space. */
  function spacedAlias(): OrmModel {
    return new ModelBuilder("spacing")
      .withEntityType("Offering", { aliases: ["Course Offering"] })
      .withEntityType("Student")
      .withBinaryFactType("Student enrolls in Offering", {
        role1: { player: "Student", name: "enrolls in" },
        role2: { player: "Offering", name: "enrolls" },
        uniqueness: "role2",
      })
      .build();
  }

  it("matches an alias whose only difference is a space", () => {
    // Before this, three checks on university-enrollment failed for a
    // spelling difference and cost roughly 0.12 of the suite mean.
    const report = evaluateCandidate(
      spacedAlias(),
      exercise([{ kind: "requires_element", element: { entity: "CourseOffering" } }]),
    );
    expect(report.passed).toBe(true);
  });

  it("matches factTypeBetween endpoints across the same difference", () => {
    const report = evaluateCandidate(
      spacedAlias(),
      exercise([{
        kind: "requires_element",
        element: { factTypeBetween: ["Student", "CourseOffering"] },
      }]),
    );
    expect(report.passed).toBe(true);
  });

  it("ignores case, hyphens, and underscores too", () => {
    const model = new ModelBuilder("spelling")
      .withEntityType("PurchaseOrder", { aliases: ["purchase-order"] })
      .build();
    for (const term of ["purchase order", "Purchase_Order", "PURCHASEORDER"]) {
      const report = evaluateCandidate(
        model,
        exercise([{ kind: "requires_element", element: { entity: term } }]),
      );
      expect(report.passed, term).toBe(true);
    }
  });

  it("does not match terms that differ by more than separators", () => {
    // Normalization rescues spelling, not meaning: only separators and
    // case are removed, so distinct words stay distinct.
    const model = new ModelBuilder("distinct").withEntityType("Order").build();
    for (const term of ["Orders", "OrderLine", "Ord"]) {
      const report = evaluateCandidate(
        model,
        exercise([{ kind: "requires_element", element: { entity: term } }]),
      );
      expect(report.passed, term).toBe(false);
    }
  });

  it("prefers an exact match over a normalized one", () => {
    // Two types that normalize alike: the exact name must win, so
    // resolution stays predictable rather than order-dependent.
    const model = new ModelBuilder("precedence")
      .withEntityType("Course Offering")
      .withEntityType("CourseOffering")
      .build();
    expect(getObjectTypeByNameOrAlias(model, "CourseOffering")?.name)
      .toBe("CourseOffering");
    expect(getObjectTypeByNameOrAlias(model, "Course Offering")?.name)
      .toBe("Course Offering");
  });
});
