/**
 * Tests for the deterministic conformance validation step.
 *
 * The conformance validator sits between parseExtractionResponse() and
 * parseDraftModel(), catching structural violations in the LLM output
 * before the parser consumes it. Each test targets one conformance
 * check from the spec.
 */
import { describe, expect, it } from "vitest";
import { enforceConformance } from "../src/ExtractionConformance.js";
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

const REF = [{ lines: [1, 2] as [number, number], excerpt: "test" }];

describe("ExtractionConformance", () => {
  describe("clean extraction passthrough", () => {
    it("returns unchanged response when no issues exist", () => {
      const input = makeResponse({
        object_types: [
          {
            name: "Customer",
            kind: "entity",
            reference_mode: "customer_id",
            source_references: REF,
          },
          {
            name: "CustomerId",
            kind: "value",
            data_type: { name: "text", length: 20 },
            source_references: REF,
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
            source_references: REF,
          },
        ],
        inferred_constraints: [
          {
            type: "internal_uniqueness",
            fact_type: "Customer has CustomerId",
            roles: ["Customer"],
            description: "Each Customer has at most one CustomerId",
            confidence: "high",
            is_preferred: true,
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(corrections).toHaveLength(0);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(response.inferred_constraints[0]!.is_preferred).toBe(true);
    });
  });

  describe("population checks", () => {
    it("removes populations with empty instances", () => {
      const input = makeResponse({
        object_types: [
          { name: "Doctor", kind: "entity", source_references: REF },
          { name: "Specialty", kind: "value", source_references: REF },
        ],
        fact_types: [
          {
            name: "Doctor has Specialty",
            roles: [
              { player: "Doctor", role_name: "has" },
              { player: "Specialty", role_name: "is of" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
        ],
        populations: [
          {
            fact_type: "Doctor has Specialty",
            instances: [],
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.populations).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("empty_population");
    });

    it("removes populations referencing nonexistent fact types", () => {
      const input = makeResponse({
        populations: [
          {
            fact_type: "Nonexistent Relationship",
            instances: [{ role_values: { A: "1" } }],
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.populations).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("orphaned_population");
    });

    it("removes populations that duplicate value constraints", () => {
      const input = makeResponse({
        object_types: [
          { name: "Appointment", kind: "entity", source_references: REF },
          {
            name: "AppointmentStatus",
            kind: "value",
            value_constraint: { values: ["scheduled", "checked-in", "completed", "cancelled"] },
            source_references: REF,
          },
        ],
        fact_types: [
          {
            name: "Appointment has AppointmentStatus",
            roles: [
              { player: "Appointment", role_name: "has" },
              { player: "AppointmentStatus", role_name: "is status of" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
        ],
        populations: [
          {
            fact_type: "Appointment has AppointmentStatus",
            instances: [
              { role_values: { AppointmentStatus: "scheduled" } },
              { role_values: { AppointmentStatus: "checked-in" } },
              { role_values: { AppointmentStatus: "completed" } },
            ],
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.populations).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("duplicate_value_constraint_population");
    });

    it("keeps populations with real instance data", () => {
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Name", kind: "value", source_references: REF },
        ],
        fact_types: [
          {
            name: "Customer has Name",
            roles: [
              { player: "Customer", role_name: "has" },
              { player: "Name", role_name: "is of" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
        ],
        populations: [
          {
            fact_type: "Customer has Name",
            instances: [
              { role_values: { Customer: "C001", Name: "Alice" } },
              { role_values: { Customer: "C002", Name: "Bob" } },
            ],
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.populations).toHaveLength(1);
      expect(corrections).toHaveLength(0);
    });
  });

  describe("constraint checks", () => {
    it("removes constraints with role players not in object_types", () => {
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
        ],
        fact_types: [
          {
            name: "Customer places Order",
            roles: [
              { player: "Customer", role_name: "places" },
              { player: "Order", role_name: "is placed by" },
            ],
            readings: ["{0} places {1}"],
            source_references: REF,
          },
        ],
        inferred_constraints: [
          {
            type: "internal_uniqueness",
            fact_type: "Customer places Order",
            roles: ["Order"],
            description: "Each Order is placed by at most one Customer",
            confidence: "high",
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("invalid_role_player");
    });

    it("removes ring constraints with wrong arity", () => {
      const input = makeResponse({
        object_types: [
          { name: "Person", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          {
            type: "ring",
            fact_type: "Person manages Person",
            roles: ["Person"],
            description: "No Person manages themselves",
            confidence: "high",
            ring_type: "irreflexive",
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("arity_mismatch");
      expect(corrections[0]!.description).toContain("exactly 2");
    });

    it("removes frequency constraints with wrong arity", () => {
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          {
            type: "frequency",
            fact_type: "Customer places Order",
            roles: ["Customer", "Order"],
            description: "Each Customer places between 1 and 5 Orders",
            confidence: "medium",
            min: 1,
            max: 5,
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("arity_mismatch");
      expect(corrections[0]!.description).toContain("exactly 1");
    });

    it("removes mandatory constraints with wrong arity", () => {
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Name", kind: "value", source_references: REF },
        ],
        inferred_constraints: [
          {
            type: "mandatory",
            fact_type: "Customer has Name",
            roles: ["Customer", "Name"],
            description: "Every Customer must have a Name",
            confidence: "high",
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(0);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("arity_mismatch");
    });

    it("clears is_preferred on non-identifier fact types", () => {
      const input = makeResponse({
        object_types: [
          {
            name: "Customer",
            kind: "entity",
            reference_mode: "customer_id",
            source_references: REF,
          },
          { name: "CustomerId", kind: "value", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        fact_types: [
          {
            name: "Customer has CustomerId",
            roles: [
              { player: "Customer", role_name: "has" },
              { player: "CustomerId", role_name: "identifies" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
          {
            name: "Customer places Order",
            roles: [
              { player: "Customer", role_name: "places" },
              { player: "Order", role_name: "is placed by" },
            ],
            readings: ["{0} places {1}"],
            source_references: REF,
          },
        ],
        inferred_constraints: [
          {
            type: "internal_uniqueness",
            fact_type: "Customer places Order",
            roles: ["Order"],
            description: "Each Order is placed by one Customer",
            confidence: "high",
            is_preferred: true,
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(response.inferred_constraints[0]!.is_preferred).toBeUndefined();
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("misplaced_is_preferred");
    });

    it("removes duplicate constraints", () => {
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          {
            type: "internal_uniqueness",
            fact_type: "Customer places Order",
            roles: ["Order"],
            description: "Each Order is placed by at most one Customer",
            confidence: "high",
            source_references: REF,
          },
          {
            type: "internal_uniqueness",
            fact_type: "Customer places Order",
            roles: ["Order"],
            description: "An Order belongs to exactly one Customer",
            confidence: "medium",
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(response.inferred_constraints[0]!.description).toBe(
        "Each Order is placed by at most one Customer",
      );
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("duplicate_constraint");
    });
  });

  describe("reference modes", () => {
    it("does not charge an entity for a reference mode with no identifier fact type", () => {
      // barwise-839 removed the check that did. It was the only
      // conformance check mirroring no validator rule, it charged 0.02
      // for a condition core rates `info` (and therefore prices at
      // zero), and it flagged precisely what ORM reference-mode
      // notation abbreviates: `Customer (customer_id)` IS the shorthand
      // for the identifier fact type.
      //
      // The parser also manufactures a reference mode for every entity
      // that lacks one -- `ObjectType` throws without one -- so "has a
      // reference mode" was never evidence of anything.
      //
      // Kept as a regression guard rather than deleted: the check fired
      // 14 times across the 7 recorded answer keys and was their entire
      // penalty, so reintroducing it would silently reprice every
      // recorded history row.
      const input = makeResponse({
        object_types: [
          {
            name: "Customer",
            kind: "entity",
            reference_mode: "customer_id",
            source_references: REF,
          },
        ],
        fact_types: [],
      });

      const { corrections } = enforceConformance(input);
      expect(corrections).toHaveLength(0);
    });
  });

  describe("identifier-population repair", () => {
    /** Customer (identified) placing Orders, with an example population. */
    function repairFixture(
      extraPopulations: NonNullable<ExtractionResponse["populations"]> = [],
    ): ExtractionResponse {
      return makeResponse({
        object_types: [
          {
            name: "Customer",
            kind: "entity",
            reference_mode: "customer_id",
            source_references: REF,
          },
          {
            name: "CustomerId",
            kind: "value",
            data_type: { name: "text", length: 20 },
            source_references: REF,
          },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        fact_types: [
          {
            name: "Customer has CustomerId",
            roles: [
              { player: "Customer", role_name: "has" },
              { player: "CustomerId", role_name: "identifies" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
          {
            name: "Customer places Order",
            roles: [
              { player: "Customer", role_name: "places" },
              { player: "Order", role_name: "is placed by" },
            ],
            readings: ["{0} places {1}"],
            source_references: REF,
          },
        ],
        populations: [
          {
            fact_type: "Customer places Order",
            instances: [{ role_values: { Customer: "C-1", Order: "O-1" } }],
            source_references: REF,
          },
          ...extraPopulations,
        ],
      });
    }

    it("appends the entailed identifier instance for an exemplified entity", () => {
      const { response, corrections } = enforceConformance(repairFixture());

      const repairs = corrections.filter((c) => c.category === "missing_identifier_population");
      expect(repairs).toHaveLength(1);
      expect(repairs[0]!.element).toBe("Customer has CustomerId");

      const idPop = response.populations!.find((p) => p.fact_type === "Customer has CustomerId");
      expect(idPop).toBeDefined();
      expect(idPop!.instances).toEqual([
        { role_values: { Customer: "C-1", CustomerId: "C-1" } },
      ]);
      // Order has no identifier fact type: nothing is synthesized for it.
      expect(response.populations!.filter((p) => p.fact_type !== "Customer places Order"))
        .toHaveLength(1);
    });

    it("is idempotent: an already-covered value triggers no repair", () => {
      const { response, corrections } = enforceConformance(repairFixture([
        {
          fact_type: "Customer has CustomerId",
          instances: [{ role_values: { Customer: "C-1", CustomerId: "C-1" } }],
          source_references: REF,
        },
      ]));

      expect(corrections.filter((c) => c.category === "missing_identifier_population"))
        .toHaveLength(0);
      const idPop = response.populations!.find((p) => p.fact_type === "Customer has CustomerId");
      expect(idPop!.instances).toHaveLength(1);
    });

    it("does not invent an identifier population for an entity that has no identifier", () => {
      const input = makeResponse({
        object_types: [
          {
            name: "Customer",
            kind: "entity",
            reference_mode: "customer_id",
            source_references: REF,
          },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        fact_types: [
          {
            name: "Customer places Order",
            roles: [
              { player: "Customer", role_name: "places" },
              { player: "Order", role_name: "is placed by" },
            ],
            readings: ["{0} places {1}"],
            source_references: REF,
          },
        ],
        populations: [
          {
            fact_type: "Customer places Order",
            instances: [{ role_values: { Customer: "C-1", Order: "O-1" } }],
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      // Customer declares a reference mode but no fact type identifies
      // it, so it never enters identifierFactByEntity and the repair has
      // nothing to key on. Nothing is invented, and since barwise-839
      // nothing is charged either.
      expect(corrections.some((c) => c.category === "missing_identifier_population")).toBe(false);
      expect(corrections).toHaveLength(0);
      expect(response.populations).toHaveLength(1);
    });
  });

  describe("multiple corrections", () => {
    it("applies all applicable corrections in a single pass", () => {
      const input = makeResponse({
        object_types: [
          { name: "Patient", kind: "entity", reference_mode: "mrn", source_references: REF },
          {
            name: "Status",
            kind: "value",
            value_constraint: { values: ["active", "inactive"] },
            source_references: REF,
          },
        ],
        fact_types: [
          {
            name: "Patient has Status",
            roles: [
              { player: "Patient", role_name: "has" },
              { player: "Status", role_name: "is of" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
        ],
        populations: [
          // Empty instances -- should be removed
          {
            fact_type: "Patient has Status",
            instances: [],
            source_references: REF,
          },
          // Orphaned fact type -- should be removed
          {
            fact_type: "Ghost relationship",
            instances: [{ role_values: { A: "1" } }],
            source_references: REF,
          },
        ],
        inferred_constraints: [
          // Invalid role player
          {
            type: "mandatory",
            fact_type: "Patient has MissingType",
            roles: ["MissingType"],
            description: "Every Patient has a MissingType",
            confidence: "high",
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.populations).toHaveLength(0);
      expect(response.inferred_constraints).toHaveLength(0);
      // 2 population corrections + 1 constraint correction.
      expect(corrections).toHaveLength(3);

      const categories = corrections.map((c) => c.category);
      expect(categories).toContain("empty_population");
      expect(categories).toContain("orphaned_population");
      expect(categories).toContain("invalid_role_player");
    });
  });
});
