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
      // run-to-run branch variance (CI runs ~1% below local). Local
      // coverage after the ElkLayoutEngine decomposition (A1) is ~84%
      // statements / ~85% branches / ~90% functions: the orchestrator and
      // the extracted pure units (ClusterDetection, EdgeRouting,
      // CollisionResolver) are well covered. The remaining cap is the
      // two-level cluster-layout path in EntityPlacement.ts, which the
      // mocked-ELK tests do not exercise; adding focused tests for it and
      // tightening these further is follow-up work.
      thresholds: {
        statements: 82,
        branches: 82,
        functions: 88,
        lines: 82,
      },
    },
  },
});
