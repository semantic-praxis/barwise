import type { OrmModel } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import { describe, expect, it } from "vitest";
import { mustValidate } from "../src/evaluate/checks/mustValidate.js";
import { evaluateCandidate } from "../src/evaluate/evaluateCandidate.js";
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
