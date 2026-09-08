import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("promptlab", {
  coverage: { kind: "whole-src" },
  // Floors sit just under measured coverage (90.7/87.2/100/90.7)
  // so a real regression fails without making every edit a chore.
  thresholds: { statements: 85, branches: 82, functions: 95, lines: 85 },
}));
