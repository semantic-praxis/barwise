#!/usr/bin/env node
// Source-site gate -- docs/specs/adr-batch9-enforcers.spec.md, WS3.
//
// Rules over package source that cross package boundaries. They live here,
// uncached, rather than in a package's vitest, because turbo caches a test
// against its own package's inputs: a core test that read vscode/src, or a
// formats test that read mcp/src, replays a cached pass when only the other
// package changes, which is the one change it exists to catch. Each rule is
// named, and each ADR names this gate for its own decisions:
//
// - `orm-version-writers` (schema-versioning#version-signal): every site
//   in `packages/*/src` that sets `orm_version` -- an object key
//   (identifier, string, shorthand, or a computed key that is one string),
//   an assignment to `.orm_version` or `["orm_version"]`, or string or
//   template text holding `orm_version:` -- is counted per (file, enclosing
//   function, form) and compared with ORM_VERSION_WRITERS. An unlisted
//   group, a listed group with more sites than its count, and one with
//   fewer (a stale row) are each a finding. Types are not sites: a type
//   writes nothing. A regex literal is not one either: the only one today
//   (mcp's workspace resolver) reads a file's version, it writes none.
// - `ossie-schema-refs` (ossie-interchange#peer-standard, #own-vocabulary):
//   a module reference or string literal holding `schemas/ossie` anywhere
//   in `packages/*/src` outside `formats/src/ossie/`. dependency-cruiser
//   cannot see these: its `includeOnly` keeps `packages/*/src`, so an
//   import of the vendored JSON is dropped before any rule reads it.
//
// What a parse cannot see is review's, and the ADRs say so: a computed key
// built by concatenation, an `Object.assign` or `defineProperty` from a
// variable key, a document copied by spread from somewhere other than the
// serializer, YAML assembled from fragments that never hold `orm_version:`
// whole, and a path to the vendored schema built from pieces.
//
// It parses with TypeScript, as check-core-purity does: a comment or a
// string can then neither hide a site nor raise one, and the assignment
// form, which a key-and-template text scan missed in the spec's first
// draft, is a node like any other.
//
// Exit 0 no findings, 1 findings, 2 could not answer (git failed, no
// tracked package source to read, or a listed file would not read).
//
// Usage: node barwise/scripts/check-source-sites.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { noteUntrackedInput, REPO_ROOT } from "./lib/tracked.mjs";

const ts = createRequire(import.meta.url)("typescript");

const PACKAGES = "barwise/packages/";
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
/** `barwise/packages/<pkg>/src/...` and nothing else under packages/. */
const PACKAGE_SOURCE = /^barwise\/packages\/[^/]+\/src\//;

/**
 * Every place allowed to set `orm_version`, keyed by (file under
 * `packages/`, enclosing function, form), with the count of sites it holds.
 * `(module)` is a site outside any named function. A function passed
 * anonymously (a callback) is not a scope of its own: its sites belong to
 * the function it is written in.
 */
export const ORM_VERSION_WRITERS = [
  {
    file: "core/src/decode/document.ts",
    fn: "(module)",
    form: "key",
    count: 1,
    reason: "the 3.0 decoder's schema literal; a read, not a write",
  },
  {
    file: "core/src/decode/document40.ts",
    fn: "(module)",
    form: "key",
    count: 1,
    reason: "the 4.0 decoder's schema literal; a read, not a write",
  },
  {
    file: "core/src/decode/document40.ts",
    fn: "document40Configs",
    form: "key",
    count: 1,
    reason: "an in-memory 3.0 document handed to 3.0's config builders, never written",
  },
  {
    file: "formats/src/ossie/verifyOssie.ts",
    fn: "document30",
    form: "assign",
    count: 1,
    reason: "an in-memory 3.0 document for the read-back diff, never written to disk",
  },
  {
    file: "core/src/serialization/schemaVersion.ts",
    fn: "migrate",
    form: "key",
    count: 1,
    reason: "the 1.0 -> 1.1 migration restamps its document",
  },
  {
    file: "core/src/serialization/migrations/diagramReferencesToIds.ts",
    fn: "migrateDiagramReferencesToIds",
    form: "key",
    count: 3,
    reason: "the 1.1 -> 2.0 migration restamps its document on each return",
  },
  {
    file: "core/src/serialization/OrmYamlSerializer.ts",
    fn: "documentOf",
    form: "key",
    count: 1,
    reason: "the serializer: every document it writes takes its version here",
  },
  {
    file: "core/src/project/splitModel.ts",
    fn: "splitModel",
    form: "key",
    count: 1,
    reason:
      "a writer outside the serializer: copies writeDocument40's version into each domain file "
      + "(tested: core splitModel.test.ts)",
  },
  {
    file: "vscode/src/commands/projectScaffold.ts",
    fn: "(module)",
    form: "text",
    count: 1,
    reason:
      "a writer outside the serializer: the new-model scaffold interpolates CURRENT_ORM_VERSION "
      + "(tested: vscode projectScaffold.test.ts)",
  },
];

/** Where Ossie's vendored schema may be named: the descriptor itself. */
export const OSSIE_HOME = "formats/src/ossie/";
/** The vendored schema's directory, alone or with a path under it. */
const OSSIE_SCHEMA = /schemas\/ossie(?:\/|$)/;
const VERSION_TEXT = /orm_version\s*:/;

function scriptKindOf(fileName) {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** A name node's text when it is spelled as one: identifier, string, number. */
function staticName(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticName(name.expression);
  return undefined;
}

/**
 * The name of the function a node is written in, or `(module)`. An arrow
 * or function expression takes the name it is bound to (a variable or a
 * property); one bound to nothing is a callback and is skipped, so a site
 * inside `.map(() => ...)` belongs to the function that calls `map`.
 */
export function enclosingFunction(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (
      ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n)
      || ts.isSetAccessorDeclaration(n)
    ) {
      const name = staticName(n.name);
      if (name !== undefined) return name;
      continue;
    }
    if (ts.isConstructorDeclaration(n)) return "constructor";
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (ts.isFunctionExpression(n) && n.name) return n.name.text;
      const p = n.parent;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
        const name = staticName(p.name);
        if (name !== undefined) return name;
      }
    }
  }
  return "(module)";
}

/** Every literal piece of text in a node: a string, or a template's parts. */
function textParts(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  return [];
}

/** Whether a string literal is the specifier of a module reference. */
function isModuleSpecifier(node) {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) {
    return true;
  }
  if (ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent)) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === node) {
    return p.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(p.expression) && p.expression.text === "require");
  }
  return false;
}

function parse(fileText, fileName) {
  return ts.createSourceFile(
    fileName,
    fileText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * Every site in one file that sets `orm_version`:
 * `[{ fn, form, line }]`, form being `key`, `assign` or `text`.
 */
export function ormVersionSites(fileText, fileName) {
  const sf = parse(fileText, fileName);
  const sites = [];
  const add = (form, node) =>
    sites.push({ fn: enclosingFunction(node), form, line: lineOf(sf, node) });
  const visit = (node) => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      && ts.isObjectLiteralExpression(node.parent)
      && staticName(node.name) === "orm_version"
    ) {
      add("key", node);
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = node.left;
      const member = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isElementAccessExpression(target)
        ? staticName(target.argumentExpression)
        : undefined;
      if (member === "orm_version") add("assign", node);
    } else if (textParts(node).some((t) => VERSION_TEXT.test(t))) {
      add("text", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/**
 * Every reference to the vendored Ossie schema in one file:
 * `[{ form, line, text }]`, form being `module` (an import, export-from,
 * `import x = require`, `require` or `import()`) or `string`. Each module
 * specifier is a string literal node, so walking the literals sees every
 * reference `ts.preProcessFile` would list, and the strings beside them.
 */
export function ossieSchemaRefs(fileText, fileName) {
  const sf = parse(fileText, fileName);
  const refs = [];
  const visit = (node) => {
    const parts = textParts(node);
    if (parts.some((t) => OSSIE_SCHEMA.test(t))) {
      refs.push({
        form: isModuleSpecifier(node) ? "module" : "string",
        line: lineOf(sf, node),
        text: node.getText(sf).slice(0, 90),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

const groupKey = (file, fn, form) => `${file} ${fn} ${form}`;

/**
 * The `orm-version-writers` findings for every site found
 * (`[{ file, fn, form, line }]`, file relative to `packages/`) against an
 * allowlist: an unlisted group, more sites than a row's count, or fewer.
 */
export function writerFindings(sites, allowlist = ORM_VERSION_WRITERS) {
  const groups = new Map();
  for (const s of sites) {
    const key = groupKey(s.file, s.fn, s.form);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const findings = [];
  const listed = new Set();
  for (const row of allowlist) {
    const key = groupKey(row.file, row.fn, row.form);
    listed.add(key);
    const found = groups.get(key) ?? [];
    const where = found.map((s) => `${s.file}:${s.line}`).join(", ");
    if (found.length > row.count) {
      findings.push(
        `${row.file} (${row.fn}, ${row.form}): ${found.length} sites, ${row.count} listed -- `
          + `${where}. A writer must go through the serializer, or be listed with its reason.`,
      );
    } else if (found.length < row.count) {
      findings.push(
        `${row.file} (${row.fn}, ${row.form}): ${found.length} site(s), ${row.count} listed. `
          + "The row is stale: lower its count, or remove it.",
      );
    }
  }
  for (const [key, found] of groups) {
    if (listed.has(key)) continue;
    const [s] = found;
    findings.push(
      `${s.file} (${s.fn}, ${s.form}): sets orm_version and is not listed -- `
        + `${found.map((f) => `${f.file}:${f.line}`).join(", ")}. Write through the serializer `
        + "(OrmYamlSerializer), or list the site in ORM_VERSION_WRITERS with why it may bypass it.",
    );
  }
  return findings;
}

/** Rows the gate cannot use: a repeated key, or a count below one. */
export function allowlistProblems(allowlist = ORM_VERSION_WRITERS) {
  const seen = new Set();
  const problems = [];
  for (const row of allowlist) {
    const key = groupKey(row.file, row.fn, row.form);
    if (seen.has(key)) problems.push(`repeated row ${key}`);
    seen.add(key);
    if (!Number.isInteger(row.count) || row.count < 1) {
      problems.push(`row ${key}: count ${row.count}`);
    }
  }
  return problems;
}

function refuse(message) {
  process.stderr.write(
    `source sites: ${message}\n  Refusing rather than printing OK over source it did not read.\n`,
  );
  process.exit(2);
}

function main() {
  const problems = allowlistProblems();
  if (problems.length > 0) refuse(`ORM_VERSION_WRITERS is malformed: ${problems.join("; ")}.`);

  const pathspec = "barwise/packages";
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "-z", "--", pathspec], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    refuse(`\`git ls-files\` failed: ${String(error.message ?? error).split("\n")[0]}`);
  }
  const isSource = (f) => PACKAGE_SOURCE.test(f) && SOURCE.test(f) && !TEST.test(f);
  const files = listing.split("\0").filter(Boolean).filter(isSource);
  if (files.length === 0) {
    refuse(`no tracked source files under ${pathspec}/*/src.`);
  }
  noteUntrackedInput({ pathspec, suffix: "", include: isSource, gate: "source sites" });

  const sites = [];
  const refs = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(resolve(REPO_ROOT, file), "utf8");
    } catch (error) {
      refuse(`${file} is tracked but would not read (${String(error.message ?? error)}).`);
    }
    const rel = file.slice(PACKAGES.length);
    for (const s of ormVersionSites(text, file)) sites.push({ ...s, file: rel });
    if (!rel.startsWith(OSSIE_HOME)) {
      for (const r of ossieSchemaRefs(text, file)) refs.push({ ...r, file: rel });
    }
  }

  const findings = [
    ...writerFindings(sites).map((f) => `orm-version-writers  ${f}`),
    ...refs.map((r) =>
      `ossie-schema-refs  ${r.file}:${r.line} (${r.form}) ${r.text} -- only ${OSSIE_HOME} `
      + "reads the vendored Ossie schema (ossie-interchange#peer-standard)"
    ),
  ];
  if (findings.length === 0) {
    console.warn(
      `source sites: OK -- ${files.length} file(s); orm-version-writers: ${sites.length} site(s) `
        + `in ${ORM_VERSION_WRITERS.length} listed group(s); ossie-schema-refs: none outside `
        + `${OSSIE_HOME}.`,
    );
    process.exit(0);
  }
  console.error(`source sites: ${findings.length} finding(s) in packages/*/src:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
