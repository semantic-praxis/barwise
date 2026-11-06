/**
 * Core ships no interop format (docs/adr/connector-packages.md, decision
 * `core-no-interop`; format-renderers-to-connectors.spec.md, WS1).
 *
 * Two halves. Every name `@barwise/core` and its subpath exports export at
 * run time is pinned against `exports.json`, a reviewed list: a new export
 * fails until it is listed, so a format's renderer cannot come back into
 * core under any name without a reviewer seeing the line. And no source
 * file in core implements `ImportFormat` or `ExportFormatAdapter`, the
 * shape a format takes. The list holds runtime values, not types: a
 * renderer is a value, and reading types would need the TypeScript
 * compiler in a test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pinned from "./exports.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
  exports: Record<string, { default: string; }>;
};

/** `./dist/mapping/index.js` -> the source barrel it is built from. */
const sourceOf = (built: string) =>
  join(pkgRoot, built.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("core's public surface [adr:connector-packages#core-no-interop]", () => {
  it("exports exactly the reviewed names from each entry point [adr:connector-packages#core-no-interop] [adr:connector-packages#format-in-its-connector]", async () => {
    const actual: Record<string, string[]> = {};
    for (const [sub, target] of Object.entries(pkg.exports)) {
      const mod = await import(sourceOf(target.default)) as Record<string, unknown>;
      actual[sub] = Object.keys(mod).sort();
    }
    // A failure here is a change to core's public surface: list the name in
    // exports.json if it belongs in core, or put the code in its connector.
    expect(actual).toEqual(pinned);
  });

  it("holds no format adapter in its source [adr:connector-packages#core-no-interop]", () => {
    // A format's declared shapes: a value typed as an adapter or a
    // descriptor however the type is written, and a registration call. The
    // registry's own file defines registerFormat and is the one place a
    // register call belongs. An untyped literal that only structurally
    // matches is not seen; exports.json is the backstop for one exported.
    const shape = "(?:ImportFormat|ExportFormatAdapter|FormatDescriptor)";
    const declared = new RegExp(
      [
        `\\bimplements\\b[^{]*\\b${shape}\\b`, // class X implements A, ImportFormat
        `\\b(?:satisfies|as)\\s+${shape}\\b`, // {...} satisfies / as X
        `:\\s*${shape}\\s*=`, // const x: X = ...
        `\\)\\s*:\\s*${shape}\\s*(?:\\{|=>)`, // function f(): X {  /  (): X =>
      ].join("|"),
    );
    const registers = /\b(?:formatRegistry\.register|registerFormat)\(/;
    const registry = join(pkgRoot, "src/format/registry.ts");
    const found = sourceFiles(join(pkgRoot, "src"))
      .filter((f) => {
        // Comments say "implements this interface" in prose; only code counts.
        const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(
          /\/\/.*$/gm,
          "",
        );
        return declared.test(text) || (f !== registry && registers.test(text));
      })
      .map((f) => relative(pkgRoot, f));
    expect(found).toEqual([]);
  });
});
