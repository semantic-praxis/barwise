/**
 * Tests for the tutorial parser: shape validation and step-graph
 * referential integrity.
 */
import { describe, expect, it } from "vitest";
import { parseTutorial, TutorialParseError } from "../../src/tutorial/parseTutorial.js";

function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t",
    title: "T",
    transition: { from: "naive", to: "novice" },
    exitPerformance: "can do the thing",
    intro: "intro",
    steps: [
      {
        id: "s1",
        csdpStep: 1,
        title: "S1",
        model: "models/s1.orm.yaml",
        motivation: { kind: "prose", text: "why" },
        concept: "what",
        buildsOn: [],
        unlocks: [],
      },
    ],
    ...overrides,
  };
}

describe("parseTutorial", () => {
  it("parses a minimal tutorial", () => {
    const t = parseTutorial(minimal());
    expect(t.id).toBe("t");
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]!.motivation.kind).toBe("prose");
  });

  it("rejects an out-of-range csdpStep", () => {
    const bad = minimal();
    (bad["steps"] as Record<string, unknown>[])[0]!["csdpStep"] = 8;
    expect(() => parseTutorial(bad)).toThrow(TutorialParseError);
  });

  it("rejects an unknown motivation kind", () => {
    const bad = minimal();
    (bad["steps"] as Record<string, unknown>[])[0]!["motivation"] = { kind: "video" };
    expect(() => parseTutorial(bad)).toThrow(/motivation kind/);
  });

  it("requires constraintId for counterexample motivations", () => {
    const bad = minimal();
    (bad["steps"] as Record<string, unknown>[])[0]!["motivation"] = { kind: "counterexample" };
    expect(() => parseTutorial(bad)).toThrow(/constraintId/);
  });

  it("rejects duplicate step ids", () => {
    const t = minimal();
    const step = (t["steps"] as Record<string, unknown>[])[0]!;
    (t["steps"] as unknown[]).push({ ...step });
    expect(() => parseTutorial(t)).toThrow(/duplicate step id/);
  });

  it("rejects links to unknown steps", () => {
    const t = minimal();
    (t["steps"] as Record<string, unknown>[])[0]!["unlocks"] = ["nope"];
    expect(() => parseTutorial(t)).toThrow(/unknown step "nope"/);
  });

  it("requires the C1 front matter", () => {
    expect(() => parseTutorial(minimal({ transition: undefined }))).toThrow(/transition/);
    expect(() => parseTutorial(minimal({ exitPerformance: undefined }))).toThrow(
      /exitPerformance/,
    );
  });
});
