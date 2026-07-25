/**
 * Tests for the tutorial renderer: determinism, the generated-motivation
 * honesty checks, and the rendered structure over the worked tutorial.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTutorial } from "../../src/tutorial/loadTutorial.js";
import { renderTutorial, TutorialRenderError } from "../../src/tutorial/renderTutorial.js";
import type { LoadedTutorial } from "../../src/tutorial/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKED = resolve(
  __dirname,
  "../../tutorials/order-fulfillment/order-fulfillment.tutorial.yaml",
);

function loadWorked(): LoadedTutorial {
  return loadTutorial(WORKED);
}

describe("renderTutorial over the worked tutorial", () => {
  const markdown = renderTutorial(loadWorked(), { toolVersion: "0.0.0-test" });

  it("is deterministic: same input, byte-identical output", () => {
    const again = renderTutorial(loadWorked(), { toolVersion: "0.0.0-test" });
    expect(again).toBe(markdown);
  });

  it("renders motivation before concept in every step", () => {
    for (const section of markdown.split("\n## ").slice(1, -1)) {
      const problem = section.indexOf("### The problem");
      const concept = section.indexOf("### The concept");
      expect(problem).toBeGreaterThanOrEqual(0);
      expect(concept).toBeGreaterThan(problem);
    }
  });

  it("marks generated motivations and quotes the derived population", () => {
    expect(markdown).toContain("*(motivation generated from the model)*");
    expect(markdown).toContain("Rules out: two facts of Customer places Order");
  });

  it("carries the C1 front matter and the deck/gym callouts", () => {
    expect(markdown).toContain("**Serves the transition:** naive to initiate.");
    expect(markdown).toContain("Drill this: deck subdeck `ORM 2::Constraints I`.");
    expect(markdown).toContain("Practice this: gym exercise `customer-order`.");
  });
});

describe("renderTutorial honesty checks", () => {
  it("fails when a step's named constraint is missing from its snapshot", () => {
    const tutorial = loadWorked();
    const broken: LoadedTutorial = {
      ...tutorial,
      steps: tutorial.steps.map((s) =>
        s.motivation.kind === "counterexample"
          ? { ...s, motivation: { kind: "counterexample", constraintId: "c-nope" } }
          : s
      ),
    };
    expect(() => renderTutorial(broken, { toolVersion: "0.0.0-test" })).toThrow(
      TutorialRenderError,
    );
  });

  it("fails when the named constraint already exists in the prior step", () => {
    const tutorial = loadWorked();
    // Point a counterexample step at a constraint its predecessor already
    // carries: the uniqueness added in step 3 is present in step 4's prior.
    const steps = tutorial.steps.map((s) =>
      s.id === "uc-spanning"
        ? {
          ...s,
          motivation: { kind: "counterexample", constraintId: "c-uc-places-order" } as const,
        }
        : s
    );
    expect(() => renderTutorial({ ...tutorial, steps }, { toolVersion: "0.0.0-test" }))
      .toThrow(/already exists in the prior/);
  });
});
