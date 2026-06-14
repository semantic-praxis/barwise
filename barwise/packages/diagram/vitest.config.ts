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
      // Floors calibrated to actual coverage with headroom for v8's
      // run-to-run branch variance (CI measured 81.7%, local 82.6% -- the
      // old 82 floor was too tight). Statements/lines are capped by
      // ElkLayoutEngine (the A1 decomposition target); the well-covered
      // SvgRenderer's coverage moved to @barwise/diagram-ui in the
      // renderer-consolidation spec. Raising ElkLayoutEngine coverage and
      // tightening these back up is follow-up work.
      thresholds: {
        statements: 76,
        branches: 80,
        functions: 88,
        lines: 76,
      },
    },
  },
});
