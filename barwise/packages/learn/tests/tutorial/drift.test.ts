/**
 * Drift test (modeling-tutorial spec, WS1): the committed rendered
 * tutorial under docs/tutorial/ must match a fresh render of its
 * source, exactly as examples/output/ is guarded. Regenerate
 * intentionally with `npm run regen:tutorial` and review the diff.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTutorial } from "../../src/tutorial/loadTutorial.js";
import { renderTutorial } from "../../src/tutorial/renderTutorial.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const learnRoot = resolve(__dirname, "../..");
const repoRoot = resolve(learnRoot, "../..");

describe("committed tutorial drift", () => {
  it("docs/tutorial/order-fulfillment.md matches a fresh render", () => {
    const { version } = JSON.parse(
      readFileSync(resolve(learnRoot, "package.json"), "utf-8"),
    ) as { version: string; };

    const tutorial = loadTutorial(
      resolve(learnRoot, "tutorials/order-fulfillment/order-fulfillment.tutorial.yaml"),
    );
    const fresh = renderTutorial(tutorial, { toolVersion: version });
    const committed = readFileSync(
      resolve(repoRoot, "docs/tutorial/order-fulfillment.md"),
      "utf-8",
    );
    expect(committed).toBe(fresh);
  });
});
