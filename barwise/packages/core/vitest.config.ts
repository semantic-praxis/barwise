import { defineConfig } from "vitest/config";
import { barwiseVitestConfig } from "../../vitest.shared.js";

export default defineConfig(barwiseVitestConfig("core", {
  coverage: { kind: "whole-src" },
  thresholds: { statements: 90, branches: 84, functions: 90, lines: 90 },
}));
