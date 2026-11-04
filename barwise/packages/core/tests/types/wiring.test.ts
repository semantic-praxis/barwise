/**
 * The type tests are compiled, not merely listed.
 *
 * vitest's typecheck reports a type test as passing when the tsconfig it is
 * given does not compile the file: the compiler never sees it, so it finds
 * no error. Core's own tsconfig excludes `tests/`, and pointed at it the S3
 * harness reported a deliberately false assertion as "no errors". So every
 * file the typecheck include matches must be among the files TypeScript
 * resolves for the typecheck tsconfig -- its include, its exclude and what
 * it inherits, read the way tsc reads them, not the patterns as written.
 */
import { globSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import config from "../../vitest.config.js";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The files tsc would compile for `tsconfigPath`. */
function compiledFiles(tsconfigPath: string): Set<string> {
  const read = ts.readConfigFile(tsconfigPath, (p) => ts.sys.readFile(p));
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath));
  return new Set(parsed.fileNames.map((f) => resolve(f)));
}

describe("type test wiring", () => {
  const typecheck = config.test?.typecheck;

  it("is enabled, with an include and a tsconfig of its own", () => {
    expect(typecheck?.enabled).toBe(true);
    expect(typecheck?.tsconfig).toBe("tests/types/tsconfig.json");
  });

  it("puts every type test among the files its tsconfig compiles", () => {
    const files = (typecheck?.include ?? []).flatMap((g) => globSync(g, { cwd: CORE }));
    expect(files.length).toBeGreaterThan(0);
    const compiled = compiledFiles(join(CORE, typecheck!.tsconfig!));
    for (const file of files) expect(compiled.has(join(CORE, file)), file).toBe(true);
  });
});
