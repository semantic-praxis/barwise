/**
 * Bundle entry point for the standalone CLI.
 *
 * esbuild adds the `#!/usr/bin/env node` banner, so this entry omits the
 * shebang that `src/index.ts` carries for the tsc build. The version is
 * injected by esbuild `define` (the bundle has no sibling package.json),
 * so `import.meta` never reaches the CJS bundle.
 */

import { createProgram } from "./cli.js";

createProgram(process.env.BARWISE_CLI_VERSION ?? "0.0.0-dev").parse();
