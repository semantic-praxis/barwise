import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("mcp", {
  coverage: { kind: "whole-src" },
  thresholds: { statements: 75, branches: 82, functions: 88, lines: 75 },
}));
