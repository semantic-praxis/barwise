/**
 * Core's sorts do not follow the process locale (barwise-c3z;
 * determinism-in-core decision 1, `pure-ops`;
 * docs/specs/purity-and-model-boundary.spec.md, Scope 3).
 *
 * The names are the ones barwise-c3z measured: under a bare
 * `localeCompare` they sort one way under en-US and another under sv-SE
 * (`Ärende` after `Zebra`). The locale is a property of the process, so
 * the second half runs core in child processes with `LANG` set: an
 * in-process test cannot change the locale it runs under, and would pass
 * with the bare calls still in place.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { runQuery } from "../../src/query/index.js";
import { compareCodeUnits } from "../../src/util/compareCodeUnits.js";

const NAMES = ["Zebra", "Ärende", "Apa", "aa", "Ab"];
// UTF-16 code-unit order: uppercase ASCII, then lowercase, then U+00C4.
const CODE_UNIT_ORDER = ["Ab", "Apa", "Zebra", "aa", "Ärende"];

const coreSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

function modelOf(names: readonly string[]): OrmModel {
  const model = new OrmModel({ name: "Locale" });
  for (const name of names) model.addObjectType({ name, kind: "entity", referenceMode: "id" });
  return model;
}

/**
 * Run in a child process: core's source, loaded through a hook that
 * transpiles it with `typescript` (src imports `./x.js` for `./x.ts`, and
 * Node's own type stripping refuses core's syntax). Reading src rather
 * than dist means a stale build cannot pass this test for code that has
 * since changed. It prints the bare `localeCompare` order too, which is
 * how the test knows its child processes can tell the locales apart.
 */
const CHILD = `
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const src = process.env.CORE_SRC;
const ts = createRequire(src + "/")("typescript");
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (error) {
      if (spec.startsWith(".") && spec.endsWith(".js")) return next(spec.slice(0, -3) + ".ts", ctx);
      throw error;
    }
  },
  load(url, ctx, next) {
    if (!url.endsWith(".ts")) return next(url, ctx);
    const text = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
const at = (p) => pathToFileURL(src + p).href;
const { compareCodeUnits } = await import(at("/util/compareCodeUnits.ts"));
const { runQuery } = await import(at("/query/index.ts"));
const { OrmModel } = await import(at("/model/OrmModel.ts"));
const names = JSON.parse(process.env.NAMES);
const model = new OrmModel({ name: "Locale" });
for (const name of names) model.addObjectType({ name, kind: "entity", referenceMode: "id" });
console.log(JSON.stringify({
  bare: [...names].sort((a, b) => a.localeCompare(b)),
  comparator: [...names].sort(compareCodeUnits),
  entities: runQuery(model, "entities").entities.map((e) => e.name),
  anchors: runQuery(model, "anchors").anchors.map((a) => a.entity),
}));
`;

function underLocale(lang: string): Record<string, string[]> {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", CHILD], {
    encoding: "utf8",
    env: {
      ...process.env,
      LANG: lang,
      LC_ALL: lang,
      CORE_SRC: coreSrc,
      NAMES: JSON.stringify(NAMES),
    },
  });
  return JSON.parse(out) as Record<string, string[]>;
}

describe("compareCodeUnits", () => {
  it("orders by UTF-16 code unit, as a comparator-less sort does", () => {
    expect([...NAMES].sort(compareCodeUnits)).toEqual(CODE_UNIT_ORDER);
    expect([...NAMES].sort(compareCodeUnits)).toEqual([...NAMES].sort());
    expect(compareCodeUnits("a", "a")).toBe(0);
    expect(compareCodeUnits("a", "b")).toBe(-1);
    expect(compareCodeUnits("b", "a")).toBe(1);
  });

  it("is the order query's by-name results take", () => {
    const result = runQuery(modelOf(NAMES), "entities");
    expect(result.kind === "entities" && result.entities.map((e) => e.name)).toEqual(
      CODE_UNIT_ORDER,
    );
    const anchors = runQuery(modelOf(NAMES), "anchors");
    expect(anchors.kind === "anchors" && anchors.anchors.map((a) => a.entity)).toEqual(
      CODE_UNIT_ORDER,
    );
  });

  it("gives one order under sv_SE and en_US [adr:determinism-in-core#pure-ops]", () => {
    const sv = underLocale("sv_SE.UTF-8");
    const en = underLocale("en_US.UTF-8");
    // The instrument first: a bare localeCompare must differ between the two
    // children, or they did not run under different locales and the
    // agreement below would mean nothing.
    expect(sv.bare, "child processes did not pick up LANG").not.toEqual(en.bare);
    for (const key of ["comparator", "entities", "anchors"]) {
      expect(sv[key], key).toEqual(CODE_UNIT_ORDER);
      expect(en[key], key).toEqual(CODE_UNIT_ORDER);
    }
  });
});
