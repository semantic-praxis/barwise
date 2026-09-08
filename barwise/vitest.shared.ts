/**
 * The one owner of the shape every package's tests run under.
 *
 * Twelve `packages/*\/vitest.config.ts` files used to restate this shape
 * in full. Nothing declared that they were meant to agree, so a package
 * whose `testTimeout` or coverage provider drifted would have drifted
 * silently, and any change reaching all of them -- the run-scoped
 * coverage directory below was the one that forced this -- was twelve
 * identical edits. Here the shape is stated once and the parts that
 * legitimately vary are parameters.
 *
 * No import from `vitest/config`: vitest is a dependency of each package,
 * not of this level, and is not hoisted to the root `node_modules`. Each
 * config wraps the returned object in that package's own `defineConfig`,
 * which is where it gets type-checked.
 */
import { join } from "node:path";

/** The four coverage percentages a package's suite must not fall below. */
export interface CoverageFloors {
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
}

/**
 * What a package gates coverage over.
 *
 * `whole-src` is the ordinary case: every module under `src/`, minus the
 * barrel, minus whatever else the package names -- type-only modules and
 * code reachable only by spawning a real process, both of which are pure
 * denominator. `named-files` is for the two packages whose gated surface
 * is a list rather than a tree, because the rest of their `src/` is
 * covered by a suite that does not run here (vscode's integration tests)
 * or carries no logic (the diagram-ui barrels).
 */
export type CoverageScope =
  | { readonly kind: "whole-src"; readonly exclude?: readonly string[]; }
  | { readonly kind: "named-files"; readonly include: readonly string[]; };

export interface PackageTestShape {
  readonly coverage: CoverageScope;
  readonly thresholds: CoverageFloors;
  /** Defaults to `["tests/**\/*.test.ts"]`. */
  readonly testInclude?: readonly string[];
}

/**
 * Where this run's coverage bookkeeping goes.
 *
 * vitest's v8 provider derives its per-worker temp directory as
 * `resolve(reportsDirectory, ".tmp")` and removes and recreates it at the
 * start of every run. Two runs of the same package therefore delete each
 * other's files and the loser reports `ENOENT ... coverage/.tmp/
 * coverage-0.json` on a tree that is green. `reportsDirectory` is the
 * only lever vitest exposes, so isolating a run means moving the whole
 * report directory. Unset -- which is every case but `ci:local` -- the
 * default `<pkg>/coverage` stands.
 */
function reportsDirectory(pkg: string): { reportsDirectory?: string; } {
  const runScoped = process.env.BARWISE_COVERAGE_DIR;
  return runScoped === undefined || runScoped === ""
    ? {}
    : { reportsDirectory: join(runScoped, pkg) };
}

/**
 * The vitest configuration for one package.
 *
 * `pkg` names the directory under a run-scoped coverage root; it is a
 * parameter rather than inferred from the config's own path because
 * inferring it would tie this file to how vitest resolves `import.meta`
 * for a config it loaded from elsewhere.
 */
export function barwiseVitestConfig(pkg: string, shape: PackageTestShape) {
  const coverageFiles = shape.coverage.kind === "named-files"
    ? { include: [...shape.coverage.include] }
    : {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", ...(shape.coverage.exclude ?? [])],
    };

  return {
    test: {
      include: [...(shape.testInclude ?? ["tests/**/*.test.ts"])],
      // Twelve packages ran under a 5s default and several of them could
      // not: real ELK layout, a full validate of the auction model, and
      // loading the packaged seed suite all take seconds under coverage
      // instrumentation with twelve packages in parallel on a loaded CI
      // runner. One number for all of them, because the reason is the
      // runner rather than anything a package chose.
      testTimeout: 30_000,
      coverage: {
        provider: "v8" as const,
        ...coverageFiles,
        ...reportsDirectory(pkg),
        thresholds: { ...shape.thresholds },
      },
    },
  };
}
