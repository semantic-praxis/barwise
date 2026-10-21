/**
 * Tests for the pure schema-version helpers: version comparison, the
 * migration planner, and migration application. The serializer wires
 * these together; here they are exercised directly with synthetic
 * versions and migrations so the seam is covered without registering a
 * real migration.
 */
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  compareOrmVersions,
  CURRENT_ORM_VERSION,
  LEGACY_ORM_VERSION,
  type OrmVersionMigration,
  planMigration,
} from "../../src/serialization/schemaVersion.js";

describe("compareOrmVersions", () => {
  it("treats equal versions as equal", () => {
    expect(compareOrmVersions("1.0", "1.0")).toBe(0);
  });

  it("orders by numeric component, not lexical", () => {
    expect(compareOrmVersions("1.0", "2.0")).toBeLessThan(0);
    expect(compareOrmVersions("2.0", "1.0")).toBeGreaterThan(0);
    // "1.10" is newer than "1.9" numerically, even though it sorts
    // earlier as a string.
    expect(compareOrmVersions("1.9", "1.10")).toBeLessThan(0);
  });

  it("pads missing components with zero", () => {
    expect(compareOrmVersions("1", "1.0")).toBe(0);
    expect(compareOrmVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });

  it("falls back to string comparison for non-numeric versions", () => {
    expect(compareOrmVersions("alpha", "alpha")).toBe(0);
    expect(compareOrmVersions("alpha", "beta")).toBeLessThan(0);
  });
});

/** A migration that stamps its `to` version and records that it ran. */
function bump(from: string, to: string): OrmVersionMigration {
  return {
    from,
    to,
    migrate: (doc) => ({ ...doc, orm_version: to, [`migrated_${from}_${to}`]: true }),
  };
}

describe("planMigration", () => {
  it("returns no steps when already at the current version", () => {
    const plan = planMigration("1.0", "1.0", []);
    expect(plan).toEqual({ ok: true, steps: [] });
  });

  it("reports a newer document as such", () => {
    const plan = planMigration("2.0", "1.0", []);
    expect(plan).toEqual({ ok: false, reason: "newer" });
  });

  it("reports an older version with no migration path as unknown", () => {
    const plan = planMigration("0.9", "1.0", []);
    expect(plan).toEqual({ ok: false, reason: "unknown" });
  });

  it("plans a single-step migration", () => {
    const plan = planMigration("0.9", "1.0", [bump("0.9", "1.0")]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.steps.map((s) => `${s.from}->${s.to}`)).toEqual(["0.9->1.0"]);
  });

  it("chains multi-step migrations in order", () => {
    const plan = planMigration("0.8", "1.0", [bump("0.9", "1.0"), bump("0.8", "0.9")]);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.steps.map((s) => `${s.from}->${s.to}`)).toEqual(["0.8->0.9", "0.9->1.0"]);
    }
  });

  it("detects a cycle in the registry", () => {
    const plan = planMigration("0.9", "1.0", [bump("0.9", "0.9")]);
    expect(plan).toEqual({ ok: false, reason: "cycle" });
  });
});

describe("applyMigrations", () => {
  it("folds steps over the document in order", () => {
    const steps = [bump("0.8", "0.9"), bump("0.9", "1.0")];
    const result = applyMigrations({ orm_version: "0.8", model: { name: "T" } }, steps);
    expect(result.orm_version).toBe("1.0");
    expect(result["migrated_0.8_0.9"]).toBe(true);
    expect(result["migrated_0.9_1.0"]).toBe(true);
  });

  it("returns the document untouched when there are no steps", () => {
    const doc = { orm_version: "1.0", model: { name: "T" } };
    expect(applyMigrations(doc, [])).toBe(doc);
  });
});

describe("the registered migrations", () => {
  it("reach 2.0 from 1.0, the last version a raw-document step reaches", () => {
    const fromOld = planMigration("1.0", LEGACY_ORM_VERSION);
    expect(fromOld.ok && fromOld.steps.at(-1)?.to).toBe(LEGACY_ORM_VERSION);
  });

  it("have no step to the current version, which only the model reaches", () => {
    expect(planMigration(LEGACY_ORM_VERSION, CURRENT_ORM_VERSION)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});
