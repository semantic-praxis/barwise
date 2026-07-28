/**
 * Unit tests for the constraint routing module (sql-dialect-capability
 * spec, WS2): spill classification, ConstraintSpec pseudocode for every
 * constraint type, and CHECK predicate rendering. All pure -- no python,
 * no filesystem.
 */
import type { Constraint, OrmModel } from "@barwise/core";
import { RelationalMapper } from "@barwise/core/mapping";
import { describe, expect, it } from "vitest";
import { routeConstraints } from "../src/ddl/constraintRouting.js";
import { resolveDialectProfile } from "../src/ddl/dialectCapabilities.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const postgres = resolveDialectProfile("postgres");

/** Person manages Person plus a Person has Score value fact type. */
function baseModel(): OrmModel {
  return new ModelBuilder("Test")
    .withEntityType("Person", { referenceMode: "person_id" })
    .withEntityType("Project", { referenceMode: "project_id" })
    .withValueType("Score", { dataType: { name: "integer" } })
    .withBinaryFactType("Person manages Person", {
      role1: { player: "Person", name: "manages" },
      role2: { player: "Person", name: "is managed by" },
      uniqueness: "role2",
    })
    .withBinaryFactType("Person has Score", {
      role1: { player: "Person", name: "has" },
      role2: { player: "Score", name: "is of" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Person leads Project", {
      role1: { player: "Person", name: "leads" },
      role2: { player: "Project", name: "is led by" },
      uniqueness: "role2",
    })
    .build();
}

function routeWith(model: OrmModel, factName: string, constraint: Constraint) {
  model.getFactTypeByName(factName)!.addConstraint(constraint);
  const schema = new RelationalMapper().map(model);
  return routeConstraints(model, schema, postgres, "postgres");
}

function spilledPseudocode(model: OrmModel, factName: string, constraint: Constraint): string {
  const routing = routeWith(model, factName, constraint);
  expect(routing.spilled.length).toBeGreaterThan(0);
  return routing.spilled[0]!.spec.pseudocode;
}

const manages = "Person manages Person";
const mRole1 = `${manages}::role1`;
const mRole2 = `${manages}::role2`;

describe("constraint pseudocode generation", () => {
  it.each(
    [
      ["irreflexive", `not ${manages}(x, x)`],
      ["asymmetric", "implies not"],
      ["antisymmetric", "x != y"],
      ["intransitive", "implies not"],
      ["acyclic", "no cycle"],
      ["symmetric", `implies ${manages}(y, x)`],
      ["transitive", `implies ${manages}(x, z)`],
      ["purely_reflexive", "implies x = y"],
    ] as const,
  )("renders %s ring constraints", (ringType, expected) => {
    const pseudocode = spilledPseudocode(baseModel(), manages, {
      type: "ring",
      roleId1: mRole1,
      roleId2: mRole2,
      ringType,
    });
    expect(pseudocode).toContain(expected);
  });

  it("renders frequency constraints with bounded and unbounded maxima", () => {
    expect(spilledPseudocode(baseModel(), manages, {
      type: "frequency",
      roleIds: [mRole1],
      min: 2,
      max: 5,
    })).toContain("between 2 and 5");

    expect(spilledPseudocode(baseModel(), manages, {
      type: "frequency",
      roleIds: [mRole1],
      min: 1,
      max: "unbounded",
    })).toContain("between 1 and unbounded");
  });

  it("renders cardinality constraints", () => {
    const pseudocode = spilledPseudocode(baseModel(), manages, {
      type: "cardinality",
      roleId: mRole1,
      min: 0,
      max: 10,
    });
    expect(pseudocode).toContain("between 0 and 10");
    expect(pseudocode).toContain("Person.manages");
  });

  it("renders exclusion, exclusive-or, and disjunctive-mandatory role lists", () => {
    const model = baseModel();
    const leads1 = "Person leads Project::role1";

    expect(spilledPseudocode(model, manages, {
      type: "exclusion",
      roleIds: [mRole1, leads1],
    })).toContain("no instance plays more than one of");

    expect(spilledPseudocode(baseModel(), manages, {
      type: "exclusive_or",
      roleIds: [mRole1, leads1],
    })).toContain("exactly one of");

    expect(spilledPseudocode(baseModel(), manages, {
      type: "disjunctive_mandatory",
      roleIds: [mRole1, leads1],
    })).toContain("at least one of");
  });

  it("renders subset and equality population comparisons", () => {
    const leads1 = "Person leads Project::role1";

    expect(spilledPseudocode(baseModel(), manages, {
      type: "subset",
      subsetRoleIds: [mRole1],
      supersetRoleIds: [leads1],
    })).toContain("is a subset of");

    expect(spilledPseudocode(baseModel(), manages, {
      type: "equality",
      roleIds1: [mRole1],
      roleIds2: [leads1],
    })).toContain("equals");
  });

  it("renders join-path constraints", () => {
    const operand = { path: { root: "x", steps: [] }, projection: [0] };

    expect(spilledPseudocode(baseModel(), manages, {
      type: "join_subset",
      subset: operand,
      superset: operand,
    })).toContain("contained in the superset");

    expect(spilledPseudocode(baseModel(), manages, {
      type: "join_equality",
      operands: [operand, operand],
    })).toContain("identical");

    expect(spilledPseudocode(baseModel(), manages, {
      type: "join_exclusion",
      operands: [operand, operand],
    })).toContain("more than one join-path operand");
  });

  it("labels unknown roles by id instead of throwing", () => {
    const pseudocode = spilledPseudocode(baseModel(), manages, {
      type: "exclusion",
      roleIds: ["missing-role-id", mRole1],
    });
    expect(pseudocode).toContain("missing-role-id");
  });
});

describe("spill classification", () => {
  it("spills a value comparison whose roles map to different tables", () => {
    const model = baseModel();
    const routing = routeWith(model, "Person leads Project", {
      type: "value_comparison",
      roleId1: "Person leads Project::role1",
      roleId2: "Person leads Project::role2",
      operator: "<",
    });

    expect(routing.spilled).toHaveLength(1);
    expect(routing.spilled[0]!.reason).toContain("different tables");
    expect(routing.spilled[0]!.spec.pseudocode).toContain("<");
  });

  it("routes a value comparison within one table as a CHECK clause", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Period", { referenceMode: "period_id" })
      .withValueType("StartDay", { dataType: { name: "integer" } })
      .withValueType("EndDay", { dataType: { name: "integer" } })
      .withBinaryFactType("Period has StartDay", {
        role1: { player: "Period", name: "starts" },
        role2: { player: "StartDay", name: "is start of" },
        uniqueness: "role1",
      })
      .withBinaryFactType("Period has EndDay", {
        role1: { player: "Period", name: "ends" },
        role2: { player: "EndDay", name: "is end of" },
        uniqueness: "role1",
      })
      .build();

    const routing = routeWith(model, "Period has StartDay", {
      type: "value_comparison",
      roleId1: "Period has StartDay::role2",
      roleId2: "Period has EndDay::role2",
      operator: "<=",
    });

    expect(routing.spilled).toHaveLength(0);
    const check = routing.clauses.find((c) => c.sql.includes("<="));
    expect(check).toBeDefined();
    expect(check!.sql).toBe("CHECK (start_day <= end_day)");
  });

  it("spills an external uniqueness whose roles span tables", () => {
    const model = baseModel();
    const routing = routeWith(model, "Person has Score", {
      type: "external_uniqueness",
      roleIds: ["Person has Score::role1", "Person leads Project::role2"],
    });

    expect(routing.spilled).toHaveLength(1);
    expect(routing.spilled[0]!.reason).toContain("more than one table");
    expect(routing.spilled[0]!.spec.pseudocode).toContain("unique across the population");
  });

  it("spills a value constraint whose role maps to no column", () => {
    // A value constraint on a role of an entity-entity fact type has no
    // value column to attach a CHECK to.
    const model = baseModel();
    const routing = routeWith(model, "Person leads Project", {
      type: "value_constraint",
      roleId: "Person leads Project::role1",
      values: ["x"],
    });

    expect(routing.spilled).toHaveLength(1);
    expect(routing.spilled[0]!.reason).toContain("no single column");
  });

  it("provides a counterexample-backed example where one exists", () => {
    const model = baseModel();
    const routing = routeWith(model, manages, {
      type: "ring",
      roleId1: mRole1,
      roleId2: mRole2,
      ringType: "irreflexive",
    });

    expect(routing.spilled[0]!.spec.example).toContain("Forbidden:");
  });
});

describe("CHECK predicate rendering", () => {
  function checkFor(valueConstraint: { values: string[]; ranges?: object[]; }): string {
    const model = new ModelBuilder("Test")
      .withEntityType("Thing", { referenceMode: "thing_id" })
      .withValueType("Amount", {
        dataType: { name: "integer" },
        valueConstraint: valueConstraint as never,
      })
      .withBinaryFactType("Thing has Amount", {
        role1: { player: "Thing", name: "has" },
        role2: { player: "Amount", name: "is of" },
        uniqueness: "role1",
      })
      .build();
    const schema = new RelationalMapper().map(model);
    const routing = routeConstraints(model, schema, postgres, "postgres");
    expect(routing.clauses).toHaveLength(1);
    return routing.clauses[0]!.sql;
  }

  it("renders exclusive bounds", () => {
    expect(checkFor({ values: [], ranges: [{ min: "0", minInclusive: false }] }))
      .toBe("CHECK (amount > 0)");
  });

  it("renders open-below ranges", () => {
    expect(checkFor({ values: [], ranges: [{ max: "100", maxInclusive: false }] }))
      .toBe("CHECK (amount < 100)");
  });

  it("combines values and ranges as alternatives", () => {
    expect(checkFor({ values: ["-1"], ranges: [{ min: "0", max: "9" }] }))
      .toBe("CHECK (amount IN (-1) OR (amount >= 0 AND amount <= 9))");
  });

  it("escapes embedded quotes in string literals", () => {
    expect(checkFor({ values: ["it's"] })).toBe("CHECK (amount IN ('it''s'))");
  });
});
