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
import { placeFlags } from "../helpers/placeFlags.js";

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
        uniqueness: "both",
        mandatory: "role1",
        isPreferred: true,
      })
      .withBinaryFactType("Order has OrderNumber", {
        role1: { player: "Order", name: "has" },
        role2: { player: "OrderNumber", name: "is of" },
        uniqueness: "both",
        mandatory: "role1",
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
          { type: "internal_uniqueness", roleIds: ["p2"] },
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

      const missing = completenessWarnings(placeFlags(model)).filter(
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

    it("reports an entity whose only flag identifies nothing, as every other reader does", () => {
      // order-management's Customer: the flag is on Customer's role and no
      // uniqueness covers Name's, so a Name could belong to two customers
      // and identify neither (preferredIdentifiers, orm-format-3 WS4a).
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withValueType("Name", { dataType: { name: "text" } })
        .withBinaryFactType("Customer has Name", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "Name", name: "is of" },
          uniqueness: "role1",
          isPreferred: true,
        })
        .build();
      const missing = completenessWarnings(model)
        .filter((d) => d.ruleId === "completeness/missing-preferred-identifier");
      expect(missing.map((d) => d.message)).toEqual([
        expect.stringContaining('"Customer"'),
      ]);
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
          uniqueness: "both",
          isPreferred: true,
        })
        .build();

      const diagnostics = completenessWarnings(model);
      const missing = diagnostics.filter(
        (d) => d.ruleId === "completeness/missing-preferred-identifier",
      );
      expect(missing).toHaveLength(0);
    });

    it("stores one identifier when two flags name one entity, and reports neither", () => {
      // A stored reference names one constraint, so two identifiers for one
      // entity cannot be stated (orm-format-3 WS4b); the 2.0 reader keeps
      // the first, as Open decision 8 says.
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
          uniqueness: "both",
          isPreferred: true,
        })
        .withBinaryFactType("Customer has ExternalCode", {
          role1: { player: "Customer", name: "has" },
          role2: { player: "ExternalCode", name: "is of" },
          uniqueness: "both",
          isPreferred: true,
        })
        .build();

      const customer = model.getObjectTypeByName("Customer")!;
      expect(model.preferredIdentifierOf(customer.id)).toBeDefined();
      const identifier = completenessWarnings(model).filter((d) =>
        d.ruleId === "completeness/missing-preferred-identifier"
        || d.ruleId === "completeness/preferred-identifier-invalid"
      );
      expect(identifier).toEqual([]);
    });

    describe("a stored reference that identifies nothing", () => {
      /** Customer has CustomerId, both roles unique, and a reference to `ref`. */
      function referencing(ref: string) {
        const model = new OrmModel({ name: "Test" });
        model.addObjectType({ id: "c", name: "Customer", kind: "entity", referenceMode: "id" });
        model.addObjectType({ id: "v", name: "CustomerId", kind: "value" });
        model.addFactType({
          id: "ft",
          name: "Customer has CustomerId",
          roles: [{ id: "rc", name: "has", playerId: "c" }, {
            id: "rv",
            name: "is of",
            playerId: "v",
          }],
          readings: ["{0} has {1}"],
          constraints: [
            { id: "u-c", type: "internal_uniqueness", roleIds: ["rc"] },
            { id: "u-v", type: "internal_uniqueness", roleIds: ["rv"] },
            { id: "m-c", type: "mandatory", roleId: "rc" },
          ],
        });
        model.setPreferredIdentifier("c", ref);
        return completenessWarnings(model).filter((d) =>
          d.ruleId === "completeness/preferred-identifier-invalid"
          || d.ruleId === "completeness/missing-preferred-identifier"
        );
      }

      it("accepts the value role's uniqueness", () => {
        expect(referencing("u-v")).toEqual([]);
      });

      it("reports a constraint the model lacks", () => {
        const found = referencing("gone");
        expect(found.map((d) => [d.ruleId, d.severity])).toEqual([
          ["completeness/preferred-identifier-invalid", "error"],
        ]);
        expect(found[0]!.message).toContain("no constraint with that id");
      });

      it("reports a constraint that is not a uniqueness, naming its kind", () => {
        expect(referencing("m-c")[0]!.message).toBe(
          'Entity type "Customer" names constraint "m-c" as its preferred identifier, but its kind is '
            + "mandatory; a preferred identifier is a uniqueness constraint, internal or external.",
        );
      });

      it("reports a uniqueness that identifies something else", () => {
        // The entity's own role: a CustomerId could belong to two customers.
        expect(referencing("u-c")[0]!.message).toContain("does not identify");
      });
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
          uniqueness: "both",
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
          constraints: [
            { type: "internal_uniqueness", roleIds: ["b1"], isPreferred: true },
            { type: "internal_uniqueness", roleIds: ["b2"] },
          ],
        });
      }
      return placeFlags(model);
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
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"], isPreferred: true },
          { type: "internal_uniqueness", roleIds: ["r2"] },
        ],
      });

      expect(conflicts(model)).toHaveLength(0);
    });

    it("reports no conflict for two flags of one kind", () => {
      // Two flags place one stored identifier (orm-format-3 WS4b): one kind,
      // once, which is no conflict.
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
          constraints: [
            { type: "internal_uniqueness", roleIds: [`p${i}`], isPreferred: true },
            { type: "internal_uniqueness", roleIds: [`v${i}`] },
          ],
        });
      }

      placeFlags(model);
      expect(conflicts(model)).toHaveLength(0);
      expect(model.preferredIdentifierOf(person.id)).toBeDefined();
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

/**
 * barwise-943: a frequency of "at least 1, at most unbounded" excludes
 * nothing, and nothing said so. The min-0 spelling of the same emptiness
 * is a hard error; this one was indistinguishable from a real
 * constraint.
 */
describe("a frequency constraint that excludes nothing", () => {
  function withFrequency(min: number, max: number | "unbounded"): OrmModel {
    const model = new ModelBuilder("Freq")
      .withEntityType("Order")
      .withEntityType("Product")
      .withBinaryFactType("Order includes Product", {
        role1: { player: "Order", name: "includes" },
        role2: { player: "Product", name: "is included in" },
      })
      .build();
    const ft = model.getFactTypeByName("Order includes Product")!;
    ft.addConstraint({ type: "frequency", roleIds: [ft.roles[0]!.id], min, max });
    return model;
  }

  const warnsFor = (min: number, max: number | "unbounded") =>
    completenessWarnings(withFrequency(min, max))
      .filter((d) => d.ruleId === "completeness/frequency-without-effect");

  it("warns on 1..unbounded, naming the fact type", () => {
    const [warning, ...rest] = warnsFor(1, "unbounded");
    expect(warning).toBeDefined();
    expect(rest).toHaveLength(0);
    expect(warning!.severity).toBe("warning");
    expect(warning!.message).toContain("Order includes Product");
    expect(warning!.message).toContain("excludes nothing");
  });

  it("stays silent on 1..5, which is how every shipped frequency is written", () => {
    // The boundary is the whole rule. All six frequency constraints in
    // this repository are min 1 with a finite max, so a rule that
    // flagged them would be wrong six times over on its first run.
    expect(warnsFor(1, 5)).toHaveLength(0);
  });

  it("stays silent on 2..unbounded, which genuinely excludes the singletons", () => {
    expect(warnsFor(2, "unbounded")).toHaveLength(0);
  });

  it("warns on 0..unbounded too, without displacing the min-0 error", () => {
    // A min of 0 is separately an error (constraint/frequency-invalid-min,
    // barwise-830). This rule is about emptiness, not legality, so it
    // reports the emptiness as well and neither rule swallows the other.
    expect(warnsFor(0, "unbounded")).toHaveLength(1);
  });

  it("does not mistake a cardinality constraint for a vacuous frequency", () => {
    // `CardinalityConstraint extends CardinalityRange`, so it carries the
    // same `min` and `max: number | "unbounded"` shape this rule reads.
    // Drop the `type !== "frequency"` gate and a perfectly ordinary
    // unary-role cardinality of "at least 1, no maximum" is reported as
    // a frequency constraint that says nothing. Found by mutation: no
    // other test in this file distinguishes the gate.
    // ModelBuilder has no unary helper, so the fact type is built
    // directly rather than bending the builder for one case.
    const model = new ModelBuilder("Card").withEntityType("Order").build();
    const order = model.getObjectTypeByName("Order")!;
    const ft = model.addFactType({
      name: "Order is urgent",
      roles: [{ name: "is urgent", playerId: order.id }],
      readings: ["{0} is urgent"],
    });
    ft.addConstraint({
      type: "cardinality",
      roleId: ft.roles[0]!.id,
      min: 1,
      max: "unbounded",
    });

    expect(
      completenessWarnings(model).filter(
        (d) => d.ruleId === "completeness/frequency-without-effect",
      ),
    ).toHaveLength(0);
  });

  it("leaves a fact type with no frequency constraint alone", () => {
    expect(
      completenessWarnings(
        new ModelBuilder("None")
          .withEntityType("Order")
          .withEntityType("Product")
          .withBinaryFactType("Order includes Product", {
            role1: { player: "Order", name: "includes" },
            role2: { player: "Product", name: "is included in" },
          })
          .build(),
      ).filter((d) => d.ruleId === "completeness/frequency-without-effect"),
    ).toHaveLength(0);
  });
});

describe("an identifier resting on an optional role (identifier-roles-mandatory.spec.md)", () => {
  const RULE = "completeness/preferred-identifier-optional";
  const optionalWarnings = (model: OrmModel) =>
    completenessWarnings(model).filter((d) => d.ruleId === RULE);

  /** Person has PersonNr, both roles unique, Person identified by it. */
  function personNr(mandatory?: "alethic" | "deontic") {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "nr" });
    model.addObjectType({ id: "n", name: "PersonNr", kind: "value" });
    model.addFactType({
      id: "ft",
      name: "Person has PersonNr",
      roles: [{ id: "rp", name: "has", playerId: "p" }, { id: "rn", name: "is of", playerId: "n" }],
      readings: ["{0} has {1}"],
      constraints: [
        { id: "u-p", type: "internal_uniqueness", roleIds: ["rp"] },
        { id: "u-n", type: "internal_uniqueness", roleIds: ["rn"] },
        ...(mandatory
          ? [{ id: "m-p", type: "mandatory" as const, roleId: "rp", modality: mandatory }]
          : []),
      ],
    });
    model.setPreferredIdentifier("p", "u-n");
    return model;
  }

  it("warns when the entity's role in its entity-value binary is optional", () => {
    const [warning, ...rest] = optionalWarnings(personNr());
    expect(rest).toEqual([]);
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toBe(
      'Entity type "Person" is identified through "Person has PersonNr", but its role in "Person has PersonNr" is not declared mandatory, so nothing says every "Person" has its identifier. A reference scheme\'s roles are mandatory; add the mandatory constraint, or identify "Person" another way.',
    );
  });

  it("is satisfied by an alethic mandatory", () => {
    expect(optionalWarnings(personNr("alethic"))).toEqual([]);
  });

  it("is not satisfied by a deontic mandatory", () => {
    const warnings = optionalWarnings(personNr("deontic"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('Entity type "Person" is identified through');
  });

  /**
   * Room identified by the Building it is in and its RoomNr, each near role
   * mandatory when `mandatoryIn` names its fact type.
   */
  function room(mandatoryIn: readonly ("in" | "nr")[]) {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "r", name: "Room", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "b", name: "Building", kind: "entity", referenceMode: "nr" });
    model.addObjectType({ id: "n", name: "RoomNr", kind: "value" });
    const component = (
      key: "in" | "nr",
      name: string,
      near: string,
      far: string,
      farPlayer: string,
    ) =>
      model.addFactType({
        id: `ft-${key}`,
        name,
        roles: [{ id: near, name: "near", playerId: "r" }, {
          id: far,
          name: "far",
          playerId: farPlayer,
        }],
        readings: ["{0} near {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: [near] },
          ...(mandatoryIn.includes(key) ? [{ type: "mandatory" as const, roleId: near }] : []),
        ],
      });
    component("in", "Room is in Building", "rib-room", "rib-b", "b");
    component("nr", "Room has RoomNr", "rhn-room", "rhn-nr", "n");
    model.addConstraint({ id: "x", type: "external_uniqueness", roleIds: ["rib-b", "rhn-nr"] });
    model.setPreferredIdentifier("r", "x");
    return model;
  }

  it("names only the optional components of an external scheme", () => {
    const warnings = optionalWarnings(room(["in"]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain(
      'identified through "Room is in Building" and "Room has RoomNr", but its role in "Room has RoomNr" is not declared',
    );
  });

  it("names every optional component once, in the plural", () => {
    const warnings = optionalWarnings(room([]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain(
      'its roles in "Room is in Building" and "Room has RoomNr" are not declared mandatory',
    );
  });

  it("checks the uncovered role of an entity-entity binary", () => {
    // A Badge is identified by the Person it belongs to: the uniqueness is
    // on Person's role, so Badge plays the uncovered one.
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "bd", name: "Badge", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "nr" });
    model.addFactType({
      id: "ft",
      name: "Badge belongs to Person",
      roles: [{ id: "rb", name: "belongs to", playerId: "bd" }, {
        id: "rp",
        name: "holds",
        playerId: "p",
      }],
      readings: ["{0} belongs to {1}"],
      constraints: [{ id: "u-p", type: "internal_uniqueness", roleIds: ["rp"] }],
    });
    model.setPreferredIdentifier("bd", "u-p");

    const warnings = optionalWarnings(model);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('Entity type "Badge"');
  });

  it("does not check an entity identified by the fact type it objectifies", () => {
    // Enrollment objectifies "Student takes Course" and is identified by
    // its spanning uniqueness; Enrollment plays no role in that fact type.
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "s", name: "Student", kind: "entity", referenceMode: "nr" });
    model.addObjectType({ id: "c", name: "Course", kind: "entity", referenceMode: "code" });
    model.addObjectType({ id: "e", name: "Enrollment", kind: "entity", referenceMode: "id" });
    model.addFactType({
      id: "ft",
      name: "Student takes Course",
      roles: [{ id: "rs", name: "takes", playerId: "s" }, {
        id: "rc",
        name: "is taken by",
        playerId: "c",
      }],
      readings: ["{0} takes {1}"],
      constraints: [{ id: "u-sc", type: "internal_uniqueness", roleIds: ["rs", "rc"] }],
    });
    model.addObjectifiedFactType({ factTypeId: "ft", objectTypeId: "e" });
    model.setPreferredIdentifier("e", "u-sc");

    expect(optionalWarnings(model)).toEqual([]);
  });

  it("leaves an unresolved reference to preferred-identifier-invalid", () => {
    const model = personNr();
    model.setPreferredIdentifier("p", "no-such-constraint");
    const ruleIds = completenessWarnings(model).map((d) => d.ruleId);
    expect(ruleIds).toContain("completeness/preferred-identifier-invalid");
    expect(ruleIds).not.toContain(RULE);
  });
});
