import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Real-ELK layout of the corpus models can blow the 5s default on a
    // loaded CI runner under coverage instrumentation.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      // The render components (including the extracted parts/) and the
      // headless renderer; the barrels (index.ts, server.ts) carry no logic.
      include: [
        "src/DiagramCanvas.tsx",
        "src/OrmDiagram.tsx",
        "src/renderDiagramSvg.tsx",
        "src/quantize.ts",
        "src/parts/*.tsx",
        "src/parts/*.ts",
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 78,
        lines: 70,
      },
    },
  },
});
