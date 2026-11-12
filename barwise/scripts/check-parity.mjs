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
//                              { "file": "path/file.ts", "symbol": "fnName" },
//                              { "file": "pkg.json", "field": "engines.node" } ] } ] }
//
// - A string member compares the whole file's text.
// - A {file,symbol} member compares the named top-level function
//   declaration's exact source text (leading comments excluded).
// - A {file,field} member compares a VALUE resolved from a JSON file,
//   not text: `engines.node`, or `packages[""].engines.node` for a key
//   that is not a bare identifier (npm's lockfile names the root
//   package with the empty string). This form exists because a version
//   pinned in two files is the same must-agree copy as a duplicated
//   function, and it drifts the same way -- package.json said
//   engines.node >=26.0.0 while package-lock.json, which embeds its own
//   copy, said >=20.0.0, through a fully green CI run (barwise-919).
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
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

// Split a field path into keys. Bare segments are dot-separated;
// ["..."] carries a key that is not an identifier, which npm's lockfile
// needs -- it names the root package with the empty string.
export function parseFieldPath(path) {
  const keys = [];
  let i = 0;
  while (i < path.length) {
    const rest = path.slice(i);
    const bracket = /^\["((?:[^"\\]|\\.)*)"\]/.exec(rest);
    if (bracket) {
      keys.push(JSON.parse(`"${bracket[1]}"`));
      i += bracket[0].length;
      continue;
    }
    const bare = /^\.?([^.[]+)/.exec(rest);
    if (!bare) throw new Error(`unparseable field path "${path}" at offset ${i}`);
    keys.push(bare[1]);
    i += bare[0].length;
  }
  if (keys.length === 0) throw new Error(`empty field path`);
  return keys;
}

// The value at `fieldPath`, JSON-encoded so members compare by value.
// A missing key is an error, like a missing symbol: a manifest naming a
// field that no longer exists is itself drift.
export function fieldValue(filePath, fieldPath) {
  let cursor = JSON.parse(readFileSync(join(root, filePath), "utf8"));
  const keys = parseFieldPath(fieldPath);
  for (const [i, key] of keys.entries()) {
    if (cursor === null || typeof cursor !== "object" || !(key in cursor)) {
      const reached = keys.slice(0, i + 1).map((k) => JSON.stringify(k)).join(" -> ");
      throw new Error(`${filePath}: no value at ${reached} (field path "${fieldPath}")`);
    }
    cursor = cursor[key];
  }
  return JSON.stringify(cursor);
}

/**
 * The sanctioned differences between members, by name, with the transform
 * each applies; see the header. One table, so a name the manifest may use
 * is always one this check applies.
 */
const IGNORES = { "leading-docblock": stripLeadingDocblock };

function memberText(member, ignore) {
  if (typeof member === "string") {
    const text = readFileSync(join(root, member), "utf8");
    return ignore === undefined ? text : IGNORES[ignore](text);
  }
  if (member.field !== undefined) return fieldValue(member.file, member.field);
  return symbolText(member.file, member.symbol);
}

function describeMember(member) {
  if (typeof member === "string") return member;
  return `${member.file}#${member.field ?? member.symbol}`;
}

/**
 * What is wrong with a readable manifest's sets themselves, before any
 * member is read (must-agree-copies#registered-sets-identical,
 * barwise-ym8.8nq). Each is a finding, and names its set, which is then
 * not compared:
 *   - an `ignore` this check does not apply, or an `ignore` on a symbol
 *     or field set, which it used to skip without saying so;
 *   - fewer than two distinct members: a set that compares a copy with
 *     nothing, or with itself, checks nothing, which is how a
 *     half-retired entry used to pass.
 * Returns the problems, keyed by set index.
 */
export function validateManifest(manifest) {
  const problems = new Map();
  manifest.sets.forEach((set, i) => {
    const name = typeof set?.name === "string" ? set.name : `#${i}`;
    const add = (why) => problems.set(i, [...(problems.get(i) ?? []), `set "${name}": ${why}`]);
    if (!Array.isArray(set?.members)) {
      add("has no members array");
      return;
    }
    if (set.ignore !== undefined) {
      if (!Object.hasOwn(IGNORES, set.ignore)) {
        add(
          `ignore "${set.ignore}" is not one this check applies (${
            Object.keys(IGNORES).join(", ")
          })`,
        );
      } else if (!set.members.every((m) => typeof m === "string")) {
        add("ignore applies to whole-file members only, and this set has a symbol or field member");
      }
    }
    const distinct = new Set(set.members.map((m) => JSON.stringify(m))).size;
    if (distinct < 2) {
      add(
        `has ${distinct} distinct member(s), so it checks nothing; retire the entry with the `
          + "shared owner that replaced its copies, or restore the missing member",
      );
    }
  });
  return problems;
}

/**
 * Exit 0 every set agrees, 1 a finding (a set that differs, a member that
 * does not resolve, a set the manifest cannot mean), 2 the manifest itself
 * could not be read or has no sets (docs/adr/gate-refusal-contract.md).
 * `--manifest <path>` reads another manifest, for this gate's own tests;
 * members still resolve from the repository.
 */
function main() {
  let manifest;
  try {
    const i = process.argv.indexOf("--manifest");
    const path = i === -1 ? join(root, "parity.manifest.json") : resolve(process.argv[i + 1]);
    manifest = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(manifest?.sets)) throw new Error("it has no sets array");
    if (manifest.sets.length === 0) throw new Error("its sets array is empty");
  } catch (err) {
    console.error(`check-parity: cannot answer -- parity.manifest.json: ${err.message}`);
    process.exit(2);
  }
  const problems = validateManifest(manifest);
  const failures = [...problems.values()].flat();

  manifest.sets.forEach((set, i) => {
    if (problems.has(i)) return;
    try {
      const texts = set.members.map((m) => memberText(m, set.ignore));
      const [first, ...rest] = texts;
      rest.forEach((text, j) => {
        if (text !== first) {
          // Values are short enough to show; whole files are not.
          const shown = text.length + first.length < 120
            ? ` (${text} vs ${first})`
            : "";
          failures.push(
            `set "${set.name}": ${describeMember(set.members[j + 1])} differs from `
              + `${describeMember(set.members[0])}${shown}\n    why registered: ${set.why}\n`
              + `    Either restore the copies to agreement, or -- if they now have a real\n`
              + `    reason to differ -- retire this entry and give the pair a shared owner\n`
              + `    or a behavioral test in the same commit.`,
          );
        }
      });
    } catch (err) {
      failures.push(`set "${set.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  if (failures.length > 0) {
    console.error(`check-parity: ${failures.length} failure(s)`);
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
  console.log(
    `check-parity: ${manifest.sets.length} set(s), all members identical. OK`,
  );
}

// Only run the check when invoked as a command. The helpers above are
// pure and importable, which is what scripts/tests/gates-contract.test.mjs needs
// to show this gate red on a planted defect: `root` is script-relative
// by design (barwise-905), so a fixture repo cannot reach the loop.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
