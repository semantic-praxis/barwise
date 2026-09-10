/**
 * A standalone vitest config for mutation runs.
 *
 * Deliberately does NOT import `../../vitest.shared.js`. Stryker
 * sandboxes the working directory and runs the suite inside the copy, so
 * a config reaching one level up cannot resolve there -- the shared
 * config's own header explains why it lives at the root, and that reason
 * is unaffected. This restates only the two settings a mutation run
 * needs (which tests to run, and the timeout the twelve-package default
 * exists for) and omits coverage entirely, since the mutation score is
 * the measurement and v8 instrumentation would only slow every mutant.
 *
 * Not a must-agree copy: if `testInclude` or `testTimeout` drift here,
 * the mutation score is computed over a different suite than CI runs,
 * which shows up as a score that moves for no reason. Kept honest by
 * being two values with the reason attached rather than a second copy of
 * the shape (docs/specs/test-quality.spec.md, measure 1).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
