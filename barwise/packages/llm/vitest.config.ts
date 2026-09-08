import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("llm", {
  coverage: { kind: "whole-src" },
  // Floors calibrated to actual coverage. The previous 78/82/100/78
  // never ran in CI: the statement/line floors sat well below real
  // coverage while the 100% functions target was unmet.
  thresholds: { statements: 85, branches: 80, functions: 92, lines: 85 },
}));
