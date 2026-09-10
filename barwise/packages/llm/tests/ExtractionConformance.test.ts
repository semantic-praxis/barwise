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

    it("keeps ring constraints that differ only in ring type", () => {
      // Irreflexive and acyclic on the same role pair are independent
      // assertions and the validator accepts both. A recorded
      // incident-response payload carried exactly this pair and the
      // acyclic one was silently dropped as a duplicate because the
      // key ignored ring_type.
      const ring = (ringType: string, description: string) => ({
        type: "ring" as const,
        fact_type: "Incident is duplicate of Incident",
        roles: ["Incident", "Incident"],
        description,
        confidence: "high" as const,
        ring_type: ringType,
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          { name: "Incident", kind: "entity", source_references: REF },
        ],
        fact_types: [
          {
            name: "Incident is duplicate of Incident",
            roles: [
              { player: "Incident", role_name: "duplicate" },
              { player: "Incident", role_name: "primary" },
            ],
            readings: ["{0} is duplicate of {1}"],
            source_references: REF,
          },
        ],
        inferred_constraints: [
          ring("irreflexive", "An Incident cannot duplicate itself"),
          ring("acyclic", "Duplicate links cannot form a cycle"),
          ring("acyclic", "Restated: no duplicate cycles"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints.map((c) => c.ring_type)).toEqual([
        "irreflexive",
        "acyclic",
      ]);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("duplicate_constraint");
    });

    // The three types below are the rest of the hole `ring_type` was
    // the found instance of (barwise-883). The key was
    // `type|fact_type|roles` plus a ring special case, so for these
    // three the field that says what the constraint actually asserts
    // was not in the key at all, and the second was deleted.
    //
    // Each pair is one of two things and neither is a duplicate:
    // independent content, or a contradiction that survives so a
    // reader can see it. Nothing downstream reports the contradiction
    // today -- a model carrying both frequency constraints below
    // validates without a diagnostic about them (barwise-1008) -- which
    // is a reason to keep the pair, not to drop one.

    it("keeps value constraints that differ only in their values", () => {
      const valueConstraint = (values: readonly string[], description: string) => ({
        type: "value_constraint" as const,
        fact_type: "Order has Status",
        roles: ["Status"],
        description,
        confidence: "high" as const,
        values,
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          { name: "Order", kind: "entity", source_references: REF },
          { name: "Status", kind: "value", source_references: REF },
        ],
        inferred_constraints: [
          valueConstraint(["open", "closed"], "A Status is open or closed"),
          valueConstraint(["draft", "sent"], "A Status is draft or sent"),
          valueConstraint(["closed", "open"], "Restated, in the other order"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      // The third is a genuine duplicate of the first: a domain is a
      // set, so the order it is listed in cannot make it a different
      // domain.
      expect(response.inferred_constraints.map((c) => c.values)).toEqual([
        ["open", "closed"],
        ["draft", "sent"],
      ]);
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.category).toBe("duplicate_constraint");
    });

    it("keeps frequency constraints that differ only in their bounds", () => {
      const frequency = (
        min: number,
        max: number | "unbounded",
        description: string,
      ) => ({
        type: "frequency" as const,
        fact_type: "Employee works on Project",
        roles: ["Employee"],
        description,
        confidence: "high" as const,
        min,
        max,
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          { name: "Employee", kind: "entity", source_references: REF },
          { name: "Project", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          frequency(1, 3, "An Employee works on one to three Projects"),
          // Differs from the first in its MIN alone, and the next in
          // its MAX alone, so neither bound can be dropped from the key
          // without collapsing one of these pairs.
          frequency(2, 3, "An Employee works on two to three Projects"),
          frequency(1, "unbounded", "An Employee works on at least one Project"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints.map((c) => [c.min, c.max])).toEqual([
        [1, 3],
        [2, 3],
        [1, "unbounded"],
      ]);
      expect(corrections).toHaveLength(0);
    });

    it("keeps subset constraints that differ only in their superset", () => {
      const subset = (
        supersetFactType: string,
        supersetRoles: readonly string[],
        description: string,
      ) => ({
        type: "subset" as const,
        fact_type: "Employee manages Project",
        roles: ["Employee", "Project"],
        description,
        confidence: "high" as const,
        superset_fact_type: supersetFactType,
        superset_roles: supersetRoles,
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          { name: "Employee", kind: "entity", source_references: REF },
          { name: "Project", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          subset("Employee works on Project", ["Employee", "Project"], "Managing implies working"),
          subset("Employee is assigned to Project", ["Employee", "Project"], "and being assigned"),
          // Same superset fact type, roles the other way round. Those
          // roles pair POSITIONALLY with `roles`, so this is a
          // different claim, not a restatement -- which is why
          // superset_roles is compared in order where `roles` is not.
          subset("Employee works on Project", ["Project", "Employee"], "Reversed pairing"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints.map((c) => c.superset_roles)).toEqual([
        ["Employee", "Project"],
        ["Employee", "Project"],
        ["Project", "Employee"],
      ]);
      expect(corrections).toHaveLength(0);
    });

    it.each([
      [
        "their type",
        { type: "mandatory" as const },
        { type: "internal_uniqueness" as const },
      ],
      [
        "their fact type",
        { fact_type: "Customer places Order" },
        { fact_type: "Customer cancels Order" },
      ],
      [
        "which roles they cover",
        { roles: ["Customer"] },
        { roles: ["Order"] },
      ],
    ])("separates two constraints differing only in %s", (_which, first, second) => {
      // The two fields nobody would think to test, which is why they
      // went untested: every other fixture pairs a difference in type
      // or fact type with a difference in some other field, so neither
      // was ever the reason a pair stayed apart.
      const base = {
        type: "mandatory" as const,
        fact_type: "Customer places Order",
        roles: ["Customer"],
        description: "A Customer places an Order",
        confidence: "high" as const,
        source_references: REF,
      };
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [{ ...base, ...first }, { ...base, ...second }],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(2);
      expect(corrections.filter((c) => c.category === "duplicate_constraint")).toHaveLength(0);
    });

    it("treats a role list as a set, so its order cannot make a duplicate distinct", () => {
      // The counterpart to superset_roles above: `roles` names which
      // roles a constraint covers, not an ordering of them, so a
      // restatement listing them the other way round is the same key.
      const uniqueness = (roles: readonly string[], description: string) => ({
        type: "internal_uniqueness" as const,
        fact_type: "Customer places Order",
        roles,
        description,
        confidence: "high" as const,
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          uniqueness(["Customer", "Order"], "One Customer-Order pair at most once"),
          uniqueness(["Order", "Customer"], "Restated the other way round"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(corrections.filter((c) => c.category === "duplicate_constraint")).toHaveLength(1);
    });

    it("drops a uniqueness constraint differing only in is_preferred", () => {
      // The deliberate, uncomfortable row of the classification table.
      // is_preferred qualifies a uniqueness assertion without changing
      // which roles it covers, so keying on it would emit two identical
      // uniqueness constraints. The cost is that the flag is lost when
      // the preferred one comes second, as it does here -- which wants
      // the survivor to absorb the flag rather than the pair to
      // survive, and that is barwise-1010 rather than this fix. Pinned
      // so the loss is a recorded decision instead of a surprise.
      const uniqueness = (isPreferred: boolean, description: string) => ({
        type: "internal_uniqueness" as const,
        fact_type: "Customer has CustomerId",
        roles: ["CustomerId"],
        description,
        confidence: "high" as const,
        ...(isPreferred ? { is_preferred: true } : {}),
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          // The reference mode matters: without it this is not an
          // identifier fact type, check 6 clears is_preferred before
          // the key is ever computed, and the fixture cannot see what
          // the key does with the flag at all.
          {
            name: "Customer",
            kind: "entity",
            reference_mode: "customer_id",
            source_references: REF,
          },
          { name: "CustomerId", kind: "value", source_references: REF },
        ],
        fact_types: [
          {
            name: "Customer has CustomerId",
            roles: [
              { player: "Customer", role_name: "identified" },
              { player: "CustomerId", role_name: "identifier" },
            ],
            readings: ["{0} has {1}"],
            source_references: REF,
          },
        ],
        inferred_constraints: [
          uniqueness(false, "Each CustomerId identifies one Customer"),
          uniqueness(true, "CustomerId is the preferred identifier"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(response.inferred_constraints[0]!.is_preferred).toBeUndefined();
      expect(corrections.filter((c) => c.category === "duplicate_constraint")).toHaveLength(1);
    });

    it("separates constraints whose difference is WHICH field carries a value", () => {
      // "At least two" and "at most two" on one role: opposite claims,
      // and a frequency constraint may carry either bound alone.
      //
      // The key omits absent fields, so position no longer says which
      // field a value came from -- min and max are adjacent in the
      // field order, and these two reduce to the identical sequence
      // unless each value carries its field name. The second would be
      // deleted as a duplicate of the first.
      const frequency = (
        bound: { min: number; } | { max: number; },
        description: string,
      ) => ({
        type: "frequency" as const,
        fact_type: "Employee works on Project",
        roles: ["Employee"],
        description,
        confidence: "high" as const,
        ...bound,
        source_references: REF,
      });
      const input = makeResponse({
        object_types: [
          { name: "Employee", kind: "entity", source_references: REF },
          { name: "Project", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          frequency({ min: 2 }, "An Employee works on at least two Projects"),
          frequency({ max: 2 }, "An Employee works on at most two Projects"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints.map((c) => [c.min, c.max])).toEqual([
        [2, undefined],
        [undefined, 2],
      ]);
      expect(corrections.filter((c) => c.category === "duplicate_constraint")).toHaveLength(0);
    });

    it("drops a duplicate that cites a different part of the transcript", () => {
      // source_references is provenance, not content: a model restating
      // one rule from two places in the transcript has asserted it
      // once. Every other fixture here shares one REF constant, so
      // nothing else can tell whether the key reads this field.
      const otherRef = [{ quote: "Elsewhere, the same rule", location: "line 99" }];
      const mandatory = (
        sourceReferences: typeof REF,
        description: string,
      ) => ({
        type: "mandatory" as const,
        fact_type: "Customer places Order",
        roles: ["Customer"],
        description,
        confidence: "high" as const,
        source_references: sourceReferences,
      });
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          mandatory(REF, "Every Customer places an Order"),
          mandatory(otherRef, "Every Customer places an Order"),
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(corrections.filter((c) => c.category === "duplicate_constraint")).toHaveLength(1);
    });

    it("still drops a constraint differing only in prose or confidence", () => {
      // The other half of the rule: description, confidence,
      // source_references and is_preferred annotate an assertion
      // without changing it, so two constraints differing only there
      // are duplicates and the widened key must not start keeping them.
      const input = makeResponse({
        object_types: [
          { name: "Customer", kind: "entity", source_references: REF },
          { name: "Order", kind: "entity", source_references: REF },
        ],
        inferred_constraints: [
          {
            type: "frequency",
            fact_type: "Customer places Order",
            roles: ["Customer"],
            description: "A Customer places at least one Order",
            confidence: "high",
            min: 1,
            max: "unbounded",
            source_references: REF,
          },
          {
            type: "frequency",
            fact_type: "Customer places Order",
            roles: ["Customer"],
            description: "Restated: every Customer has an Order",
            confidence: "low",
            min: 1,
            max: "unbounded",
            source_references: REF,
          },
        ],
      });

      const { response, corrections } = enforceConformance(input);
      expect(response.inferred_constraints).toHaveLength(1);
      expect(response.inferred_constraints[0]!.confidence).toBe("high");
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
