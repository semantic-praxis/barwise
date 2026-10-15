/**
 * The type tests are compiled, not merely listed.
 *
 * vitest's typecheck reports a type test as passing when the tsconfig it is
 * given does not include the file: the compiler never sees it, so it finds
 * no error. Core's own tsconfig excludes `tests/`, and pointed at it the S3
 * harness reported a deliberately false assertion as "no errors". So every
 * file the typecheck include matches must be inside the typecheck
 * tsconfig's include as well.
 */
import { globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../vitest.config.js";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("type test wiring", () => {
  const typecheck = config.test?.typecheck;

  it("is enabled, with an include and a tsconfig of its own", () => {
    expect(typecheck?.enabled).toBe(true);
    expect(typecheck?.tsconfig).toBe("tests/types/tsconfig.json");
  });

  it("puts every type test inside the tsconfig that compiles it", () => {
    const files = (typecheck?.include ?? []).flatMap((g) => globSync(g, { cwd: CORE }));
    expect(files.length).toBeGreaterThan(0);
    const tsconfigPath = join(CORE, typecheck!.tsconfig!);
    const include: string[] = JSON.parse(readFileSync(tsconfigPath, "utf8")).include;
    for (const file of files) {
      const rel = relative(dirname(tsconfigPath), join(CORE, file));
      expect(include.some((g) => matchesGlob(rel, g.replace(/^\.\//, ""))), file).toBe(true);
    }
  });
});
