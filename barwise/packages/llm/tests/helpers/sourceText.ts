/**
 * Source-reading helpers for the tests that hold a decision by reading code
 * rather than running it (docs/specs/model-access-held.spec.md).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The source with every comment blanked and every string kept.
 *
 * Strings are kept because the checks read them (`process.env["X"]`, an
 * import specifier); comments are blanked because the decisions these tests
 * hold are about code, and the files explaining them name the very things
 * they forbid. Newlines survive, so a line number still points somewhere
 * real. Not a full lexer: a regex literal containing a quote can hide the
 * rest of its line, which can only make a check miss, never report a false
 * finding.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") {
          out += source[i]! + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        i++;
      }
      if (i < source.length) out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every `.ts`/`.tsx` file under `dir`, recursively, `.d.ts` excluded. */
export function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found;
}

/** A file's text with comments stripped. */
export function readCode(path: string): string {
  return stripComments(readFileSync(path, "utf8"));
}
