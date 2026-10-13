/**
 * Counts the modules a process loads and the bytes of their source, for
 * `measure-comparison.mjs startup`. Loaded with `node --import`; writes
 * `{ modules, bytes }` to the path in MODULE_COUNT_OUT on exit.
 *
 * It counts what was fetched, not what it cost to evaluate: the timing
 * comes from the wall clock around the whole process.
 */
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

let modules = 0;
let bytes = 0;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    modules += 1;
    if (result.source != null) {
      bytes += typeof result.source === "string"
        ? Buffer.byteLength(result.source)
        : result.source.byteLength;
    }
    return result;
  },
});

process.on("exit", () => {
  if (process.env.MODULE_COUNT_OUT) {
    writeFileSync(process.env.MODULE_COUNT_OUT, JSON.stringify({ modules, bytes }));
  }
});
