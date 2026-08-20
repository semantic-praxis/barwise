/**
 * Standalone bundle builder for @barwise/cli.
 *
 * Produces a single self-contained file at dist/bundle/index.cjs that
 * includes all dependencies (@barwise/core, @barwise/diagram, @barwise/llm,
 * the connector packages, commander, elkjs, yaml, ajv, etc.). This is the
 * downloadable `barwise` artifact attached to releases -- it runs with
 * `node index.cjs` (or directly, via the shebang) without installing the
 * monorepo. Mirrors packages/mcp/esbuild.mjs.
 */

import * as esbuild from "esbuild";
import { chmodSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

await esbuild.build({
  entryPoints: ["src/bundle-entry.ts"],
  outfile: "dist/bundle/index.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
  loader: { ".json": "json" },
  // The bundle has no sibling package.json, so inject the version that
  // cli.ts would otherwise read at runtime.
  define: { "process.env.BARWISE_CLI_VERSION": JSON.stringify(version) },
  // elkjs optionally uses web-worker for browser environments; not
  // needed in Node.js where it falls back to synchronous execution.
  external: ["web-worker"],
  logLevel: "warning",
});

// The banner gives the bundle a shebang, so it is meant to run
// directly as well as through `node`. esbuild writes mode 644, and
// a shebang on a non-executable file is a promise the file cannot
// keep. chmodSync rather than a shell chmod, so this works on
// Windows (where it is a no-op) as well as CI.
chmodSync("dist/bundle/index.cjs", 0o755);

console.log("Bundle complete.");
