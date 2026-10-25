/**
 * Unit tests for the constraint routing module (sql-dialect-capability
 * spec, WS2): spill classification, ConstraintSpec pseudocode for every
 * constraint type, and CHECK predicate rendering. All pure -- no python,
 * no filesystem.
 */
import { describe, expect, it } from "vitest";
import {
  routeConstraints,
  unreportedConstraintSpecs,
} from "../../src/mapping/constraintRouting.js";
import { DIALECT_PROFILES, resolveDialectProfile } from "../../src/mapping/dialectCapabilities.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { type Constraint, isInternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const postgres = resolveDialectProfile("postgres");

describe("dialect capability profiles", () => {
  it("covers every dialect the SQL cascade knows", () => {
    expect(Object.keys(DIALECT_PROFILES).sort()).toEqual([
      "ansi",
      "bigquery",
      "databricks",
      "mysql",
      "postgres",
      "redshift",
      "snowflake",
    ]);
  });
});

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

/** Add `constraint` to `factName`, or to the model when it spans fact types. */
function routeWith(model: OrmModel, factName: string, constraint: Constraint) {
  if (isInternalConstraint(constraint)) {
    model.getFactTypeByName(factName)!.addConstraint(constraint);
  } else model.addConstraint(constraint);
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

  it("does not route a uniqueness the primary key already realizes", () => {
    // Since barwise-967 the preferred identifying binary IS the entity's
    // primary key, so routing its value-side uniqueness would emit
    // `UNIQUE (badge_number)` beside `PRIMARY KEY (badge_number)` -- a
    // clause the key already enforces. The doc on
    // valueColumnForUniqueness always claimed the mapping realizes
    // everything else; this is the case that made the claim false.
    //
    // The value-side constraint is added by hand and named as Guard's
    // preferred identifier: with no stored reference the model has no
    // preferred identifier, nothing is skipped, and this test passes with
    // the guard removed. Found by watching the mutation NOT fail.
    const model = new ModelBuilder("Test")
      .withEntityType("Guard", { referenceMode: "badge_number" })
      .withValueType("BadgeNumber", { dataType: { name: "text", length: 10 } })
      .withBinaryFactType("Guard has BadgeNumber", {
        role1: { player: "Guard", name: "has" },
        role2: { player: "BadgeNumber", name: "is of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .build();

    const factType = model.getFactTypeByName("Guard has BadgeNumber")!;
    factType.addConstraint({
      id: "c-badge",
      type: "internal_uniqueness",
      roleIds: [factType.roles[1]!.id],
    });
    model.setPreferredIdentifier(model.getObjectTypeByName("Guard")!.id, "c-badge");

    const schema = new RelationalMapper().map(model);
    const guard = schema.tables.find((t) => t.name === "guard")!;
    expect(guard.primaryKey.columnNames).toEqual(["badge_number"]);
    expect(guard.columns.map((c) => c.name)).toEqual(["badge_number"]);

    const routing = routeConstraints(model, schema, postgres, "postgres");
    expect(routing.clauses.filter((c) => c.tableName === "guard")).toEqual([]);
    expect(routing.spilled.filter((sp) => sp.tableName === "guard")).toEqual([]);
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

/**
 * A single-role uniqueness on a binary between two entities
 * (one-to-one-entity-uniqueness.spec.md, barwise-hjy): realized only where
 * the role's own column sits in its own player's table.
 */
describe("uniqueness on a binary between two entities", () => {
  function places(
    uniqueness: "role1" | "role2" | "both",
    mandatory?: "role1" | "role2" | "both",
  ) {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_nr" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness,
        ...(mandatory ? { mandatory } : {}),
      })
      .build();
    const schema = new RelationalMapper().map(model);
    return routeConstraints(model, schema, postgres, "postgres").clauses.map((
      c,
    ) => [c.tableName, c.sql]);
  }

  it.each(
    [
      ["no mandatory", undefined, 2],
      ["both mandatory", "both", 2],
    ] as const,
  )("routes both in an associative table (%s)", (_, mandatory, expected) => {
    const clauses = places("both", mandatory);
    expect(clauses).toHaveLength(expected);
    expect(clauses.map(([, sql]) => sql).sort()).toEqual([
      "UNIQUE (customer_id)",
      "UNIQUE (order_nr)",
    ]);
  });

  it("routes the partner's uniqueness on the column absorbed on the other side", () => {
    // Order's role mandatory: the fact is order.customer_id, single-valued
    // (each Order is placed by at most one Customer); each Customer places
    // at most one Order needs UNIQUE on it.
    expect(places("both", "role2")).toEqual([["order", "UNIQUE (customer_id)"]]);
    expect(places("both", "role1")).toEqual([["customer", "UNIQUE (order_nr)"]]);
  });

  it("routes nothing for a one-to-many, which the foreign key realizes", () => {
    expect(places("role2")).toEqual([]);
    expect(places("role2", "role2")).toEqual([]);
  });

  it("routes the partner's uniqueness on a ring absorbed into its one table", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Employee", { referenceMode: "emp_nr" })
      .withBinaryFactType("Employee succeeds Employee", {
        role1: { player: "Employee", name: "succeeds" },
        role2: { player: "Employee", name: "is succeeded by" },
        uniqueness: "both",
        mandatory: "role1",
      })
      .build();
    const schema = new RelationalMapper().map(model);
    const clauses = routeConstraints(model, schema, postgres, "postgres").clauses;
    // employee.fk_emp_nr is the successor; each one succeeds at most once.
    expect(clauses.map((c) => [c.tableName, c.sql])).toEqual([["employee", "UNIQUE (fk_emp_nr)"]]);
  });

  it("routes UNIQUE on the role an objectifying entity is not keyed on", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Passport", { referenceMode: "passport_nr" })
      .withEntityType("Issue", { referenceMode: "issue_id" })
      .withBinaryFactType("Person holds Passport", {
        role1: { player: "Person", name: "holds" },
        role2: { player: "Passport", name: "is held by" },
        uniqueness: "both",
      })
      .withObjectifiedFactType("Person holds Passport", "Issue")
      .build();
    const schema = new RelationalMapper().map(model);
    const table = schema.tables.find((t) => t.name === "issue")!;
    const clauses = routeConstraints(model, schema, postgres, "postgres").clauses;
    // Keyed on the person; the passport is UNIQUE beside it.
    expect(table.primaryKey.columnNames).toEqual(["person_id"]);
    expect(clauses.map((c) => [c.tableName, c.sql])).toEqual([["issue", "UNIQUE (passport_nr)"]]);
  });

  it("routes one UNIQUE over every column of a composite foreign key", () => {
    const model = new OrmModel({ name: "Test" });
    const seat = model.addObjectType({ name: "Seat", kind: "entity", referenceMode: "seat_id" });
    const flight = model.addObjectType({
      name: "Flight",
      kind: "entity",
      referenceMode: "flight_id",
    });
    const assignment = model.addObjectType({
      name: "Assignment",
      kind: "entity",
      referenceMode: "assignment_id",
    });
    const ticket = model.addObjectType({
      name: "Ticket",
      kind: "entity",
      referenceMode: "ticket_nr",
    });
    const onFlight = model.addFactType({
      name: "Seat on Flight",
      roles: [{ id: "s", name: "is on", playerId: seat.id }, {
        id: "f",
        name: "carries",
        playerId: flight.id,
      }],
      readings: ["{0} is on {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["s", "f"] }],
    });
    model.addObjectifiedFactType({ factTypeId: onFlight.id, objectTypeId: assignment.id });
    model.addFactType({
      name: "Ticket covers Assignment",
      roles: [{ id: "t", name: "covers", playerId: ticket.id }, {
        id: "a",
        name: "is covered by",
        playerId: assignment.id,
      }],
      readings: ["{0} covers {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["t"] },
        { type: "internal_uniqueness", roleIds: ["a"] },
        { type: "mandatory", roleId: "t" },
      ],
    });
    const schema = new RelationalMapper().map(model);
    const clauses = routeConstraints(model, schema, postgres, "postgres").clauses;
    expect(clauses.map((c) => [c.tableName, c.sql])).toEqual([[
      "ticket",
      "UNIQUE (seat_id, flight_id)",
    ]]);
  });

  it("spills each one where the dialect has no UNIQUE, so the schema exports report it", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_nr" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "both",
        mandatory: "role2",
      })
      .build();
    const schema = new RelationalMapper().map(model);
    const noUnique = { ...postgres, unique: "absent" as const };
    const routing = routeConstraints(model, schema, noUnique, "nounique");
    expect(routing.clauses).toEqual([]);
    expect(routing.spilled.map((s) => s.reason)).toEqual(["UNIQUE is not supported by nounique"]);
    expect(unreportedConstraintSpecs(model, schema)).toHaveLength(1);
  });

  it("treats a one-to-one ring as the two-entity case", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Bid", { referenceMode: "bid_id" })
      .withBinaryFactType("Bid responds to Bid", {
        role1: { player: "Bid", name: "responds to" },
        role2: { player: "Bid", name: "is responded to by" },
        uniqueness: "both",
      })
      .build();
    const schema = new RelationalMapper().map(model);
    const table = schema.tables.find((t) => t.sourceElementId === model.factTypes[0]!.id)!;
    // Keyed on both columns, each UNIQUE by itself.
    expect(
      routeConstraints(model, schema, postgres, "postgres").clauses.map((
        c,
      ) => [c.tableName, c.sql]),
    )
      .toEqual(table.primaryKey.columnNames.map((c) => [table.name, `UNIQUE (${c})`]));
    expect(table.primaryKey.columnNames).toHaveLength(2);
  });
});
