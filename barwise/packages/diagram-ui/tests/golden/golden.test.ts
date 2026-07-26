/**
 * Golden-file regression guard for the rendered diagram SVG -- the T5
 * deliverable of the diagram-layout-aesthetics spec (workstream 1).
 *
 * Each corpus model is laid out with real ELK and rendered headlessly;
 * the result must byte-match the checked-in golden. Quantization to
 * integer pixels (src/quantize.ts) is what makes byte-equality sound:
 * sub-pixel floating-point noise rounds away, so the goldens are
 * platform-robust. Canonical goldens are generated on the CI ubuntu
 * runner; regenerate intentionally with:
 *
 *   UPDATE_GOLDEN=1 npx vitest run tests/golden
 *
 * and review the diff as a visual change (open before/after in a
 * browser). The corpus pairs the two real example models with three
 * small fixtures that each isolate one placement lever, so a golden
 * diff points at the lever that moved.
 */
import { generateDiagram } from "@barwise/diagram";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../../core/src/index.js";
import { renderDiagramSvg } from "../../src/renderDiagramSvg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../../examples/models");
const FIXTURES = resolve(__dirname, "fixtures");
const GOLDENS = resolve(__dirname, "goldens");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

const CORPUS: ReadonlyArray<{ name: string; path: string; }> = [
  { name: "diagram-layout", path: resolve(EXAMPLES, "diagram-layout.orm.yaml") },
  { name: "learning-design", path: resolve(EXAMPLES, "learning-design.orm.yaml") },
  { name: "subtype-fan", path: resolve(FIXTURES, "subtype-fan.orm.yaml") },
  { name: "value-hub", path: resolve(FIXTURES, "value-hub.orm.yaml") },
  { name: "cluster-split", path: resolve(FIXTURES, "cluster-split.orm.yaml") },
];

const serializer = new OrmYamlSerializer();

async function renderCorpusModel(path: string): Promise<string> {
  const model = serializer.deserialize(readFileSync(path, "utf-8"));
  const { layout } = await generateDiagram(model);
  return renderDiagramSvg(layout);
}

describe("diagram SVG golden files", () => {
  for (const entry of CORPUS) {
    // Real ELK over the larger corpus models can exceed vitest's 5s
    // default on a loaded CI runner under coverage instrumentation.
    it(`matches the golden for ${entry.name}`, { timeout: 30_000 }, async () => {
      const svg = await renderCorpusModel(entry.path);
      const goldenPath = resolve(GOLDENS, `${entry.name}.svg`);

      if (UPDATE) {
        mkdirSync(GOLDENS, { recursive: true });
        writeFileSync(goldenPath, svg, "utf-8");
        return;
      }

      expect(
        existsSync(goldenPath),
        `missing golden ${goldenPath}; generate with UPDATE_GOLDEN=1`,
      ).toBe(true);
      expect(svg).toBe(readFileSync(goldenPath, "utf-8"));
    });
  }

  it("renders are deterministic run-to-run", { timeout: 30_000 }, async () => {
    const first = await renderCorpusModel(CORPUS[2]!.path);
    const second = await renderCorpusModel(CORPUS[2]!.path);
    expect(second).toBe(first);
  });
});
