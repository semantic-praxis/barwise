import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      // The render components (including the extracted parts/) and the
      // headless renderer; the barrels (index.ts, server.ts) carry no logic.
      include: [
        "src/DiagramCanvas.tsx",
        "src/OrmDiagram.tsx",
        "src/renderDiagramSvg.tsx",
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
