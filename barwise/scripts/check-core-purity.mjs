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
// It reads TypeScript's own view of each file, not its lines: module
// references from `ts.preProcessFile` (static and dynamic imports,
// `export ... from`, `require`, type imports) and names from
// `ts.createScanner` tokens. The line-pattern version it replaces skipped
// any line that started with a comment, so `/* c8 ignore */ import ...
// from "node:fs"` passed (barwise-ym8.iyw), and a regex cannot tell a
// name from the same word in a string or comment. A hand-written comment
// stripper was rejected too: the one in `llm` goes out of phase on three
// core files with a quote in a regex literal. With tokens, a comment or a
// string can neither hide a violation nor raise one.
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

/**
 * Every rule, by id. `kind` says which reading finds it: `module` matches a
 * module specifier from preProcessFile, `name` an Identifier token, and
 * `sequence`/`import` the token shapes below.
 */
export const PURITY_RULES = [
  { id: "S-DET-1", name: "node:fs", kind: "module", modules: ["fs"], fix: IO_FIX },
  {
    id: "S-DET-1",
    name: "node:child_process",
    kind: "module",
    modules: ["child_process"],
    fix: IO_FIX,
  },
  { id: "S-DET-1", name: "node:os", kind: "module", modules: ["os"], fix: IO_FIX },
  {
    id: "S-DET-1",
    name: "network module",
    kind: "module",
    modules: ["net", "http", "https", "tls", "dgram", "http2", "dns", "undici"],
    fix: IO_FIX,
  },
  {
    id: "S-DET-1",
    name: "ambient runtime module",
    kind: "module",
    modules: ["process", "module", "worker_threads", "readline", "vm", "perf_hooks"],
    fix: IO_FIX,
  },
  {
    id: "S-DET-1",
    name: "model SDK",
    kind: "module",
    modules: ["@anthropic-ai/sdk", "openai"],
    fix: SDK_FIX,
  },
  {
    id: "S-DET-1",
    name: "runtime import()",
    kind: "import",
    fix: 'use a static import; only type forms import("x").T and typeof import("x") are allowed',
  },
  { id: "S-DET-3", name: "process", kind: "name", names: ["process"], fix: IO_FIX },
  { id: "S-DET-1", name: "network call", kind: "name", names: ["fetch"], fix: IO_FIX },
  { id: "S-DET-3", name: "clock", kind: "name", names: ["performance"], fix: "pass the time in" },
  {
    id: "S-DET-3",
    name: "process locale",
    kind: "name",
    names: [
      "localeCompare",
      "toLocaleString",
      "toLocaleUpperCase",
      "toLocaleLowerCase",
      "Intl",
    ],
    fix: LOCALE_FIX,
  },
  {
    id: "S-DET-2",
    name: "randomness",
    kind: "name",
    names: ["randomUUID", "randomBytes", "randomInt", "getRandomValues"],
    fix: "pass the id or seed in",
  },
  {
    id: "S-DET-3",
    name: "new Date()",
    kind: "sequence",
    tokens: ["new", "Date"],
    fix: "pass the time in",
  },
  {
    id: "S-DET-3",
    name: "Date.now()",
    kind: "sequence",
    tokens: ["Date", ".", "now"],
    fix: "pass the time in",
  },
  {
    id: "S-DET-2",
    name: "Math.random()",
    kind: "sequence",
    tokens: ["Math", ".", "random"],
    fix: "pass the seed in",
  },
  {
    id: "S-DET-2",
    name: "global crypto.*",
    kind: "sequence",
    tokens: ["crypto", "."],
    fix: "pass the id or seed in",
  },
];

/** `node:fs/promises` -> `fs`, `openai/resources` -> `openai`, `@a/b/c` -> `@a/b`. */
function moduleBase(specifier) {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const parts = bare.split("/");
  return bare.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Tokens after which a `/` starts a regular expression rather than a
 * division. The scanner does not know expression context, so without this
 * a regex literal's body would be read as names (`/process/` would raise
 * `process`), and a quote inside one would misread the rest of the file.
 * Every other token -- an Identifier, a literal, `)`, `]`, `}`, `++`, `--`,
 * and keywords such as `this` -- ends an expression, so `/` there divides.
 */
function regexMayFollow(kind) {
  const K = ts.SyntaxKind;
  if (kind === undefined) return true;
  if (
    kind === K.Identifier
    || kind === K.CloseParenToken
    || kind === K.CloseBracketToken
    || kind === K.CloseBraceToken
    || kind === K.PlusPlusToken
    || kind === K.MinusMinusToken
    || kind === K.NumericLiteral
    || kind === K.BigIntLiteral
    || kind === K.StringLiteral
    || kind === K.RegularExpressionLiteral
    || kind === K.NoSubstitutionTemplateLiteral
    || kind === K.TemplateTail
  ) {
    return false;
  }
  if (kind >= K.FirstKeyword && kind <= K.LastKeyword) {
    return [
      K.ReturnKeyword,
      K.TypeOfKeyword,
      K.CaseKeyword,
      K.DoKeyword,
      K.ElseKeyword,
      K.InKeyword,
      K.InstanceOfKeyword,
      K.NewKeyword,
      K.OfKeyword,
      K.ThrowKeyword,
      K.VoidKeyword,
      K.DeleteKeyword,
      K.YieldKeyword,
      K.AwaitKeyword,
    ].includes(kind);
  }
  return true;
}

/** The file's tokens, comments and whitespace skipped: `{ kind, text, pos }`. */
function tokens(text, fileName) {
  const K = ts.SyntaxKind;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    fileName.endsWith(".tsx") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  );
  const out = [];
  // Brace depth at each open `${`, so the `}` that closes a substitution is
  // rescanned as the template's continuation instead of a block's end.
  const templates = [];
  let braces = 0;
  for (let kind = scanner.scan(); kind !== K.EndOfFileToken; kind = scanner.scan()) {
    const prev = out.at(-1)?.kind;
    if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && regexMayFollow(prev)) {
      kind = scanner.reScanSlashToken();
    } else if (kind === K.OpenBraceToken) {
      braces++;
    } else if (kind === K.CloseBraceToken) {
      if (templates.at(-1) === braces) {
        templates.pop();
        kind = scanner.reScanTemplateToken(false);
      } else {
        braces--;
      }
    }
    if (kind === K.TemplateHead || kind === K.TemplateMiddle) templates.push(braces);
    out.push({ kind, text: scanner.getTokenText(), pos: scanner.getTokenStart() });
  }
  return out;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function closingParen(toks, open) {
  const K = ts.SyntaxKind;
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].kind === K.OpenParenToken) depth++;
    else if (toks[i].kind === K.CloseParenToken && --depth === 0) return i;
  }
  return -1;
}

/**
 * `import(` is allowed only in its two type forms: `import("x").Ident`
 * where Ident is not a promise method, and `typeof import("x")`. The rule
 * is stated as the allowed shapes, not the bad ones, because listing bad
 * shapes missed `return import(...)` and `Promise.all([import(...)])`
 * (plan review).
 */
function isTypeImport(toks, i) {
  const K = ts.SyntaxKind;
  if (toks[i - 1]?.kind === K.TypeOfKeyword) return true;
  const close = closingParen(toks, i + 1);
  if (close < 0) return false;
  const dot = toks[close + 1];
  const name = toks[close + 2];
  return dot?.kind === K.DotToken
    && name?.kind === K.Identifier
    && !["then", "catch", "finally"].includes(name.text);
}

/**
 * Every purity finding in one file's text: `[{ rule, line, text, fix }]`,
 * where `rule` is `"<id> <name>"` and `line` is 1-based.
 */
export function purityFindings(fileText, fileName) {
  const K = ts.SyntaxKind;
  const starts = lineStarts(fileText);
  const lines = fileText.split("\n");
  const lineOf = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const findings = [];
  const add = (rule, pos) => {
    const line = lineOf(pos);
    findings.push({
      rule: `${rule.id} ${rule.name}`,
      line,
      text: lines[line - 1].trim().slice(0, 90),
      fix: rule.fix,
    });
  };

  const moduleRules = PURITY_RULES.filter((r) => r.kind === "module");
  const { importedFiles } = ts.preProcessFile(fileText, true, true);
  for (const ref of importedFiles) {
    const base = moduleBase(ref.fileName);
    for (const rule of moduleRules) if (rule.modules.includes(base)) add(rule, ref.pos);
  }

  const toks = tokens(fileText, fileName);
  const importRule = PURITY_RULES.find((r) => r.kind === "import");
  const nameRules = PURITY_RULES.filter((r) => r.kind === "name");
  const sequenceRules = PURITY_RULES.filter((r) => r.kind === "sequence");
  toks.forEach((tok, i) => {
    if (
      tok.kind === K.ImportKeyword
      && toks[i + 1]?.kind === K.OpenParenToken
      && !isTypeImport(toks, i)
    ) {
      add(importRule, tok.pos);
    }
    if (tok.kind === K.Identifier) {
      for (const rule of nameRules) if (rule.names.includes(tok.text)) add(rule, tok.pos);
    }
    for (const rule of sequenceRules) {
      if (rule.tokens.every((t, k) => toks[i + k]?.text === t)) add(rule, tok.pos);
    }
  });
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
  const isSource = (f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f);
  const files = listing.split("\0").filter(Boolean).filter(isSource);
  if (files.length === 0) {
    refuse(`no tracked .ts/.tsx files under ${pathspec}.`);
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
