import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("diagram-ui", {
  testInclude: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  coverage: {
    // The render components (including the extracted parts/) and the
    // headless renderer; the barrels (index.ts, server.ts) carry no logic.
    kind: "named-files",
    include: [
      "src/DiagramCanvas.tsx",
      "src/OrmDiagram.tsx",
      "src/renderDiagramSvg.tsx",
      "src/quantize.ts",
      "src/parts/*.tsx",
      "src/parts/*.ts",
    ],
  },
  thresholds: { statements: 70, branches: 60, functions: 78, lines: 70 },
}));
