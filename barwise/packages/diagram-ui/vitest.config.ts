import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      // The headless render surface is covered now; the interactive
      // DiagramCanvas is exercised by the integration suite and gets unit
      // tests in workstream 4.
      include: ["src/OrmDiagram.tsx", "src/renderDiagramSvg.tsx"],
      thresholds: {
        statements: 78,
        branches: 50,
        functions: 95,
        lines: 78,
      },
    },
  },
});
