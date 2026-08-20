/**
 * Make the built CLI entry point executable.
 *
 * `package.json` declares `bin: { barwise: "./dist/index.js" }` and
 * `src/index.ts` carries a shebang, but the build is plain `tsc`, which
 * writes mode 644. npm normally sets the executable bit on a bin target
 * during install -- except `dist/` is gitignored, so on a fresh clone
 * the file does not exist yet at install time and npm has nothing to
 * chmod. The documented sequence (`npm install && npm run build`)
 * therefore produced a bin that could not be executed, and `npx barwise`
 * failed with "Permission denied" (barwise-807).
 *
 * `chmodSync` rather than a shell `chmod`, so this runs on Windows too,
 * where it is effectively a no-op.
 */
import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

if (!existsSync(target)) {
  console.error(`chmod-bin: ${target} does not exist -- did the build run?`);
  process.exit(1);
}

chmodSync(target, 0o755);
