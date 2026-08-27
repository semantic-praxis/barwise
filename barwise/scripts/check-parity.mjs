#!/usr/bin/env node
// check-parity.mjs -- byte-level agreement check over the declared
// must-agree sets in parity.manifest.json (drift-guards spec
// workstream 2, barwise-868).
//
// DRY is secondary in this codebase: deliberately parallel copies stay
// parallel. This check is the price of that trade -- every registered
// set's members must be identical, so editing one copy without its
// partners fails CI instead of drifting silently. A "Must match X"
// comment is not a check; a manifest entry is.
//
// Manifest shape (parity.manifest.json):
//   { "sets": [ { "name": "...", "why": "...",
//                 "ignore": "leading-docblock" | undefined,
//                 "members": [ "path/file.ts",
//                              { "file": "path/file.ts", "symbol": "fnName" } ] } ] }
//
// - A string member compares the whole file's text.
// - An object member compares the named top-level function
//   declaration's exact source text (leading comments excluded).
// - ignore: "leading-docblock" strips one leading /** ... */ block
//   (whole-file members only) -- the one sanctioned difference, for
//   files whose headers deliberately explain their own parallelism.
//   The vocabulary is capped on purpose: a pair needing more ignores
//   is not a parity pair; give it a behavioral test or a shared owner.
// - An unresolvable file or symbol is an error: a stale manifest is
//   itself drift.
//
// Run via `npm run check:parity` (CI runs it next to lint).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "parity.manifest.json"), "utf8"));
const failures = [];

function stripLeadingDocblock(text) {
  return text.replace(/^\/\*\*[\s\S]*?\*\/\s*\n/, "");
}

function symbolText(filePath, symbol) {
  const source = readFileSync(join(root, filePath), "utf8");
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  let found;
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) found = node;
    if (
      ts.isVariableStatement(node)
      && node.declarationList.declarations.some((d) => d.name.getText(sf) === symbol)
    ) found = node;
  });
  if (!found) {
    throw new Error(`${filePath}: no top-level declaration named "${symbol}"`);
  }
  return found.getText(sf);
}

function memberText(member, ignore) {
  if (typeof member === "string") {
    const text = readFileSync(join(root, member), "utf8");
    return ignore === "leading-docblock" ? stripLeadingDocblock(text) : text;
  }
  return symbolText(member.file, member.symbol);
}

function describeMember(member) {
  return typeof member === "string" ? member : `${member.file}#${member.symbol}`;
}

for (const set of manifest.sets) {
  try {
    const texts = set.members.map((m) => memberText(m, set.ignore));
    const [first, ...rest] = texts;
    rest.forEach((text, i) => {
      if (text !== first) {
        failures.push(
          `set "${set.name}": ${describeMember(set.members[i + 1])} differs from `
            + `${describeMember(set.members[0])}\n    why registered: ${set.why}\n`
            + `    Either restore the copies to agreement, or -- if they now have a real\n`
            + `    reason to differ -- retire this entry and give the pair a shared owner\n`
            + `    or a behavioral test in the same commit.`,
        );
      }
    });
  } catch (err) {
    failures.push(`set "${set.name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failures.length > 0) {
  console.error(`check-parity: ${failures.length} failure(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(
  `check-parity: ${manifest.sets.length} set(s), all members identical. OK`,
);
