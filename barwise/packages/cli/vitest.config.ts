import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("cli", {
  coverage: { kind: "whole-src" },
  thresholds: { statements: 60, branches: 78, functions: 88, lines: 60 },
}));
