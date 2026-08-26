#!/usr/bin/env node
// check-depcruise-gate.mjs -- guard the architecture gate itself (barwise-862).
//
// The depcruise gate resolves @barwise/* imports to source via the
// "paths" map in tsconfig.depcruise.json. For SUBPATH exports
// (@barwise/core/annotation, @barwise/diagram-ui/server, ...) the
// "@barwise/*" wildcard swallows the subpath, resolution fails, and
// dependency-cruiser silently DROPS the edge -- the gate then passes
// while blind to the import. The exact per-subpath entries that fix
// this are a hand-maintained mirror of each package.json's "exports",
// which is the same defect class the gate exists to catch. So this
// script makes that mirror checked, two ways:
//
//   1. Coverage: derive the expected paths entry for every subpath
//      export in packages/*/package.json (dist target -> src source)
//      and fail if tsconfig.depcruise.json is missing it or maps it
//      elsewhere.
//   2. Probe: write a temporary forbidden subpath import into
//      packages/core/src, run the real depcruise CLI with the real
//      config, and fail unless the violation is reported. This is the
//      end-to-end proof that a dropped edge cannot come back silently.
//
// Run via `npm run check:depcruise-gate` (CI runs it next to depcruise).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

// --- 1. Coverage: every subpath export has a matching paths entry ---

const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.depcruise.json"), "utf8"));
const paths = tsconfig.compilerOptions?.paths ?? {};

// "./dist/render/theme.js" -> "packages/<pkg>/src/render/theme.ts"
function distToSrc(pkg, target) {
  const m = /^\.\/dist\/(.+)\.(js|d\.ts)$/.exec(target);
  if (!m) return undefined;
  return `packages/${pkg}/src/${m[1]}.ts`;
}

for (const pkg of readdirSync(join(root, "packages"))) {
  const pkgJsonPath = join(root, "packages", pkg, "package.json");
  if (!existsSync(pkgJsonPath)) continue;
  const exports_ = JSON.parse(readFileSync(pkgJsonPath, "utf8")).exports ?? {};
  for (const [sub, target] of Object.entries(exports_)) {
    if (sub === "." || sub === "./package.json") continue;
    const specifier = `@barwise/${pkg}/${sub.replace(/^\.\//, "")}`;
    const targetStr = typeof target === "string" ? target : target.default ?? target.types;
    const expected = targetStr && distToSrc(pkg, targetStr);
    if (!expected) {
      failures.push(
        `${pkg}: cannot derive a src path for export "${sub}" (${JSON.stringify(target)})`,
      );
      continue;
    }
    if (!existsSync(join(root, expected))) {
      failures.push(`${pkg}: derived source ${expected} for export "${sub}" does not exist`);
      continue;
    }
    const entry = paths[specifier];
    if (!entry) {
      failures.push(
        `tsconfig.depcruise.json is missing the subpath entry -- the gate is blind to every import of it. Add:\n`
          + `      "${specifier}": ["${expected}"],`,
      );
    } else if (!entry.includes(expected)) {
      failures.push(
        `tsconfig.depcruise.json maps "${specifier}" to ${
          JSON.stringify(entry)
        }, expected to include "${expected}"`,
      );
    }
  }
}

// --- 2. Probe: a forbidden subpath import must be reported ---

// core may import no sibling package, so any @barwise subpath import
// from inside core/src must violate layer-core. If the paths mapping
// regresses, the edge silently drops, no violation fires, and this
// probe fails -- which is the point.
const probePath = join(root, "packages/core/src/__depcruise-gate-probe__.ts");
writeFileSync(probePath, 'import "@barwise/diagram-ui/server";\nexport {};\n');
try {
  let out;
  try {
    out = execFileSync(
      "npx",
      ["depcruise", "packages", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // depcruise exits nonzero when violations exist; the JSON is on stdout.
    out = e.stdout;
  }
  const violations = JSON.parse(out).summary.violations ?? [];
  const hit = violations.some(
    (v) =>
      v.from.includes("__depcruise-gate-probe__")
      && v.to.includes("packages/diagram-ui/src/server.ts"),
  );
  if (!hit) {
    failures.push(
      "probe: a forbidden subpath import from core (@barwise/diagram-ui/server) produced no violation -- "
        + "the gate has gone blind to subpath edges again (check tsconfig.depcruise.json paths)",
    );
  }
} finally {
  unlinkSync(probePath);
}

if (failures.length > 0) {
  console.error(`check-depcruise-gate: ${failures.length} failure(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("check-depcruise-gate: subpath coverage complete; probe violation reported. OK");
