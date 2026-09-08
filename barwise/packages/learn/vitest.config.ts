import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("learn", {
  coverage: { kind: "whole-src" },
  thresholds: { statements: 80, branches: 74, functions: 90, lines: 80 },
}));
