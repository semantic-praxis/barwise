/**
 * Tests for the gym_list / gym_check tools.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeGymCheck, executeGymList } from "../../src/tools/gym.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const referenceModel = resolve(
  __dirname,
  "../../../learn/exercises/customer-order.reference.orm.yaml",
);
const unconstrainedCandidate = resolve(
  __dirname,
  "../../../cli/tests/fixtures/gym/unconstrained-candidate.orm.yaml",
);

describe("gym_list tool", () => {
  it("returns the catalog with C1 front matter", () => {
    const result = executeGymList();
    const parsed = JSON.parse(result.content[0]!.text) as Array<{
      id: string;
      transition: { from: string; to: string; };
      exitPerformance: string;
    }>;
    const seed = parsed.find((e) => e.id === "customer-order");
    expect(seed).toBeDefined();
    expect(seed!.transition).toEqual({ from: "novice", to: "initiate" });
    expect(seed!.exitPerformance.length).toBeGreaterThan(0);
  });
});

describe("gym_check tool", () => {
  it("passes the reference model", () => {
    const result = executeGymCheck("customer-order", referenceModel);
    const parsed = JSON.parse(result.content[0]!.text) as {
      passed: boolean;
      missCardFile?: string;
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.missCardFile).toBeUndefined();
  });

  it("fails the unconstrained candidate and includes the miss-card file", () => {
    const result = executeGymCheck("customer-order", unconstrainedCandidate);
    const parsed = JSON.parse(result.content[0]!.text) as {
      passed: boolean;
      results: Array<{ kind: string; passed: boolean; }>;
      missCardFile?: string;
    };
    expect(parsed.passed).toBe(false);
    expect(parsed.results.some((r) => r.kind === "forbids_population" && !r.passed)).toBe(true);
    expect(parsed.missCardFile).toContain("#deck:ORM 2::Misses");
  });

  it("reports an unknown exercise id as an error payload", () => {
    const result = executeGymCheck("no-such", referenceModel);
    const parsed = JSON.parse(result.content[0]!.text) as { error: string; };
    expect(parsed.error).toContain("no-such");
  });
});
