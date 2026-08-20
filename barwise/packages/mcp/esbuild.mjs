/**
 * Standalone bundle builder for @barwise/mcp.
 *
 * Produces a single self-contained file at dist/bundle/index.js that
 * includes all dependencies (@barwise/core, @barwise/diagram, @barwise/llm,
 * MCP SDK, zod, elkjs, yaml, ajv, etc.). This is what gets published
 * to npm so that `npx @barwise/mcp` works without installing anything
 * else.
 */

import * as esbuild from "esbuild";
import { chmodSync } from "node:fs";

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
