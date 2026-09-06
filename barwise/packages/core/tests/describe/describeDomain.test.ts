/**
 * Tests for describeDomain functionality.
 *
 * Verifies that domain descriptions correctly filter and summarize
 * models based on focus parameters.
 */

import { describe, expect, it } from "vitest";
import { describeDomain } from "../../src/describe/describeDomain.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("describeDomain", () => {
  describe("full model summary (no focus)", () => {
    it("returns summary with all entities, fact types, and constraints", () => {
      const model = new ModelBuilder("Clinic")
        .withEntityType("Patient", {
          definition: "A person receiving medical treatment",
          referenceMode: "patient_id",
        })
        .withEntityType("Doctor", { referenceMode: "doctor_id" })
        .withEntityType("Appointment", { referenceMode: "appt_number" })
        .withBinaryFactType("Patient has Appointment", {
          role1: { player: "Patient", name: "has" },
          role2: { player: "Appointment", name: "is for" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .withBinaryFactType("Doctor schedules Appointment", {
          role1: { player: "Doctor", name: "schedules" },
          role2: { player: "Appointment", name: "is scheduled by" },
          uniqueness: "role2",
        })
        .build();

      const description = describeDomain(model);

      // Check summary includes key counts.
      expect(description.summary).toContain("Clinic");
      expect(description.summary).toContain("Entities: 3");
      expect(description.summary).toContain("Fact Types: 2");

      // Check entity summaries.
      expect(description.entityTypes).toHaveLength(3);
      const patientSummary = description.entityTypes.find(
        (e) => e.name === "Patient",
      );
      expect(patientSummary).toBeDefined();
      expect(patientSummary?.definition).toBe(
        "A person receiving medical treatment",
      );
      expect(patientSummary?.referenceMode).toBe("patient_id");
      expect(patientSummary?.kind).toBe("entity");

      // Check fact type summaries.
      expect(description.factTypes).toHaveLength(2);
      const apptFt = description.factTypes.find((ft) => ft.name.includes("has Appointment"));
      expect(apptFt).toBeDefined();
      expect(apptFt?.arity).toBe(2);
      expect(apptFt?.involvedEntities).toContain("Patient");
      expect(apptFt?.involvedEntities).toContain("Appointment");

      // Check constraints (uniqueness + mandatory = 2 for first fact type).
      expect(description.constraints.length).toBeGreaterThanOrEqual(2);
    });

    it("includes populations when present", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .withEntityType("Order", { referenceMode: "order_num" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .withPopulation(
          "Customer places Order",
          [
            { roleValues: { "0": "C001", "1": "O123" } },
            { roleValues: { "0": "C001", "1": "O124" } },
          ],
          "Sample orders",
        )
        .build();

      const description = describeDomain(model, { includePopulations: true });

      expect(description.populations).toBeDefined();
      expect(description.populations).toHaveLength(1);
      expect(description.populations![0]!.factTypeName).toContain(
        "places Order",
      );
      expect(description.populations![0]!.instanceCount).toBe(2);
    });

    it("excludes populations when includePopulations is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .withEntityType("Order", { referenceMode: "order_num" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .withPopulation("Customer places Order", [
          { roleValues: { "0": "C001", "1": "O123" } },
        ])
        .build();

      const description = describeDomain(model, {
        includePopulations: false,
      });

      expect(description.populations).toBeUndefined();
    });
  });

  describe("entity focus", () => {
    it("omits populations when includePopulations is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "cust_id" })
        .withEntityType("Order", { referenceMode: "order_num" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .withPopulation("Customer places Order", [
          { roleValues: { "0": "C001", "1": "O123" } },
        ])
        .build();

      const description = describeDomain(model, {
        focus: "Customer",
        includePopulations: false,
      });

      expect(description.populations).toBeUndefined();
    });

    it("returns only the focused entity and related fact types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Patient", { definition: "A person" })
        .withEntityType("Doctor", { definition: "A physician" })
        .withEntityType("Appointment", {})
        .withBinaryFactType("Patient has Appointment", {
          role1: { player: "Patient", name: "has" },
          role2: { player: "Appointment", name: "is for" },
          uniqueness: "role2",
        })
        .withBinaryFactType("Doctor schedules Appointment", {
          role1: { player: "Doctor", name: "schedules" },
          role2: { player: "Appointment", name: "is scheduled by" },
          uniqueness: "role2",
        })
        .build();

      const description = describeDomain(model, { focus: "Patient" });

      // Should return only Patient entity.
      expect(description.entityTypes).toHaveLength(1);
      expect(description.entityTypes[0]!.name).toBe("Patient");

      // Should return only fact types involving Patient.
      expect(description.factTypes).toHaveLength(1);
      expect(description.factTypes[0]!.name).toContain("Patient");

      // Summary should mention the entity.
      expect(description.summary).toContain("Patient");
    });

    it("is case-insensitive", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .withEntityType("Order", {})
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const description = describeDomain(model, { focus: "customer" });

      expect(description.entityTypes).toHaveLength(1);
      expect(description.entityTypes[0]!.name).toBe("Customer");
    });
  });

  describe("fact type focus", () => {
    it("omits populations when includePopulations is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .withEntityType("Order", {})
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .withPopulation("Customer places Order", [
          { roleValues: { "0": "C001", "1": "O123" } },
        ])
        .build();

      const description = describeDomain(model, {
        focus: "Customer places Order",
        includePopulations: false,
      });

      expect(description.populations).toBeUndefined();
    });

    it("returns the focused fact type and involved entities", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Patient", {})
        .withEntityType("Doctor", {})
        .withEntityType("Appointment", {})
        .withBinaryFactType("Patient has Appointment", {
          role1: { player: "Patient", name: "has" },
          role2: { player: "Appointment", name: "is for" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .withBinaryFactType("Doctor schedules Appointment", {
          role1: { player: "Doctor", name: "schedules" },
          role2: { player: "Appointment", name: "is scheduled by" },
          uniqueness: "role2",
        })
        .build();

      const description = describeDomain(model, {
        focus: "Patient has Appointment",
      });

      // Should return only the focused fact type.
      expect(description.factTypes).toHaveLength(1);
      expect(description.factTypes[0]!.name).toContain("Patient has");

      // Should return the involved entities.
      expect(description.entityTypes.length).toBeGreaterThanOrEqual(2);
      const entityNames = description.entityTypes.map((e) => e.name);
      expect(entityNames).toContain("Patient");
      expect(entityNames).toContain("Appointment");
    });
  });

  describe("constraint type focus", () => {
    it("returns all constraints of the specified type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .withEntityType("Order", {})
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const description = describeDomain(model, { focus: "mandatory" });

      // Should return only mandatory constraints.
      expect(description.constraints.length).toBeGreaterThanOrEqual(1);
      for (const c of description.constraints) {
        // Mandatory constraints verbalize as "at least one" or "exactly one"
        expect(c.verbalization.toLowerCase()).toMatch(/at least one|exactly one/);
      }
    });

    it("omits populations when includePopulations is false", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .withEntityType("Order", {})
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .withPopulation("Customer places Order", [
          { roleValues: { "0": "C001", "1": "O123" } },
        ])
        .build();

      const description = describeDomain(model, {
        focus: "mandatory",
        includePopulations: false,
      });

      expect(description.populations).toBeUndefined();
    });

    it("lists a fact type only once when more than one of its constraints matches", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .withEntityType("Order", {})
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          // Both roles mandatory: two matching constraints on one fact type.
          mandatory: "both",
        })
        .build();

      const description = describeDomain(model, { focus: "mandatory" });

      expect(description.constraints).toHaveLength(2);
      expect(description.factTypes).toHaveLength(1);
    });

    it("returns empty arrays for unknown constraint types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .withEntityType("Order", {})
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      // Focus on a constraint type that doesn't exist in the model.
      const description = describeDomain(model, { focus: "frequency" });

      expect(description.constraints).toHaveLength(0);
      expect(description.factTypes).toHaveLength(0);
    });
  });

  describe("unknown focus", () => {
    it("returns empty description with message", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", {})
        .build();

      const description = describeDomain(model, {
        focus: "NonexistentEntity",
      });

      expect(description.summary).toContain("No matching");
      expect(description.summary).toContain("NonexistentEntity");
      expect(description.entityTypes).toHaveLength(0);
      expect(description.factTypes).toHaveLength(0);
      expect(description.constraints).toHaveLength(0);
    });
  });
});
