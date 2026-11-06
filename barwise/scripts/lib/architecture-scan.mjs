// The three readers behind check:architecture's package-graph checks
// (docs/adr/package-graph-authority.md, intended-is-graph and
// core-external-deps). Each takes text and returns facts; the gate decides
// what disagrees, and what it cannot answer for.
import { builtinModules, createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

const KINDS = { ".mjs": ts.ScriptKind.JS, ".cjs": ts.ScriptKind.JS, ".js": ts.ScriptKind.JS };

/** The text of a property name written as an identifier or a string, else null. */
function keyText(name) {
  if (
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

/**
 * Adjacency entries in a script: a property whose key is a package and whose
 * value is a non-empty array literal of nothing but package names, which is
 * the shape of one entry of `INTENDED` (`"promptlab": ["core", "llm"]`).
 * `names` holds every spelling of a package (directory and manifest name).
 *
 * This is a shadow of "the script keeps a copy of the graph": a copy written
 * as `"cli->core"` strings or a `Map` has another shape and passes. Every
 * copy found before this check had this one (arch-triage.mjs kept one that
 * drifted), and an array that also holds a non-package, such as
 * external-deps.cjs's `["ajv", "effect", "yaml"]`, is not an entry. An empty
 * array is not read as one either: `"core": []` states nothing a second
 * place could contradict.
 */
export function graphLiterals(file, text, names) {
  const ext = file.slice(file.lastIndexOf("."));
  if (!(ext in KINDS)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, KINDS[ext]);
  const found = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isArrayLiteralExpression(node.initializer)) {
      const key = keyText(node.name);
      const items = node.initializer.elements;
      if (
        key !== null && names.has(key) && items.length > 0
        && items.every((e) => ts.isStringLiteralLike(e) && names.has(e.text))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({ line: line + 1, key, targets: items.map((e) => e.text) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * The internal packages a package's CLAUDE.md names as Upstream rows of its
 * `## Dependencies` table: `{ table, rows, bad }`. `table` is whether the
 * section has a table (a `Direction` header row); `rows` the backticked
 * names of its Upstream rows that `isInternal` accepts; `bad` the Upstream
 * cells it cannot read as a name. External rows (`react`) are ignored, and
 * so is a core-style `none`. Downstream rows are the other package's to
 * state and are not read.
 */
export function upstreamRows(text, isInternal) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "## Dependencies");
  const out = { section: start !== -1, table: false, rows: [], bad: [] };
  if (start === -1) return out;
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells[0] === "Direction") out.table = true;
    if (cells[0] !== "Upstream") continue;
    const m = /^`([^`]+)`$/.exec(cells[1] ?? "");
    if (m === null) {
      if (cells[1] !== "none") out.bad.push(cells[1] ?? "");
    } else if (isInternal(m[1])) out.rows.push(m[1]);
  }
  return out;
}

/** `@scope/name/sub` is `@scope/name`; `name/sub` is `name`. */
const packageOf = (spec) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
const BUILTIN = new Set(builtinModules);

/**
 * The packages a source file imports by bare specifier, with the specifier's
 * package name: relative paths and `node:` modules are left out (purity owns
 * those), and so is a Node builtin written without the prefix, which purity
 * reports as the I/O it is. Type-only imports count, because the package's
 * `.d.ts` re-exposes them to every consumer. `import("x")` in a type
 * position counts too (`ts.preProcessFile` reads it).
 */
export function bareImports(file, text) {
  const info = ts.preProcessFile(text, true, true);
  const out = new Set();
  for (const { fileName } of info.importedFiles) {
    if (fileName.startsWith(".") || fileName.startsWith("/") || fileName.startsWith("node:")) {
      continue;
    }
    const pkg = packageOf(fileName);
    if (!BUILTIN.has(pkg)) out.add(pkg);
  }
  return [...out].sort();
}
