/**
 * Tests for completeness warning rules.
 *
 * Completeness warnings are non-blocking hints that help modelers
 * identify areas needing attention. They flag:
 *   - Object types with no natural-language definition (info)
 *   - Fact types with no constraints at all (warning -- likely
 *     indicates the modeler forgot to specify cardinality)
 *   - Object types that do not participate in any fact type (info --
 *     "orphan" types that serve no purpose in the model)
 *   - Value types without a declared data type (info)
 *   - Entity types with zero or multiple preferred identifiers (info/warning)
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { completenessWarnings } from "../../src/validation/rules/completenessWarnings.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("completenessWarnings", () => {
  it("produces no diagnostics for a well-defined model", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "A person who buys things.",
      })
      .withValueType("CustomerId", {
        definition: "Unique customer identifier.",
        dataType: { name: "integer" },
      })
      .withEntityType("Order", {
        referenceMode: "order_number",
        definition: "A confirmed purchase.",
      })
      .withValueType("OrderNumber", {
        definition: "Unique order number.",
        dataType: { name: "text", length: 20 },
      })
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "is of" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Order has OrderNumber", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderNumber", name: "is of" },
        uniqueness: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .build();

    const diagnostics = completenessWarnings(model);
    expect(diagnostics).toHaveLength(0);
  });

  it("produces no diagnostics for an empty model", () => {
    const model = new OrmModel({ name: "Empty" });
    const diagnostics = completenessWarnings(model);
    expect(diagnostics).toHaveLength(0);
  });

  describe("missing object type definitions", () => {
    it("reports object types without definitions", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", {
          referenceMode: "order_number",
          definition: "A confirmed purchase.",
        })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-object-type-definition",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("info");
      expect(missing[0]!.message).toContain("Customer");
    });

    it("reports all object types missing definitions", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("A", { referenceMode: "a_id" })
        .withEntityType("B", { referenceMode: "b_id" })
        .withBinaryFactType("A relates B", {
          role1: { player: "A", name: "relates" },
          role2: { player: "B", name: "is related" },
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-object-type-definition",
      );
      expect(missing).toHaveLength(2);
    });
  });

  describe("fact types without constraints", () => {
    it("warns when a fact type has no constraints", () => {
      const model = new OrmModel({ name: "Test" });
      const ot = model.addObjectType({
        name: "Thing",
        kind: "entity",
        referenceMode: "thing_id",
        definition: "A thing.",
      });
      model.addFactType({
        name: "Thing exists",
        roles: [{ name: "exists", playerId: ot.id }],
        readings: ["{0} exists"],
        // no constraints
      });

      const diagnostics = completenessWarnings(model);
      const noConstraints = diagnostics.filter(
        (d) => d.ruleId === "completeness/fact-type-without-constraints",
      );
      expect(noConstraints).toHaveLength(1);
      expect(noConstraints[0]!.severity).toBe("warning");
      expect(noConstraints[0]!.message).toContain("Thing exists");
    });

    it("does not warn when fact type has constraints", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("X", {
          referenceMode: "x_id",
          definition: "An X.",
        })
        .withEntityType("Y", {
          referenceMode: "y_id",
          definition: "A Y.",
        })
        .withBinaryFactType("X has Y", {
          role1: { player: "X", name: "has" },
          role2: { player: "Y", name: "of" },
          uniqueness: "role2",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const noConstraints = diagnostics.filter(
        (d) => d.ruleId === "completeness/fact-type-without-constraints",
      );
      expect(noConstraints).toHaveLength(0);
    });
  });

  describe("isolated object types", () => {
    it("reports object types not participating in any fact type", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Orphan",
        kind: "entity",
        referenceMode: "orphan_id",
        definition: "An isolated type.",
      });

      const diagnostics = completenessWarnings(model);
      const isolated = diagnostics.filter(
        (d) => d.ruleId === "completeness/isolated-object-type",
      );
      expect(isolated).toHaveLength(1);
      expect(isolated[0]!.severity).toBe("info");
      expect(isolated[0]!.message).toContain("Orphan");
    });

    it("does not report an independent object type that is standalone", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Color",
        kind: "value",
        independent: true,
      });

      const isolated = completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/isolated-object-type",
      );
      expect(isolated).toHaveLength(0);
    });

    it("does not report object types that participate in fact types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("A", {
          referenceMode: "a_id",
          definition: "An A.",
        })
        .withEntityType("B", {
          referenceMode: "b_id",
          definition: "A B.",
        })
        .withBinaryFactType("A has B", {
          role1: { player: "A", name: "has" },
          role2: { player: "B", name: "of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const isolated = diagnostics.filter(
        (d) => d.ruleId === "completeness/isolated-object-type",
      );
      expect(isolated).toHaveLength(0);
    });
  });

  describe("missing value type data type", () => {
    it("reports value types without a data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", { definition: "A name." })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-value-type-data-type",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("info");
      expect(missing[0]!.message).toContain("Name");
      expect(missing[0]!.message).toContain("TEXT");
    });

    it("does not report value types that have a data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", {
          definition: "A name.",
          dataType: { name: "text", length: 100 },
        })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-value-type-data-type",
      );
      expect(missing).toHaveLength(0);
    });

    it("does not flag entity types without data type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withEntityType("Order", {
          referenceMode: "order_number",
          definition: "An order.",
        })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-value-type-data-type",
      );
      expect(missing).toHaveLength(0);
    });
  });

  describe("fact types without uniqueness", () => {
    it("warns when a fact type has constraints but no internal uniqueness", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Finding", {
          referenceMode: "finding_id",
          definition: "A finding.",
        })
        .withValueType("EndPosition", {
          definition: "An offset.",
          dataType: { name: "integer" },
        })
        .withBinaryFactType("Finding has EndPosition", {
          role1: { player: "Finding", name: "has" },
          role2: { player: "EndPosition", name: "is of" },
          mandatory: "role1",
        })
        .build();

      const flagged = completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/fact-type-without-uniqueness",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0]!.severity).toBe("warning");
      expect(flagged[0]!.message).toContain("Finding has EndPosition");
    });

    it("does not warn when an internal uniqueness constraint is present", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Finding", {
          referenceMode: "finding_id",
          definition: "A finding.",
        })
        .withValueType("EndPosition", {
          definition: "An offset.",
          dataType: { name: "integer" },
        })
        .withBinaryFactType("Finding has EndPosition", {
          role1: { player: "Finding", name: "has" },
          role2: { player: "EndPosition", name: "is of" },
          uniqueness: "role1",
          mandatory: "role1",
        })
        .build();

      const flagged = completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/fact-type-without-uniqueness",
      );
      expect(flagged).toHaveLength(0);
    });

    it("leaves constraint-free fact types to fact-type-without-constraints", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Finding", {
          referenceMode: "finding_id",
          definition: "A finding.",
        })
        .withValueType("EndPosition", {
          definition: "An offset.",
          dataType: { name: "integer" },
        })
        .withBinaryFactType("Finding has EndPosition", {
          role1: { player: "Finding", name: "has" },
          role2: { player: "EndPosition", name: "is of" },
        })
        .build();

      const diagnostics = completenessWarnings(model);
      expect(
        diagnostics.filter(
          (d) => d.ruleId === "completeness/fact-type-without-uniqueness",
        ),
      ).toHaveLength(0);
      expect(
        diagnostics.filter(
          (d) => d.ruleId === "completeness/fact-type-without-constraints",
        ),
      ).toHaveLength(1);
    });
  });

  describe("preferred identifiers", () => {
    it("reports entity types with no explicit preferred identifier", () => {
      // Every entity carries a reference_mode (the metamodel requires
      // it); the info nudges toward an explicit preferred uniqueness
      // constraint so the mapper does not fall back to a heuristic.
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", {
          definition: "A name.",
          dataType: { name: "text" },
        })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("info");
      expect(missing[0]!.message).toContain("Customer");
      expect(missing[0]!.message).toContain("heuristic");
    });

    it("accepts identification inherited through a provides_identification subtype chain", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
        definition: "A person.",
      });
      const personId = model.addObjectType({
        name: "PersonId",
        kind: "value",
        definition: "A person identifier.",
        dataType: { name: "integer" },
      });
      model.addFactType({
        name: "Person has PersonId",
        roles: [
          { name: "has", playerId: person.id, id: "p1" },
          { name: "identifies", playerId: personId.id, id: "p2" },
        ],
        readings: ["{0} has {1}", "{1} identifies {0}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["p1"], isPreferred: true },
        ] as never,
      });
      const employee = model.addObjectType({
        name: "Employee",
        kind: "entity",
        referenceMode: "person_id",
        definition: "An employed person.",
      });
      const manager = model.addObjectType({
        name: "Manager",
        kind: "entity",
        referenceMode: "person_id",
        definition: "A managing employee.",
      });
      model.addSubtypeFact({
        subtypeId: employee.id,
        supertypeId: person.id,
        providesIdentification: true,
      });
      model.addSubtypeFact({
        subtypeId: manager.id,
        supertypeId: employee.id,
        providesIdentification: true,
      });

      const missing = completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(missing).toHaveLength(0);
    });

    it("still reports a subtype whose chain does not provide identification", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
        definition: "A person.",
      });
      const contractor = model.addObjectType({
        name: "Contractor",
        kind: "entity",
        referenceMode: "contractor_id",
        definition: "An independently identified person.",
      });
      model.addSubtypeFact({
        subtypeId: contractor.id,
        supertypeId: person.id,
        providesIdentification: false,
      });

      // Person (no explicit preferred identifier of its own) is flagged
      // too; the point here is that the non-identifying chain does not
      // silence Contractor.
      const missing = completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(
        missing.some((d) => d.message.includes("Contractor")),
      ).toBe(true);
    });

    it("does not report entity types with a preferred identifier", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("CustomerId", {
          definition: "Customer identifier.",
          dataType: { name: "integer" },
        })
        .withBinaryFactType("Customer has CustomerId", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerId", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(missing).toHaveLength(0);
    });

    it("warns when entity type has multiple preferred identifiers", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("CustomerId", {
          definition: "Internal identifier.",
          dataType: { name: "integer" },
        })
        .withValueType("ExternalCode", {
          definition: "External code.",
          dataType: { name: "text", length: 10 },
        })
        .withBinaryFactType("Customer has CustomerId", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "CustomerId", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .withBinaryFactType("Customer has ExternalCode", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "ExternalCode", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const multiple = diagnostics.filter(
        (d) => d.ruleId === "completeness/multiple-preferred-identifiers",
      );
      expect(multiple).toHaveLength(1);
      expect(multiple[0]!.severity).toBe("warning");
      expect(multiple[0]!.message).toContain("Customer");
      expect(multiple[0]!.message).toContain("2");
    });

    it("does not check value types for preferred identifiers", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A customer.",
        })
        .withValueType("Name", { definition: "A name." })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      // Value type "Name" should not be checked for preferred identifiers --
      // only entity types are checked.
      const valuePrefWarning = diagnostics.filter(
        (d) =>
          d.ruleId === "completeness/missing-preferred-identifier"
          && d.message.includes("Name"),
      );
      expect(valuePrefWarning).toHaveLength(0);
    });
  });

  describe("an identity declared more than one way", () => {
    /**
     * `multiple-preferred-identifiers` covers more than one source of
     * ONE kind; this covers a type that INHERITS its identity through an
     * identifying subtype fact and also declares one. It is not an
     * identification cycle, so the structural rule does not fire either.
     * Zero object types in the repository carry the shape, so every
     * fixture here is hand-built.
     *
     * The preferred-plus-objectification pair is the case that is NOT a
     * conflict, and it has its own test below: ORM lets an objectified
     * fact type carry its own reference scheme, and 13 of the 115
     * recorded eval payloads do exactly that.
     */
    function conflicting(
      kind: "objectification+subtype" | "preferred+objectification" | "preferred+subtype",
    ) {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const org = model.addObjectType({
        name: "Organization",
        kind: "entity",
        referenceMode: "org_id",
      });
      const employee = model.addObjectType({
        name: "Employee",
        kind: "entity",
        referenceMode: "employee_id",
      });
      const badge = model.addObjectType({
        name: "BadgeNumber",
        kind: "value",
        dataType: { name: "text" },
      });

      const employment = model.addFactType({
        name: "Person works for Organization",
        roles: [
          { id: "e1", name: "works for", playerId: person.id },
          { id: "e2", name: "employs", playerId: org.id },
        ],
        readings: ["{0} works for {1}", "{1} employs {0}"],
        constraints: [],
      });

      if (kind !== "preferred+subtype") {
        model.addObjectifiedFactType({ factTypeId: employment.id, objectTypeId: employee.id });
      }
      if (kind !== "preferred+objectification") {
        model.addSubtypeFact({
          subtypeId: employee.id,
          supertypeId: person.id,
          providesIdentification: true,
        });
      }
      if (kind !== "objectification+subtype") {
        model.addFactType({
          name: "Employee has BadgeNumber",
          roles: [
            { id: "b1", name: "has", playerId: employee.id },
            { id: "b2", name: "is of", playerId: badge.id },
          ],
          readings: ["{0} has {1}", "{1} is of {0}"],
          constraints: [{ type: "internal_uniqueness", roleIds: ["b1"], isPreferred: true }],
        });
      }
      return model;
    }

    const conflicts = (model: OrmModel) =>
      completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/conflicting-identification",
      );

    it("reports an objectification and an identifying subtype fact on one type", () => {
      // barwise-965's actual cause: the only way the subtype arm's key
      // could be composite by the time it ran.
      const found = conflicts(conflicting("objectification+subtype"));
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("Employee");
      expect(found[0]!.message).toContain("inherits its identity from a supertype");
      expect(found[0]!.message).toContain("an objectification");
    });

    it("says nothing about an objectified type with its own reference scheme", () => {
      // Ordinary ORM, not a contradiction: an objectified fact type may
      // carry a simple reference scheme -- "Review has ReviewId" on a
      // Review that objectifies "Reviewer reviews Paper". A first draft
      // of this rule charged for it, and 13 of the 115 recorded eval
      // payloads across four model arms have the shape, so it would have
      // moved six of eight arms' scores for good modelling.
      expect(conflicts(conflicting("preferred+objectification"))).toHaveLength(0);
    });

    it("reports a preferred uniqueness constraint against an identifying subtype fact", () => {
      // `providesIdentification` says the subtype is identified by its
      // supertype's identifier; its own preferred identifier says
      // otherwise.
      const found = conflicts(conflicting("preferred+subtype"));
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("Employee");
      expect(found[0]!.message).toContain("a preferred uniqueness constraint");
    });

    it("says nothing about a type identified exactly one way", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const name = model.addObjectType({ name: "Name", kind: "value", dataType: { name: "text" } });
      model.addFactType({
        name: "Person has Name",
        roles: [
          { id: "r1", name: "has", playerId: person.id },
          { id: "r2", name: "is of", playerId: name.id },
        ],
        readings: ["{0} has {1}", "{1} is of {0}"],
        constraints: [{ type: "internal_uniqueness", roleIds: ["r1"], isPreferred: true }],
      });

      expect(conflicts(model)).toHaveLength(0);
    });

    it("leaves two preferred uniqueness constraints to the rule that owns them", () => {
      // One kind, twice: `multiple-preferred-identifiers` reports it and
      // this rule must not, or a reader sees one problem described twice.
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const name = model.addObjectType({ name: "Name", kind: "value", dataType: { name: "text" } });
      const ssn = model.addObjectType({ name: "Ssn", kind: "value", dataType: { name: "text" } });
      for (const [i, value] of [name, ssn].entries()) {
        model.addFactType({
          name: `Person has ${value.name}`,
          roles: [
            { id: `p${i}`, name: "has", playerId: person.id },
            { id: `v${i}`, name: "is of", playerId: value.id },
          ],
          readings: ["{0} has {1}", "{1} is of {0}"],
          constraints: [{ type: "internal_uniqueness", roleIds: [`p${i}`], isPreferred: true }],
        });
      }

      const diagnostics = completenessWarnings(model);
      expect(conflicts(model)).toHaveLength(0);
      expect(
        diagnostics.filter((d) => d.ruleId === "completeness/multiple-preferred-identifiers"),
      ).toHaveLength(1);
    });
  });
});

/**
 * An entity type that objectifies a fact type is identified BY that fact
 * type -- that is what objectification means.
 *
 * `checkPreferredIdentifiers` used to enumerate identification itself
 * and knew only about a preferred uniqueness constraint and an
 * identifying subtype fact, so it told 25 objectified types across this
 * repository that the relational mapper must guess their key, while
 * `settleObjectifiedKey` was building that key from the absorbed columns
 * and `identificationGraph` was treating the objectification as an
 * identifying edge (barwise-972). It reads `identificationSources` now,
 * which is the same owner `checkConflictingIdentification` was already
 * using twenty lines further down the same file.
 */
describe("identification through objectification", () => {
  /** Enrollment objectifies "Student enrolls in Course". */
  function objectifiedModel(): OrmModel {
    const model = new ModelBuilder("Objectified")
      .withEntityType("Student")
      .withEntityType("Course")
      .withEntityType("Enrollment")
      .withBinaryFactType("Student enrolls in Course", {
        role1: { player: "Student", name: "enrolls in" },
        role2: { player: "Course", name: "has enrolled" },
        uniqueness: "spanning",
        isPreferred: true,
      })
      .withObjectifiedFactType("Student enrolls in Course", "Enrollment")
      .build();
    return model;
  }

  const missingFor = (model: OrmModel, name: string) =>
    completenessWarnings(model).filter(
      (d) =>
        d.ruleId === "completeness/missing-preferred-identifier"
        && d.elementId === model.getObjectTypeByName(name)!.id,
    );

  it("does not report an objectified entity as missing a preferred identifier", () => {
    expect(missingFor(objectifiedModel(), "Enrollment")).toHaveLength(0);
  });

  it("still reports an entity that objectifies nothing and has no identifier", () => {
    // The escape must be objectification, not "any entity in a model
    // that happens to contain one".
    const model = objectifiedModel();
    model.addObjectType({ name: "Building", kind: "entity", referenceMode: "building_id" });
    expect(missingFor(model, "Building")).toHaveLength(1);
  });

  it("does not treat objectification as a second preferred identifier", () => {
    // An objectified type carrying its own reference scheme is ordinary
    // ORM. Counting the objectification alongside the constraint would
    // make that a conflict.
    const model = objectifiedModel();
    const enrollment = model.getObjectTypeByName("Enrollment")!;
    model.addFactType({
      name: "Enrollment has EnrollmentId",
      roles: [
        { name: "has", playerId: enrollment.id },
        {
          name: "identifies",
          playerId: model.addObjectType({
            name: "EnrollmentId",
            kind: "value",
          }).id,
        },
      ],
      readings: ["{0} has {1}", "{1} identifies {0}"],
      constraints: [{ type: "internal_uniqueness", roleIds: [], isPreferred: true }],
    });

    expect(
      completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/multiple-preferred-identifiers",
      ),
    ).toHaveLength(0);
  });

  it("does not let an identifying subtype of an unidentified parent count", () => {
    // `identificationSources` reports the subtype fact without asking
    // whether the supertype is identified, so the rule's recursion is
    // load-bearing rather than decorative.
    const model = new ModelBuilder("Chain")
      .withEntityType("Vehicle")
      .withEntityType("Car")
      .build();
    const vehicle = model.getObjectTypeByName("Vehicle")!;
    const car = model.getObjectTypeByName("Car")!;
    model.addSubtypeFact({
      subtypeId: car.id,
      supertypeId: vehicle.id,
      providesIdentification: true,
    });

    expect(missingFor(model, "Car")).toHaveLength(1);
  });

  it("terminates on a subtype cycle rather than recursing forever", () => {
    // The recursion above follows `providesIdentification` edges, and
    // `structural/identification-cycle` reports a cycle among them but
    // does not prevent one reaching this rule -- a completeness warning
    // is computed over whatever model it is handed. Without the `seen`
    // guard this is a stack overflow, and with the guard inverted the
    // cycle would identify both types out of nothing, so the assertion
    // is both that it returns and what it returns.
    const model = new ModelBuilder("Cycle")
      .withEntityType("Alpha")
      .withEntityType("Beta")
      .build();
    const alpha = model.getObjectTypeByName("Alpha")!;
    const beta = model.getObjectTypeByName("Beta")!;
    model.addSubtypeFact({
      subtypeId: alpha.id,
      supertypeId: beta.id,
      providesIdentification: true,
    });
    model.addSubtypeFact({
      subtypeId: beta.id,
      supertypeId: alpha.id,
      providesIdentification: true,
    });

    expect(missingFor(model, "Alpha")).toHaveLength(1);
    expect(missingFor(model, "Beta")).toHaveLength(1);
  });
});
