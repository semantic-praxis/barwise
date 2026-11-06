/**
 * Tests for the pure schema-version helpers: version comparison, the
 * migration planner, and migration application. The serializer wires
 * these together; here they are exercised directly with synthetic
 * versions and migrations so the seam is covered without registering a
 * real migration.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  compareOrmVersions,
  CURRENT_MAJOR_FIRST_VERSION,
  CURRENT_ORM_VERSION,
  LEGACY_ORM_VERSION,
  majorFirst,
  ORM_VERSION_MIGRATIONS,
  type OrmVersionMigration,
  planMigration,
  planRead,
  PREVIOUS_ORM_VERSION,
  type ReadVersions,
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

// A build one minor past its major's first version, as the first minor
// bump after 3.0 will be: barwise-jj8 was that every 3.0 file would then
// be refused as a version no release wrote.
const AT_3_1: ReadVersions = {
  current: "3.1",
  legacy: ["2.0"],
  migrations: [bump("1.0", "1.1"), bump("1.1", "2.0"), bump("3.0", "3.1")],
};

describe("planRead", () => {
  it("brings a file of an earlier minor of the current major forward to the current reader", () => {
    expect(planRead("3.0", AT_3_1)).toEqual({
      ok: true,
      reader: "current",
      target: "3.1",
      steps: [AT_3_1.migrations[2]],
    });
  });

  it("reads the current version with no steps", () => {
    expect(planRead("3.1", AT_3_1)).toEqual({
      ok: true,
      reader: "current",
      target: "3.1",
      steps: [],
    });
  });

  it("calls a current-major version a step names, but whose chain stops short, a bug in barwise", () => {
    const gap = { ...AT_3_1, current: "3.2", migrations: [bump("3.0", "3.1")] };
    expect(planRead("3.0", gap)).toEqual({ ok: false, reason: "unregistered" });
  });

  it("calls a 3.1 build that forgot its 3.0 step a bug in barwise", () => {
    expect(planRead("3.0", { ...AT_3_1, migrations: AT_3_1.migrations.slice(0, 2) })).toEqual({
      ok: false,
      reason: "unregistered",
    });
  });

  it("keeps a malformed current-major version unknown, not a bug", () => {
    expect(planRead("3.0.5", AT_3_1)).toEqual({ ok: false, reason: "unknown" });
  });

  it("reads the previous major with the legacy reader, older files migrated to it", () => {
    expect(planRead("2.0", AT_3_1)).toEqual({
      ok: true,
      reader: "legacy",
      target: "2.0",
      steps: [],
    });
    expect(planRead("1.0", AT_3_1)).toEqual({
      ok: true,
      reader: "legacy",
      target: "2.0",
      steps: AT_3_1.migrations.slice(0, 2),
    });
  });

  it("refuses a version between the two majors, which no release wrote", () => {
    expect(planRead("2.1", AT_3_1)).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses a newer version as newer", () => {
    expect(planRead("3.2", AT_3_1)).toEqual({ ok: false, reason: "newer" });
  });
});

describe("this build's versions", () => {
  it("put the current major's first version in the current version's major, above the legacy one", () => {
    expect(CURRENT_MAJOR_FIRST_VERSION).toBe(majorFirst(CURRENT_ORM_VERSION));
    expect(compareOrmVersions(CURRENT_MAJOR_FIRST_VERSION, CURRENT_ORM_VERSION))
      .toBeLessThanOrEqual(0);
    expect(compareOrmVersions(CURRENT_MAJOR_FIRST_VERSION, LEGACY_ORM_VERSION)).toBeGreaterThan(0);
  });

  it("reach the current version from its major's first through registered steps [adr:schema-versioning#minor-and-major]", () => {
    // Fails when a minor bump forgets its step: the earlier minor would be
    // refused. A step that skips a minor (3.0 to 3.2) passes here; the
    // shape test below is what refuses it.
    expect(planRead(CURRENT_MAJOR_FIRST_VERSION)).toMatchObject({ ok: true, reader: "current" });
    expect(planRead(CURRENT_ORM_VERSION)).toEqual({
      ok: true,
      reader: "current",
      target: CURRENT_ORM_VERSION,
      steps: [],
    });
  });

  it("read each earlier major with its own legacy reader, and nothing between them", () => {
    // Two legacy slots since 4.0 (iri-identity WS6): 3.0 by the frozen 3.0
    // decoders, 2.0 and older by the 2.0 reader, both then replayed.
    expect(planRead(PREVIOUS_ORM_VERSION)).toEqual({
      ok: true,
      reader: "legacy",
      target: PREVIOUS_ORM_VERSION,
      steps: [],
    });
    expect(planRead(LEGACY_ORM_VERSION)).toEqual({
      ok: true,
      reader: "legacy",
      target: LEGACY_ORM_VERSION,
      steps: [],
    });
    expect(planRead("1.0")).toMatchObject({ ok: true, reader: "legacy", target: "2.0" });
    expect(planRead("3.1")).toEqual({ ok: false, reason: "unknown" });
    expect(planRead("2.5")).toEqual({ ok: false, reason: "unknown" });
  });
});

/** `"3.1"` as `[3, 1]`, or undefined when it is not major.minor. */
function parts(version: string): [number, number] | undefined {
  const m = /^(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/**
 * Steps that are neither a minor step (same major, the next minor) nor a
 * major step (the next major's first version), each named. ADR
 * `schema-versioning` decision 2.
 */
function stepShapeProblems(migrations: readonly OrmVersionMigration[]): string[] {
  const problems: string[] = [];
  for (const { from, to } of migrations) {
    const f = parts(from);
    const t = parts(to);
    const minor = f && t && t[0] === f[0] && t[1] === f[1] + 1;
    const major = f && t && t[0] === f[0] + 1 && t[1] === 0;
    if (!minor && !major) problems.push(`${from} -> ${to} is neither a minor nor a major step`);
  }
  return problems;
}

/**
 * Where the steps fail to form one path: a version that is the `from` of
 * more than one step (`planMigration` takes the first and ignores the
 * rest), or a major step that leaves a minor which is not its major's last
 * -- a later minor some step or `current` names would be stranded.
 */
function chainProblems(migrations: readonly OrmVersionMigration[], current: string): string[] {
  const problems: string[] = [];
  const froms = new Map<string, number>();
  for (const { from } of migrations) froms.set(from, (froms.get(from) ?? 0) + 1);
  for (const [from, count] of froms) {
    if (count > 1) problems.push(`${count} steps leave ${from}`);
  }
  const named = [current, ...migrations.flatMap((m) => [m.from, m.to])];
  for (const { from, to } of migrations) {
    const f = parts(from);
    const t = parts(to);
    if (!f || !t || t[0] === f[0]) continue;
    const later = named.filter((v) => {
      const p = parts(v);
      return p !== undefined && p[0] === f[0] && p[1] > f[1];
    });
    if (later.length > 0) {
      problems.push(`major step ${from} -> ${to} leaves ${from} while ${later[0]} exists`);
    }
  }
  return problems;
}

describe("the migration registry's shape (ADR schema-versioning decision 2)", () => {
  // The checks run on the real registry below; these synthetic registries
  // show each one can fail, so a check that returned [] for everything
  // would not pass here.
  it("names a step that skips a minor, and a major step that lands past the next major's first", () => {
    expect(stepShapeProblems([bump("3.0", "3.2"), bump("1.1", "2.1"), bump("1.0", "3.0")]))
      .toEqual([
        "3.0 -> 3.2 is neither a minor nor a major step",
        "1.1 -> 2.1 is neither a minor nor a major step",
        "1.0 -> 3.0 is neither a minor nor a major step",
      ]);
    expect(stepShapeProblems([bump("1.0", "1.1"), bump("1.1", "2.0")])).toEqual([]);
  });

  it("names two steps from one version, and a major step that leaves a minor before its major's last", () => {
    expect(chainProblems([bump("1.0", "1.1"), bump("1.0", "2.0")], "2.0")).toEqual([
      "2 steps leave 1.0",
      "major step 1.0 -> 2.0 leaves 1.0 while 1.1 exists",
    ]);
    // The current version counts as named: a 3.0 -> 4.0 step in a 3.1 build
    // would strand every 3.1 file.
    expect(chainProblems([bump("3.0", "4.0")], "3.1")).toEqual([
      "major step 3.0 -> 4.0 leaves 3.0 while 3.1 exists",
    ]);
    expect(chainProblems([bump("1.0", "1.1"), bump("1.1", "2.0")], "4.0")).toEqual([]);
  });

  it("holds every registered step to a minor or major step [adr:schema-versioning#minor-and-major]", () => {
    expect(stepShapeProblems(ORM_VERSION_MIGRATIONS)).toEqual([]);
  });

  it("holds the registered steps to one path, each major step leaving its major's last minor [adr:schema-versioning#minor-and-major]", () => {
    expect(chainProblems(ORM_VERSION_MIGRATIONS, CURRENT_ORM_VERSION)).toEqual([]);
  });

  it("pins the schema's orm_version const to CURRENT_ORM_VERSION [adr:schema-versioning#minor-and-major]", () => {
    // Read directly rather than through a load, so a mismatch is named as
    // one rather than surfacing as a decoder refusal of every current file.
    const schema = JSON.parse(
      readFileSync(new URL("../../schemas/orm-model.schema.json", import.meta.url), "utf8"),
    ) as { properties: { orm_version: { const: string; }; }; };
    expect(schema.properties.orm_version.const).toBe(CURRENT_ORM_VERSION);
  });
});
