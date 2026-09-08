/**
 * Tests for the DraftModelParser, which converts raw LLM extraction
 * output into a validated OrmModel with provenance metadata.
 *
 * The parser resolves LLM-generated role names to actual role IDs,
 * applies constraints with confidence tracking, and records skip reasons
 * when constraints cannot be applied. These tests verify:
 *   - Object type and fact type creation from extraction responses
 *   - Constraint resolution (by name match and positional fallback)
 *   - Provenance recording for every element
 *   - Edge cases: empty names, duplicate names, unresolvable roles
 *   - Skip-reason tracking for constraints that cannot be applied
 */
import { OrmYamlSerializer } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseDraftModel } from "../src/DraftModelParser.js";
import type { ExtractionResponse } from "../src/ExtractionTypes.js";

/** Builds a minimal ExtractionResponse with defaults for omitted fields. */
function makeResponse(
  overrides: Partial<ExtractionResponse> = {},
): ExtractionResponse {
  return {
    object_types: overrides.object_types ?? [],
    fact_types: overrides.fact_types ?? [],
    subtypes: overrides.subtypes ?? [],
    inferred_constraints: overrides.inferred_constraints ?? [],
    populations: overrides.populations,
    ambiguities: overrides.ambiguities ?? [],
  };
}

describe("DraftModelParser", () => {
  describe("object type creation", () => {
    it("creates entity types with reference mode", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              reference_mode: "customer_id",
              definition: "A buyer",
              source_references: [{ lines: [1, 2], excerpt: "customer" }],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.objectTypes).toHaveLength(1);
      const ot = result.model.getObjectTypeByName("Customer");
      expect(ot).toBeDefined();
      expect(ot?.kind).toBe("entity");
      expect(ot?.referenceMode).toBe("customer_id");
      expect(ot?.definition).toBe("A buyer");
    });

    it("creates value types without reference mode", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Rating",
              kind: "value",
              value_constraint: { values: ["A", "B", "C"] },
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Rating");
      expect(ot).toBeDefined();
      expect(ot?.kind).toBe("value");
      expect(ot?.valueConstraint?.values).toEqual(["A", "B", "C"]);
    });

    it("auto-generates reference mode for entity types without one", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Order",
              kind: "entity",
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Order");
      expect(ot?.referenceMode).toBe("order_id");
    });

    it("skips object types with empty names", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "", kind: "entity", source_references: [] },
          ],
        }),
        "Test",
      );

      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("creates value types with data_type", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Amount",
              kind: "value",
              data_type: { name: "decimal", length: 10, scale: 2 },
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Amount");
      expect(ot).toBeDefined();
      expect(ot?.dataType).toEqual({ name: "decimal", length: 10, scale: 2 });
    });

    it("creates value types with simple data_type (no length/scale)", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "BirthDate",
              kind: "value",
              data_type: { name: "date" },
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("BirthDate");
      expect(ot?.dataType).toEqual({ name: "date" });
    });

    it("ignores unrecognized data_type names with a warning", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Foo",
              kind: "value",
              data_type: { name: "varchar" } as never,
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Foo");
      expect(ot?.dataType).toBeUndefined();
      expect(result.warnings.some((w) => w.includes("unrecognized data type"))).toBe(true);
    });

    it("handles missing data_type gracefully", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Name",
              kind: "value",
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Name");
      expect(ot?.dataType).toBeUndefined();
      expect(result.warnings).toHaveLength(0);
    });

    it("records provenance for each object type", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              reference_mode: "cid",
              source_references: [
                { lines: [5, 7], excerpt: "each customer has a unique ID" },
              ],
            },
          ],
        }),
        "Test",
      );

      expect(result.objectTypeProvenance).toHaveLength(1);
      expect(result.objectTypeProvenance[0]?.elementName).toBe("Customer");
      expect(result.objectTypeProvenance[0]?.sourceReferences).toHaveLength(1);
    });

    it("passes aliases through to the model", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              aliases: ["Client", "Buyer"],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Customer")!;
      expect(ot.aliases).toEqual(["Client", "Buyer"]);
    });

    it("omits aliases when not provided", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Customer")!;
      expect(ot.aliases).toEqual([]);
      expect(new OrmYamlSerializer().serialize(result.model)).not.toContain("aliases");
    });

    it("omits aliases when empty array", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              aliases: [],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      const ot = result.model.getObjectTypeByName("Customer")!;
      expect(ot.aliases).toEqual([]);
      expect(new OrmYamlSerializer().serialize(result.model)).not.toContain("aliases");
    });
  });

  describe("fact type creation", () => {
    it("creates binary fact types with resolved role players", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "Customer", kind: "entity", reference_mode: "cid", source_references: [] },
            { name: "Order", kind: "entity", reference_mode: "oid", source_references: [] },
          ],
          fact_types: [
            {
              name: "Customer places Order",
              roles: [
                { player: "Customer", role_name: "places" },
                { player: "Order", role_name: "is placed by" },
              ],
              readings: ["{0} places {1}", "{1} is placed by {0}"],
              source_references: [{ lines: [3, 3], excerpt: "places" }],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.factTypes).toHaveLength(1);
      const ft = result.model.getFactTypeByName("Customer places Order");
      expect(ft).toBeDefined();
      expect(ft?.roles).toHaveLength(2);
      expect(ft?.readings).toHaveLength(2);
    });

    it("warns and skips fact types with unresolved players", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "Customer", kind: "entity", reference_mode: "cid", source_references: [] },
          ],
          fact_types: [
            {
              name: "Customer places Order",
              roles: [
                { player: "Customer", role_name: "places" },
                { player: "Order", role_name: "is placed by" },
              ],
              readings: ["{0} places {1}"],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.factTypes).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("Order"))).toBe(true);
    });

    it("generates default reading when none provided", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "Customer", kind: "entity", reference_mode: "cid", source_references: [] },
            { name: "Order", kind: "entity", reference_mode: "oid", source_references: [] },
          ],
          fact_types: [
            {
              name: "Customer places Order",
              roles: [
                { player: "Customer", role_name: "places" },
                { player: "Order", role_name: "is placed by" },
              ],
              readings: [],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.factTypes).toHaveLength(1);
      const ft = result.model.getFactTypeByName("Customer places Order");
      expect(ft?.readings).toHaveLength(1);
    });

    it("discards readings with missing placeholders", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "A", kind: "entity", reference_mode: "aid", source_references: [] },
            { name: "B", kind: "entity", reference_mode: "bid", source_references: [] },
          ],
          fact_types: [
            {
              name: "A relates B",
              roles: [
                { player: "A", role_name: "relates" },
                { player: "B", role_name: "is related to" },
              ],
              readings: ["A relates to B"], // Missing {0}, {1}
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      // Invalid reading discarded, default generated.
      expect(result.model.factTypes).toHaveLength(1);
      expect(result.warnings.some((w) => w.includes("placeholder"))).toBe(true);
    });

    it("skips fact types with no roles", () => {
      const result = parseDraftModel(
        makeResponse({
          fact_types: [
            {
              name: "Empty",
              roles: [],
              readings: [],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.factTypes).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("no roles"))).toBe(true);
    });
  });

  describe("constraint application", () => {
    function makeModelWithFactType() {
      return makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", reference_mode: "cid", source_references: [] },
          { name: "Order", kind: "entity", reference_mode: "oid", source_references: [] },
        ],
        fact_types: [
          {
            name: "Customer places Order",
            roles: [
              { player: "Customer", role_name: "places" },
              { player: "Order", role_name: "is placed by" },
            ],
            readings: ["{0} places {1}"],
            source_references: [],
          },
        ],
      });
    }

    it("applies internal uniqueness constraints", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "internal_uniqueness",
              fact_type: "Customer places Order",
              roles: ["is placed by"],
              description: "Each Order is placed by at most one Customer.",
              confidence: "high",
              source_references: [{ lines: [3, 3], excerpt: "exactly one" }],
            },
          ],
        },
        "Test",
      );

      const ft = result.model.getFactTypeByName("Customer places Order");
      const uc = ft?.constraints.find((c) => c.type === "internal_uniqueness");
      expect(uc).toBeDefined();

      expect(result.constraintProvenance[0]?.applied).toBe(true);
      expect(result.constraintProvenance[0]?.confidence).toBe("high");
    });

    it("applies mandatory constraints", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "mandatory",
              fact_type: "Customer places Order",
              roles: ["is placed by"],
              description: "Every Order is placed by some Customer.",
              confidence: "high",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      const ft = result.model.getFactTypeByName("Customer places Order");
      const mc = ft?.constraints.find((c) => c.type === "mandatory");
      expect(mc).toBeDefined();

      expect(result.constraintProvenance[0]?.applied).toBe(true);
    });

    it("applies internal uniqueness with is_preferred", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "internal_uniqueness",
              fact_type: "Customer places Order",
              roles: ["is placed by"],
              description: "Each Order is placed by at most one Customer.",
              confidence: "high",
              is_preferred: true,
              source_references: [],
            },
          ],
        },
        "Test",
      );

      const ft = result.model.getFactTypeByName("Customer places Order");
      const uc = ft?.constraints.find((c) => c.type === "internal_uniqueness");
      expect(uc).toBeDefined();
      expect(uc?.type === "internal_uniqueness" && uc.isPreferred).toBe(true);
      expect(result.constraintProvenance[0]?.applied).toBe(true);
    });

    it("omits isPreferred when is_preferred is not set", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "internal_uniqueness",
              fact_type: "Customer places Order",
              roles: ["is placed by"],
              description: "Each Order is placed by at most one Customer.",
              confidence: "high",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      const ft = result.model.getFactTypeByName("Customer places Order");
      const uc = ft?.constraints.find((c) => c.type === "internal_uniqueness");
      expect(uc).toBeDefined();
      expect(uc?.type === "internal_uniqueness" && uc.isPreferred).toBeFalsy();
    });

    it("records skip reason for constraints on missing fact types", () => {
      const result = parseDraftModel(
        makeResponse({
          inferred_constraints: [
            {
              type: "mandatory",
              fact_type: "NonExistent FT",
              roles: ["role1"],
              description: "Some constraint",
              confidence: "low",
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain(
        "not found",
      );
    });
  });

  describe("ambiguities", () => {
    it("passes through ambiguities from the extraction", () => {
      const result = parseDraftModel(
        makeResponse({
          ambiguities: [
            {
              description: "Customer vs Client terminology",
              source_references: [
                { lines: [17, 19], excerpt: "client or customer" },
              ],
            },
          ],
        }),
        "Test",
      );

      expect(result.ambiguities).toHaveLength(1);
      expect(result.ambiguities[0]?.description).toContain("Customer");
    });
  });

  describe("constraint resolution edge cases", () => {
    function makeModelWithFactType() {
      return makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", reference_mode: "cid", source_references: [] },
          { name: "Order", kind: "entity", reference_mode: "oid", source_references: [] },
        ],
        fact_types: [
          {
            name: "Customer places Order",
            roles: [
              { player: "Customer", role_name: "places" },
              { player: "Order", role_name: "is placed by" },
            ],
            readings: ["{0} places {1}"],
            source_references: [],
          },
        ],
      });
    }

    it("skips constraint when role hint matches neither role name nor player name", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "internal_uniqueness",
              fact_type: "Customer places Order",
              // Use a name that won't match any role name or player name.
              roles: ["SomeUnknownRole"],
              description: "Uniqueness with unresolvable role name",
              confidence: "medium",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      // Should NOT apply -- no blind fallback.
      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.warnings.some((w) => w.includes("could not resolve"))).toBe(true);
    });

    it("resolves constraint role by player object type name", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "internal_uniqueness",
              fact_type: "Customer places Order",
              // Use the player name (object type name), not the role name.
              roles: ["Order"],
              description: "Each Order is placed by at most one Customer.",
              confidence: "high",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      // Should resolve via player name lookup.
      expect(result.constraintProvenance[0]?.applied).toBe(true);
      const ft = result.model.getFactTypeByName("Customer places Order")!;
      const uc = ft.constraints.find((c) => c.type === "internal_uniqueness");
      expect(uc).toBeDefined();
      // The constraint should be on the Order role (role index 1).
      const orderRole = ft.roles.find((r) => r.name === "is placed by")!;
      if (uc?.type === "internal_uniqueness") {
        expect(uc.roleIds).toContain(orderRole.id);
      }
    });

    it("records skip reason when mandatory has too many roles", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "mandatory",
              fact_type: "Customer places Order",
              roles: ["places", "is placed by"],
              description: "Mandatory with two roles (invalid)",
              confidence: "high",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("exactly one role");
    });

    it("records skip reason when mandatory role cannot be resolved", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "mandatory",
              fact_type: "Customer places Order",
              // Use a name that won't match any role name or player name.
              roles: ["CompletelyFake"],
              description: "Mandatory with unresolvable role",
              confidence: "low",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      // No blind fallback -- should not apply.
      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
    });

    it("records skip reason for internal_uniqueness with no resolvable roles", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "internal_uniqueness",
              fact_type: "Customer places Order",
              // Empty roles array means nothing to resolve.
              roles: [],
              description: "Uniqueness with empty roles",
              confidence: "low",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
    });

    it("applies value_constraint on a fact type role", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["Order"],
              description: "Order status must be one of: pending, shipped, delivered",
              confidence: "high",
              values: ["pending", "shipped", "delivered"],
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(true);

      const ft = result.model.getFactTypeByName("Customer places Order");
      expect(ft).toBeDefined();
      const vcs = ft!.constraints.filter((c) => c.type === "value_constraint");
      expect(vcs).toHaveLength(1);
      const vc = vcs[0]!;
      expect(vc.type).toBe("value_constraint");
      if (vc.type === "value_constraint") {
        expect(vc.values).toEqual(["pending", "shipped", "delivered"]);
        // roleId should match the Order role
        const orderRole = ft!.roles.find((r) => {
          const ot = result.model.objectTypes.find((o) => o.id === r.playerId);
          return ot?.name === "Order";
        });
        expect(vc.roleId).toBe(orderRole!.id);
      }
    });

    it("skips value_constraint with no values", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["Order"],
              description: "VC with no values",
              confidence: "medium",
              values: [],
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("no values");
    });

    it("skips value_constraint with missing values field", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["Order"],
              description: "VC with missing values",
              confidence: "medium",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("no values");
    });

    it("skips value_constraint with unresolvable role", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["NonexistentType"],
              description: "VC on unknown role",
              confidence: "medium",
              values: ["a", "b"],
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
    });

    it("skips value_constraint with multiple roles", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["Customer", "Order"],
              description: "VC on two roles",
              confidence: "medium",
              values: ["a", "b"],
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(false);
      expect(result.constraintProvenance[0]?.skipReason).toContain("exactly one role");
    });

    it("detects duplicate value_constraint on same role", () => {
      const resp = makeModelWithFactType();
      const result = parseDraftModel(
        {
          ...resp,
          inferred_constraints: [
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["Order"],
              description: "First VC",
              confidence: "high",
              values: ["pending", "shipped"],
              source_references: [],
            },
            {
              type: "value_constraint",
              fact_type: "Customer places Order",
              roles: ["Order"],
              description: "Duplicate VC",
              confidence: "medium",
              values: ["pending", "shipped", "delivered"],
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.constraintProvenance[0]?.applied).toBe(true);
      expect(result.constraintProvenance[1]?.applied).toBe(false);
      expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
    });

    it("skips fact type with empty name", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "A", kind: "entity", reference_mode: "aid", source_references: [] },
          ],
          fact_types: [
            {
              name: "",
              roles: [{ player: "A", role_name: "does" }],
              readings: ["{0} does"],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.factTypes).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("empty name"))).toBe(true);
    });
  });

  describe("subtype extraction", () => {
    function makeModelWithEntities() {
      return makeResponse({
        object_types: [
          { name: "Person", kind: "entity", reference_mode: "person_id", source_references: [] },
          {
            name: "Employee",
            kind: "entity",
            reference_mode: "employee_id",
            source_references: [],
          },
          { name: "Manager", kind: "entity", reference_mode: "manager_id", source_references: [] },
          { name: "Rating", kind: "value", source_references: [] },
        ],
      });
    }

    it("creates subtype facts from extracted subtypes", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Employee",
              supertype: "Person",
              description: "Employee is a Person",
              source_references: [{ lines: [5, 5], excerpt: "employee is a person" }],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(1);
      const sf = result.model.subtypeFacts[0]!;
      expect(sf.providesIdentification).toBe(true);

      const subtypeOt = result.model.getObjectTypeByName("Employee");
      const supertypeOt = result.model.getObjectTypeByName("Person");
      expect(sf.subtypeId).toBe(subtypeOt!.id);
      expect(sf.supertypeId).toBe(supertypeOt!.id);
    });

    it("respects provides_identification = false", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Employee",
              supertype: "Person",
              provides_identification: false,
              description: "Employee is a Person with separate ID",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(1);
      expect(result.model.subtypeFacts[0]!.providesIdentification).toBe(false);
    });

    it("creates multi-level subtype hierarchy", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Employee",
              supertype: "Person",
              description: "Employee is a Person",
              source_references: [],
            },
            {
              subtype: "Manager",
              supertype: "Employee",
              description: "Manager is an Employee",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(2);
      expect(result.subtypeProvenance).toHaveLength(2);
      expect(result.subtypeProvenance.every((sp) => sp.applied)).toBe(true);
    });

    it("records provenance for applied subtypes", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Employee",
              supertype: "Person",
              description: "Employee is a Person",
              source_references: [{ lines: [5, 6], excerpt: "employee is a person" }],
            },
          ],
        },
        "Test",
      );

      expect(result.subtypeProvenance).toHaveLength(1);
      expect(result.subtypeProvenance[0]!.applied).toBe(true);
      expect(result.subtypeProvenance[0]!.subtype).toBe("Employee");
      expect(result.subtypeProvenance[0]!.supertype).toBe("Person");
      expect(result.subtypeProvenance[0]!.sourceReferences).toHaveLength(1);
    });

    it("skips subtype when subtype entity is not found", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "NonExistent",
              supertype: "Person",
              description: "Missing subtype",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(0);
      expect(result.subtypeProvenance[0]!.applied).toBe(false);
      expect(result.subtypeProvenance[0]!.skipReason).toContain("NonExistent");
      expect(result.subtypeProvenance[0]!.skipReason).toContain("not found");
    });

    it("skips subtype when supertype entity is not found", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Employee",
              supertype: "NonExistent",
              description: "Missing supertype",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(0);
      expect(result.subtypeProvenance[0]!.applied).toBe(false);
      expect(result.subtypeProvenance[0]!.skipReason).toContain("NonExistent");
    });

    it("skips subtype when subtype is a value type", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Rating",
              supertype: "Person",
              description: "Value type as subtype",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(0);
      expect(result.subtypeProvenance[0]!.applied).toBe(false);
      expect(result.subtypeProvenance[0]!.skipReason).toContain("value type");
    });

    it("skips subtype when supertype is a value type", () => {
      const resp = makeModelWithEntities();
      const result = parseDraftModel(
        {
          ...resp,
          subtypes: [
            {
              subtype: "Employee",
              supertype: "Rating",
              description: "Value type as supertype",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(0);
      expect(result.subtypeProvenance[0]!.applied).toBe(false);
      expect(result.subtypeProvenance[0]!.skipReason).toContain("value type");
    });

    it("handles missing subtypes array gracefully", () => {
      const result = parseDraftModel(
        {
          object_types: [],
          fact_types: [],
          subtypes: [],
          inferred_constraints: [],
          ambiguities: [],
        },
        "Test",
      );

      expect(result.model.subtypeFacts).toHaveLength(0);
      expect(result.subtypeProvenance).toHaveLength(0);
    });
  });

  describe("Phase 2 constraint extraction", () => {
    // Shared fixture: two fact types with a common object type (Person).
    // "Person drives Car" and "Person rides Bus" -- enables cross-role constraints.
    // Also includes a self-referencing "Person manages Person" for ring constraints.
    function makeTwoFactTypeModel() {
      return makeResponse({
        object_types: [
          { name: "Person", kind: "entity", reference_mode: "person_id", source_references: [] },
          { name: "Car", kind: "entity", reference_mode: "car_id", source_references: [] },
          { name: "Bus", kind: "entity", reference_mode: "bus_id", source_references: [] },
        ],
        fact_types: [
          {
            name: "Person drives Car",
            roles: [
              { player: "Person", role_name: "drives" },
              { player: "Car", role_name: "is driven by" },
            ],
            readings: ["{0} drives {1}"],
            source_references: [],
          },
          {
            name: "Person rides Bus",
            roles: [
              { player: "Person", role_name: "rides" },
              { player: "Bus", role_name: "is ridden by" },
            ],
            readings: ["{0} rides {1}"],
            source_references: [],
          },
        ],
      });
    }

    function makeRingFactTypeModel() {
      return makeResponse({
        object_types: [
          { name: "Person", kind: "entity", reference_mode: "person_id", source_references: [] },
        ],
        fact_types: [
          {
            name: "Person manages Person",
            roles: [
              { player: "Person", role_name: "manages" },
              { player: "Person", role_name: "is managed by" },
            ],
            readings: ["{0} manages {1}"],
            source_references: [],
          },
        ],
      });
    }

    // --- external_uniqueness ---

    describe("external_uniqueness", () => {
      it("applies external uniqueness constraint", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "external_uniqueness",
                fact_type: "Person drives Car",
                roles: ["Car"],
                description: "Each Car is driven by a unique set of attributes.",
                confidence: "high",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const eu = ft.constraints.find((c) => c.type === "external_uniqueness");
        expect(eu).toBeDefined();
        if (eu?.type === "external_uniqueness") {
          expect(eu.roleIds).toHaveLength(1);
        }
      });

      it("skips external uniqueness with unresolvable roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "external_uniqueness",
                fact_type: "Person drives Car",
                roles: ["NonExistent"],
                description: "Bad role",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
      });

      it("detects duplicate external uniqueness", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "external_uniqueness",
                fact_type: "Person drives Car",
                roles: ["Car"],
                description: "First EU",
                confidence: "high",
                source_references: [],
              },
              {
                type: "external_uniqueness",
                fact_type: "Person drives Car",
                roles: ["Car"],
                description: "Duplicate EU",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- disjunctive_mandatory ---

    describe("disjunctive_mandatory", () => {
      it("applies disjunctive mandatory constraint", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "disjunctive_mandatory",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "Each Person drives a Car or the Car is driven by a Person.",
                confidence: "high",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const dm = ft.constraints.find((c) => c.type === "disjunctive_mandatory");
        expect(dm).toBeDefined();
        if (dm?.type === "disjunctive_mandatory") {
          expect(dm.roleIds).toHaveLength(2);
        }
      });

      it("skips disjunctive mandatory with unresolvable roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "disjunctive_mandatory",
                fact_type: "Person drives Car",
                roles: ["Ghost"],
                description: "Bad role",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
      });

      it("detects duplicate disjunctive mandatory", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "disjunctive_mandatory",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "First DM",
                confidence: "high",
                source_references: [],
              },
              {
                type: "disjunctive_mandatory",
                fact_type: "Person drives Car",
                roles: ["Car", "Person"],
                description: "Duplicate DM (reversed order)",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- exclusion ---

    describe("exclusion", () => {
      it("applies exclusion constraint", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "exclusion",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "No Person both drives and is driven by the same Car.",
                confidence: "high",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const ex = ft.constraints.find((c) => c.type === "exclusion");
        expect(ex).toBeDefined();
        if (ex?.type === "exclusion") {
          expect(ex.roleIds).toHaveLength(2);
        }
      });

      it("skips exclusion with unresolvable roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "exclusion",
                fact_type: "Person drives Car",
                roles: ["Unknown"],
                description: "Bad exclusion",
                confidence: "low",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
      });

      it("detects duplicate exclusion", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "exclusion",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "First exclusion",
                confidence: "high",
                source_references: [],
              },
              {
                type: "exclusion",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "Duplicate exclusion",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- exclusive_or ---

    describe("exclusive_or", () => {
      it("applies exclusive-or constraint", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "exclusive_or",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "Each Person either drives or is driven but not both.",
                confidence: "high",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const xor = ft.constraints.find((c) => c.type === "exclusive_or");
        expect(xor).toBeDefined();
        if (xor?.type === "exclusive_or") {
          expect(xor.roleIds).toHaveLength(2);
        }
      });

      it("skips exclusive-or with unresolvable roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "exclusive_or",
                fact_type: "Person drives Car",
                roles: ["Phantom"],
                description: "Bad XOR",
                confidence: "low",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
      });

      it("detects duplicate exclusive-or", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "exclusive_or",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "First XOR",
                confidence: "high",
                source_references: [],
              },
              {
                type: "exclusive_or",
                fact_type: "Person drives Car",
                roles: ["Car", "Person"],
                description: "Duplicate XOR",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- frequency ---

    describe("frequency", () => {
      it("applies frequency constraint with bounded range", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person"],
                description: "Each Person drives between 1 and 3 Cars.",
                confidence: "high",
                min: 1,
                max: 3,
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const fc = ft.constraints.find((c) => c.type === "frequency");
        expect(fc).toBeDefined();
        if (fc?.type === "frequency") {
          expect(fc.min).toBe(1);
          expect(fc.max).toBe(3);
        }
      });

      it("applies frequency constraint with unbounded max", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person"],
                description: "Each Person drives at least 2 Cars.",
                confidence: "high",
                min: 2,
                max: "unbounded",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const fc = ft.constraints.find((c) => c.type === "frequency");
        if (fc?.type === "frequency") {
          expect(fc.min).toBe(2);
          expect(fc.max).toBe("unbounded");
        }
      });

      it("skips frequency with missing min", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person"],
                description: "Frequency with no min",
                confidence: "medium",
                max: 5,
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("min");
      });

      it("skips frequency with missing max", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person"],
                description: "Frequency with no max",
                confidence: "medium",
                min: 1,
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("max");
      });

      it("skips frequency with unresolvable role", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Unknown"],
                description: "Frequency on bad role",
                confidence: "low",
                min: 1,
                max: 5,
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
      });

      it("skips frequency with multiple roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                description: "Frequency on two roles",
                confidence: "medium",
                min: 1,
                max: 5,
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("exactly one role");
      });

      it("detects duplicate frequency on same role", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person"],
                description: "First frequency",
                confidence: "high",
                min: 1,
                max: 3,
                source_references: [],
              },
              {
                type: "frequency",
                fact_type: "Person drives Car",
                roles: ["Person"],
                description: "Duplicate frequency",
                confidence: "medium",
                min: 2,
                max: 5,
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- ring ---

    describe("ring", () => {
      it("applies ring constraint with valid ring_type", () => {
        const resp = makeRingFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages", "is managed by"],
                description: "No Person manages themselves.",
                confidence: "high",
                ring_type: "irreflexive",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person manages Person")!;
        const rc = ft.constraints.find((c) => c.type === "ring");
        expect(rc).toBeDefined();
        if (rc?.type === "ring") {
          expect(rc.ringType).toBe("irreflexive");
        }
      });

      it("applies asymmetric ring constraint", () => {
        const resp = makeRingFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages", "is managed by"],
                description: "If A manages B then B does not manage A.",
                confidence: "high",
                ring_type: "asymmetric",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person manages Person")!;
        const rc = ft.constraints.find((c) => c.type === "ring");
        if (rc?.type === "ring") {
          expect(rc.ringType).toBe("asymmetric");
        }
      });

      it("skips ring with missing ring_type", () => {
        const resp = makeRingFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages", "is managed by"],
                description: "Ring with no ring_type",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("ring_type");
      });

      it("skips ring with invalid ring_type", () => {
        const resp = makeRingFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages", "is managed by"],
                description: "Ring with bad type",
                confidence: "medium",
                ring_type: "invalid_type",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("ring_type");
      });

      it("skips ring that does not have exactly 2 roles", () => {
        const resp = makeRingFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages"],
                description: "Ring with one role",
                confidence: "medium",
                ring_type: "irreflexive",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("exactly 2 roles");
      });

      it("detects duplicate ring constraint", () => {
        const resp = makeRingFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages", "is managed by"],
                description: "First ring",
                confidence: "high",
                ring_type: "irreflexive",
                source_references: [],
              },
              {
                type: "ring",
                fact_type: "Person manages Person",
                roles: ["manages", "is managed by"],
                description: "Duplicate ring",
                confidence: "medium",
                ring_type: "irreflexive",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- subset ---

    describe("subset", () => {
      it("applies subset constraint within same fact type", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "If Person drives Car then Person rides Bus.",
                confidence: "high",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const sc = ft.constraints.find((c) => c.type === "subset");
        expect(sc).toBeDefined();
        if (sc?.type === "subset") {
          expect(sc.subsetRoleIds).toHaveLength(1);
          expect(sc.supersetRoleIds).toHaveLength(1);
        }
      });

      it("skips subset with missing superset_fact_type", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_roles: ["Person"],
                description: "Subset with no superset fact type",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("superset_fact_type");
      });

      it("skips subset with missing superset_roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                description: "Subset with no superset roles",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("superset_roles");
      });

      it("skips subset with mismatched arity", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person", "Car"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "Subset with arity mismatch",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("arity");
      });

      it("skips subset when superset fact type not found", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Nonexistent FT",
                superset_roles: ["Person"],
                description: "Subset to missing FT",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("not found");
      });

      it("detects duplicate subset constraint", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "First subset",
                confidence: "high",
                source_references: [],
              },
              {
                type: "subset",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "Duplicate subset",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });

    // --- equality ---

    describe("equality", () => {
      it("applies equality constraint across two fact types", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "Person drives Car iff Person rides Bus.",
                confidence: "high",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        const ft = result.model.getFactTypeByName("Person drives Car")!;
        const eq = ft.constraints.find((c) => c.type === "equality");
        expect(eq).toBeDefined();
        if (eq?.type === "equality") {
          expect(eq.roleIds1).toHaveLength(1);
          expect(eq.roleIds2).toHaveLength(1);
        }
      });

      it("skips equality with missing superset_fact_type", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_roles: ["Person"],
                description: "Equality with no second FT",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("superset_fact_type");
      });

      it("skips equality with mismatched arity", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person", "Bus"],
                description: "Equality with arity mismatch",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("arity");
      });

      it("skips equality with missing superset_roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                description: "Equality with no superset roles",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("superset_roles");
      });

      it("skips equality when superset fact type not found", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Nonexistent FT",
                superset_roles: ["Person"],
                description: "Equality to missing FT",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("not found");
      });

      it("skips equality with unresolvable roles", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Nonexistent"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "Equality with bad subset role",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(false);
        expect(result.constraintProvenance[0]?.skipReason).toContain("Could not resolve");
      });

      it("detects duplicate equality constraint", () => {
        const resp = makeTwoFactTypeModel();
        const result = parseDraftModel(
          {
            ...resp,
            inferred_constraints: [
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "First equality",
                confidence: "high",
                source_references: [],
              },
              {
                type: "equality",
                fact_type: "Person drives Car",
                roles: ["Person"],
                superset_fact_type: "Person rides Bus",
                superset_roles: ["Person"],
                description: "Duplicate equality",
                confidence: "medium",
                source_references: [],
              },
            ],
          },
          "Test",
        );

        expect(result.constraintProvenance[0]?.applied).toBe(true);
        expect(result.constraintProvenance[1]?.applied).toBe(false);
        expect(result.constraintProvenance[1]?.skipReason).toContain("Duplicate");
      });
    });
  });

  describe("objectification extraction", () => {
    function makeModelWithFactTypeAndEntities() {
      return makeResponse({
        object_types: [
          { name: "Student", kind: "entity", reference_mode: "student_id", source_references: [] },
          { name: "Course", kind: "entity", reference_mode: "course_id", source_references: [] },
          {
            name: "Enrollment",
            kind: "entity",
            reference_mode: "enrollment_id",
            source_references: [],
          },
          { name: "Rating", kind: "value", source_references: [] },
        ],
        fact_types: [
          {
            name: "Student enrolls in Course",
            roles: [
              { player: "Student", role_name: "enrolls in" },
              { player: "Course", role_name: "is enrolled in by" },
            ],
            readings: ["{0} enrolls in {1}"],
            source_references: [],
          },
        ],
      });
    }

    it("applies objectification linking fact type to entity", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(
        {
          ...resp,
          objectified_fact_types: [
            {
              fact_type: "Student enrolls in Course",
              object_type: "Enrollment",
              description: "Enrollment objectifies the enrollment relationship.",
              source_references: [{ lines: [10, 12], excerpt: "enrollment record" }],
            },
          ],
        },
        "Test",
      );

      expect(result.model.objectifiedFactTypes).toHaveLength(1);
      const oft = result.model.objectifiedFactTypes[0]!;
      const ft = result.model.getFactTypeByName("Student enrolls in Course")!;
      const ot = result.model.getObjectTypeByName("Enrollment")!;
      expect(oft.factTypeId).toBe(ft.id);
      expect(oft.objectTypeId).toBe(ot.id);

      expect(result.objectificationProvenance).toHaveLength(1);
      expect(result.objectificationProvenance[0]!.applied).toBe(true);
      expect(result.objectificationProvenance[0]!.factType).toBe("Student enrolls in Course");
      expect(result.objectificationProvenance[0]!.objectType).toBe("Enrollment");
      expect(result.objectificationProvenance[0]!.sourceReferences).toHaveLength(1);
    });

    it("skips when fact type not found", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(
        {
          ...resp,
          objectified_fact_types: [
            {
              fact_type: "Nonexistent FT",
              object_type: "Enrollment",
              description: "Bad fact type reference",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.objectifiedFactTypes).toHaveLength(0);
      expect(result.objectificationProvenance[0]!.applied).toBe(false);
      expect(result.objectificationProvenance[0]!.skipReason).toContain("Nonexistent FT");
      expect(result.objectificationProvenance[0]!.skipReason).toContain("not found");
    });

    it("skips when object type not found", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(
        {
          ...resp,
          objectified_fact_types: [
            {
              fact_type: "Student enrolls in Course",
              object_type: "NonexistentEntity",
              description: "Bad object type reference",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.objectifiedFactTypes).toHaveLength(0);
      expect(result.objectificationProvenance[0]!.applied).toBe(false);
      expect(result.objectificationProvenance[0]!.skipReason).toContain("NonexistentEntity");
      expect(result.objectificationProvenance[0]!.skipReason).toContain("not found");
    });

    it("skips when object type is a value type", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(
        {
          ...resp,
          objectified_fact_types: [
            {
              fact_type: "Student enrolls in Course",
              object_type: "Rating",
              description: "Value type cannot objectify",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      expect(result.model.objectifiedFactTypes).toHaveLength(0);
      expect(result.objectificationProvenance[0]!.applied).toBe(false);
      expect(result.objectificationProvenance[0]!.skipReason).toContain("value");
      expect(result.objectificationProvenance[0]!.skipReason).toContain("not an entity");
    });

    it("skips duplicate objectification of same fact type", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(
        {
          ...resp,
          objectified_fact_types: [
            {
              fact_type: "Student enrolls in Course",
              object_type: "Enrollment",
              description: "First objectification",
              source_references: [],
            },
            {
              fact_type: "Student enrolls in Course",
              object_type: "Enrollment",
              description: "Duplicate objectification",
              source_references: [],
            },
          ],
        },
        "Test",
      );

      // First succeeds, second is caught by model validation.
      expect(result.model.objectifiedFactTypes).toHaveLength(1);
      expect(result.objectificationProvenance).toHaveLength(2);
      expect(result.objectificationProvenance[0]!.applied).toBe(true);
      expect(result.objectificationProvenance[1]!.applied).toBe(false);
      expect(result.objectificationProvenance[1]!.skipReason).toContain("Failed");
    });

    it("handles empty objectified_fact_types array", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(
        {
          ...resp,
          objectified_fact_types: [],
        },
        "Test",
      );

      expect(result.model.objectifiedFactTypes).toHaveLength(0);
      expect(result.objectificationProvenance).toHaveLength(0);
    });

    it("handles missing objectified_fact_types field", () => {
      const resp = makeModelWithFactTypeAndEntities();
      const result = parseDraftModel(resp, "Test");

      expect(result.model.objectifiedFactTypes).toHaveLength(0);
      expect(result.objectificationProvenance).toHaveLength(0);
    });
  });

  describe("population extraction", () => {
    it("creates populations from extraction response", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              reference_mode: "customer_id",
              source_references: [],
            },
            {
              name: "CustomerId",
              kind: "value",
              data_type: { name: "text", length: 10 },
              source_references: [],
            },
          ],
          fact_types: [
            {
              name: "Customer has CustomerId",
              roles: [
                { player: "Customer", role_name: "has" },
                { player: "CustomerId", role_name: "identifies" },
              ],
              readings: ["{0} has {1}"],
              source_references: [],
            },
          ],
          populations: [
            {
              fact_type: "Customer has CustomerId",
              description: "Sample customers",
              instances: [
                { role_values: { Customer: "C001", CustomerId: "C001" } },
                { role_values: { Customer: "C002", CustomerId: "C002" } },
              ],
              source_references: [{ lines: [10, 12], excerpt: "Example: Customer C001" }],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.populations).toHaveLength(1);
      const pop = result.model.populations[0];
      expect(pop).toBeDefined();
      expect(pop!.instances).toHaveLength(2);
      expect(pop!.description).toBe("Sample customers");
    });

    it("skips populations for non-existent fact types", () => {
      const result = parseDraftModel(
        makeResponse({
          populations: [
            {
              fact_type: "NonExistent",
              instances: [{ role_values: { Player: "value" } }],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      expect(result.model.populations).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("NonExistent"))).toBe(true);
    });

    it("handles populations with missing player resolution", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            {
              name: "Customer",
              kind: "entity",
              reference_mode: "customer_id",
              source_references: [],
            },
          ],
          fact_types: [
            {
              name: "Test Fact",
              roles: [{ player: "Customer", role_name: "test" }],
              readings: ["{0}"],
              source_references: [],
            },
          ],
          populations: [
            {
              fact_type: "Test Fact",
              instances: [
                { role_values: { NonExistentPlayer: "value" } },
              ],
              source_references: [],
            },
          ],
        }),
        "Test",
      );

      // When all instances fail to resolve, population is still created but empty
      expect(result.model.populations.length).toBeGreaterThanOrEqual(0);
      expect(result.warnings.some((w) => w.includes("NonExistentPlayer"))).toBe(true);
    });

    it("handles empty populations array", () => {
      const result = parseDraftModel(
        makeResponse({
          populations: [],
        }),
        "Test",
      );

      expect(result.model.populations).toHaveLength(0);
    });

    it("handles missing populations field", () => {
      const result = parseDraftModel(makeResponse(), "Test");

      expect(result.model.populations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty extraction response", () => {
      const result = parseDraftModel(makeResponse(), "Empty");
      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.model.factTypes).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("handles duplicate object type names gracefully", () => {
      const result = parseDraftModel(
        makeResponse({
          object_types: [
            { name: "Customer", kind: "entity", reference_mode: "cid", source_references: [] },
            { name: "Customer", kind: "entity", reference_mode: "cid2", source_references: [] },
          ],
        }),
        "Test",
      );

      // First one succeeds, second one produces a warning.
      expect(result.model.objectTypes).toHaveLength(1);
      expect(result.warnings.some((w) => w.includes("Customer"))).toBe(true);
    });
  });
});
