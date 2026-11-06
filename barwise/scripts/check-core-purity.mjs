#!/usr/bin/env node
// Core-determinism gate -- WS5 of docs/specs/archive/architecture-analysis.spec.md,
// widened by docs/specs/purity-and-model-boundary.spec.md WS1.
//
// Enforces "determinism in core": packages/core/src must be free of I/O,
// clocks, randomness, the process environment and locale, and the model
// SDKs (scenarios S-DET-1..3; ADRs determinism-in-core#pure-ops and
// connector-packages#connector-owns-io). It lives here rather than in
// .dependency-cruiser.cjs because dependency-cruiser sees imports but not
// `process.env`, `Date.now` or `localeCompare` usage.
//
// It parses each file with TypeScript and walks the tree. The line-pattern
// version before it skipped any line that started with a comment, so
// `/* c8 ignore */ import ... from "node:fs"` passed (barwise-ym8.iyw), and
// a regex cannot tell a name from the same word in a string or comment. A
// hand-written comment stripper was rejected: the one in `llm` goes out of
// phase on three core files with a quote in a regex literal.
//
// A token scanner was tried next and was not enough, for two reasons only a
// parser settles. Whether `/` starts a regex or divides depends on grammar
// the scanner does not have: after `if (a)` it is a regex, after a variable
// named `of` or a type argument's `>` it divides, and guessing wrong once
// desyncs the rest of the file, so `if (a) /\`/.test(x);` hid every
// violation after it. And a name's meaning depends on its position: a
// scanner flags `{ process: 1 }` and `o.process`, and cannot tell the type
// `import("x").T` from the value `import("x").foo`, or a `Date` annotation
// from a `Date()` call. The parser gives each node its role, so a comment or
// a string can neither hide a violation nor raise one, and a property name
// is not a global.
//
// The rules are exported (`PURITY_RULES`, `purityFindings`) so that
// scripts/arch-triage.mjs reads the same ones rather than a copy.
//
// Exit 0 no findings, 1 findings, 2 could not answer (git failed, or no
// tracked core source to read: an OK over zero files is barwise-905's
// shape). Gating in CI.
//
// Usage: node barwise/scripts/check-core-purity.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { noteUntrackedInput, REPO_ROOT } from "./lib/tracked.mjs";

const ts = createRequire(import.meta.url)("typescript");

const SDK_FIX = "only @barwise/llm imports a model SDK (determinism-in-core#one-layer-out)";
const IO_FIX = "move the I/O to an outer package or a connector, or pass the value in";
const LOCALE_FIX =
  "use compareCodeUnits (core/src/util), or take the locale as an argument from the surface";
const RANDOM_NAMES = ["randomUUID", "randomBytes", "randomInt", "getRandomValues"];

/**
 * Every rule. A rule matches by any of:
 * - `modules`: a module reference (import, export-from, `import x =
 *   require`, `import("x")` in a type or a call, `require("x")`), compared
 *   without `node:` and subpath;
 * - `dynamicImport`: an `import(...)` call, i.e. in value position;
 * - `globals`: a free name used as a value, or `globalThis.<name>`;
 * - `members`: a property access (or `["name"]`) of that name, on anything;
 * - `qualified`: `Object.member` on that free object name;
 * - `importedNames`: a named import of that name from `node:crypto`.
 */
export const PURITY_RULES = [
  { id: "S-DET-1", name: "node:fs", modules: ["fs"], fix: IO_FIX },
  { id: "S-DET-1", name: "node:child_process", modules: ["child_process"], fix: IO_FIX },
  { id: "S-DET-1", name: "node:os", modules: ["os"], fix: IO_FIX },
  {
    id: "S-DET-1",
    name: "network module",
    modules: ["net", "http", "https", "tls", "dgram", "http2", "dns", "undici"],
    fix: IO_FIX,
  },
  {
    id: "S-DET-1",
    name: "ambient runtime module",
    modules: ["process", "module", "worker_threads", "readline", "vm", "perf_hooks"],
    fix: IO_FIX,
  },
  { id: "S-DET-1", name: "model SDK", modules: ["@anthropic-ai/sdk", "openai"], fix: SDK_FIX },
  {
    id: "S-DET-1",
    name: "runtime import()",
    dynamicImport: true,
    fix:
      'use a static import; only the type forms import("x").T and typeof import("x") are allowed',
  },
  { id: "S-DET-3", name: "process", globals: ["process"], fix: IO_FIX },
  { id: "S-DET-1", name: "network call", globals: ["fetch"], fix: IO_FIX },
  { id: "S-DET-3", name: "clock", globals: ["performance", "Date"], fix: "pass the time in" },
  {
    id: "S-DET-3",
    name: "process locale",
    globals: ["Intl"],
    members: ["localeCompare", "toLocaleString", "toLocaleUpperCase", "toLocaleLowerCase"],
    fix: LOCALE_FIX,
  },
  {
    id: "S-DET-2",
    name: "randomness",
    members: RANDOM_NAMES,
    qualified: ["Math.random"],
    importedNames: RANDOM_NAMES,
    fix: "pass the id or seed in",
  },
  { id: "S-DET-2", name: "global crypto.*", globals: ["crypto"], fix: "pass the id or seed in" },
];

/** name -> rule, for each way a rule matches. Built once, at load. */
function indexBy(field) {
  const map = new Map();
  for (const rule of PURITY_RULES) for (const key of rule[field] ?? []) map.set(key, rule);
  return map;
}
const BY_MODULE = indexBy("modules");
const BY_GLOBAL = indexBy("globals");
const BY_MEMBER = indexBy("members");
const BY_QUALIFIED = indexBy("qualified");
const BY_IMPORTED_NAME = indexBy("importedNames");
const DYNAMIC_IMPORT = PURITY_RULES.find((r) => r.dynamicImport);
const CRYPTO_MODULES = new Set(["crypto"]);
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** `node:fs/promises` -> `fs`, `openai/resources` -> `openai`, `@a/b/c` -> `@a/b`. */
function moduleBase(specifier) {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const parts = bare.split("/");
  return bare.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function scriptKindOf(fileName) {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** A string literal's text, or undefined. */
function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** The member a property or literal element access names, or undefined. */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  if (ts.isElementAccessExpression(node)) return literalText(node.argumentExpression);
  return undefined;
}

/**
 * Whether a node sits inside a type. `ExpressionWithTypeArguments` counts as
 * a type node to TypeScript, but its expression is a value in `extends Base`
 * and in an instantiation expression (`fetch<T>`); only `implements` and an
 * interface's `extends` name a type there.
 */
function inTypePosition(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isExpressionWithTypeArguments(n)) {
      const clause = n.parent;
      const typeOnly = clause && ts.isHeritageClause(clause)
        && (clause.token === ts.SyntaxKind.ImplementsKeyword
          || ts.isInterfaceDeclaration(clause.parent));
      if (typeOnly) return true;
      continue;
    }
    if (ts.isTypeNode(n)) return true;
    if (ts.isStatement(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/**
 * Whether an Identifier reads a binding, as opposed to naming a property,
 * a declaration, a label, an import or export specifier, or a type.
 */
function isValueReference(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isShorthandPropertyAssignment(p)) return p.name === id; // `{ process }` reads it
  if (p.name === id || p.propertyName === id || p.label === id) return false;
  if (ts.isQualifiedName(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  return !inTypePosition(id);
}

/**
 * Every purity finding in one file's text: `[{ rule, line, text, fix }]`,
 * where `rule` is `"<id> <name>"` and `line` is 1-based. One finding per
 * rule and line.
 */
export function purityFindings(fileText, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    fileText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  const lines = fileText.split("\n");
  const seen = new Set();
  const findings = [];
  const add = (rule, node) => {
    const index = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const key = `${rule.name}\0${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      rule: `${rule.id} ${rule.name}`,
      line: index + 1,
      text: lines[index].trim().slice(0, 90),
      fix: rule.fix,
    });
  };
  const moduleRef = (specifierNode) => {
    const text = literalText(specifierNode);
    if (text === undefined) return;
    const rule = BY_MODULE.get(moduleBase(text));
    if (rule) add(rule, specifierNode);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      moduleRef(node.moduleSpecifier);
      const from = literalText(node.moduleSpecifier);
      const named = node.importClause?.namedBindings;
      if (from && CRYPTO_MODULES.has(moduleBase(from)) && named && ts.isNamedImports(named)) {
        for (const spec of named.elements) {
          const rule = BY_IMPORTED_NAME.get((spec.propertyName ?? spec.name).text);
          if (rule) add(rule, spec);
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      moduleRef(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) moduleRef(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(DYNAMIC_IMPORT, node);
        moduleRef(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        moduleRef(node.arguments[0]);
      }
    }

    const member = memberName(node);
    if (member !== undefined && !inTypePosition(node)) {
      const object = node.expression;
      const memberRule = BY_MEMBER.get(member);
      if (memberRule) add(memberRule, node);
      if (ts.isIdentifier(object) && isValueReference(object)) {
        const qualifiedRule = BY_QUALIFIED.get(`${object.text}.${member}`);
        if (qualifiedRule) add(qualifiedRule, node);
        const viaGlobalThis = object.text === "globalThis" && BY_GLOBAL.get(member);
        if (viaGlobalThis) add(viaGlobalThis, node);
      }
    }

    if (ts.isIdentifier(node) && isValueReference(node)) {
      const rule = BY_GLOBAL.get(node.text);
      if (rule) add(rule, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings.sort((a, b) => a.line - b.line);
}

function refuse(message) {
  process.stderr.write(
    `core purity: ${message}\n  Refusing rather than printing OK over source it did not read.\n`,
  );
  process.exit(2);
}

function main() {
  const pathspec = "barwise/packages/core/src";
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
  // Every extension TypeScript can parse, .d.ts included: a .mjs or .js file
  // in core/src is as much core as a .ts one, and a gate that read only .ts
  // would print OK over it.
  const isSource = (f) => SOURCE.test(f) && !TEST.test(f);
  const files = listing.split("\0").filter(Boolean).filter(isSource);
  if (files.length === 0) {
    refuse(`no tracked source files (.ts .tsx .mts .cts .js .jsx .mjs .cjs) under ${pathspec}.`);
  }
  noteUntrackedInput({ pathspec, suffix: "", include: isSource, gate: "core purity" });

  const violations = [];
  for (const file of files) {
    const text = readFileSync(resolve(REPO_ROOT, file), "utf8");
    for (const f of purityFindings(text, file)) {
      violations.push({ ...f, where: `${file}:${f.line}` });
    }
  }

  if (violations.length === 0) {
    console.warn(
      `core purity: OK -- ${files.length} file(s), no I/O, clock, randomness, `
        + "process state, locale, or model SDK in core/src.",
    );
    process.exit(0);
  }

  console.error(`core purity: ${violations.length} violation(s) in packages/core/src:`);
  for (const v of violations) {
    console.error(`  ${v.rule}  ${v.where}\n    ${v.text}\n    fix: ${v.fix}`);
  }
  console.error("\nDeterminism in core is a primary pillar. Move this to an outer");
  console.error("package (cli/mcp/vscode) or a connector, or pass the value in.");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
