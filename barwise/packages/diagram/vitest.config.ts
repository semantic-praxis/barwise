import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Exclude type-only modules: the barrel and the pure type/interface
      // files (no runtime code), which otherwise report as 0% and distort
      // the metric for testable code.
      exclude: [
        "src/index.ts",
        "src/graph/GraphTypes.ts",
        "src/layout/LayoutTypes.ts",
        "src/session/contract.ts",
      ],
      // Floors calibrated to actual coverage. Statements/lines are capped
      // by ElkLayoutEngine (the A1 decomposition target) and dropped when
      // the well-covered SvgRenderer moved to @barwise/diagram-ui (the
      // renderer-consolidation spec) -- its coverage now lives there
      // (renderDiagramSvg.test). Raising ElkLayoutEngine coverage is
      // follow-up work.
      thresholds: {
        statements: 76,
        branches: 82,
        functions: 90,
        lines: 76,
      },
    },
  },
});
