#!/usr/bin/env node
/**
 * Refuse NUL bytes in tracked source.
 *
 * A NUL makes git classify the file as BINARY, and the consequences are
 * silent and total: `git diff` prints "Binary files differ", `git log
 * --stat` reports `Bin 0 -> 4983 bytes, 0 insertions(+), 0 deletions(-)`,
 * a patch taken from it loses every change, GitHub shows "Binary file not
 * shown" in review, and `grep` answers "binary file matches" instead of
 * the line.
 *
 * Four files had reached main this way, all writing the same idiom -- NUL
 * as a composite-key delimiter, chosen because it cannot collide with an
 * identifier. The intent is sound and the side effect is not: one of the
 * four had never been diffable in its history, so nothing it ever
 * contained had been reviewable, and a patch taken from another silently
 * dropped a day's work. No other gate notices; dprint, tsc, eslint and
 * oxlint all accept NUL happily.
 *
 * `JSON.stringify([a, b])` is the replacement used throughout: printable,
 * and collision-proof in a way a chosen delimiter can only approximate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const TEXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonl",
  ".md",
  ".yaml",
  ".yml",
  ".py",
  ".sh",
  ".txt",
  ".css",
  ".html",
  ".toml",
]);

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}).split("\0").filter(Boolean);

const offenders = [];
for (const file of tracked) {
  if (!TEXT.has(extname(file))) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted in the working tree; not this gate's business
  }
  const at = buf.indexOf(0);
  if (at !== -1) {
    const line = buf.subarray(0, at).toString("utf8").split("\n").length;
    offenders.push({ file, line, count: buf.filter((b) => b === 0).length });
  }
}

if (offenders.length > 0) {
  console.error("NUL bytes in tracked source -- git will treat these as binary:\n");
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  (${o.count} NUL byte(s))`);
  }
  console.error(
    "\nA binary file has no diff, no blame and no review, and a patch taken\n"
      + "from it loses changes silently. If the NUL is a composite-key\n"
      + "delimiter, use JSON.stringify([a, b]) instead -- printable, and\n"
      + "collision-proof rather than merely unlikely.",
  );
  process.exit(1);
}
console.log(`check-no-nul: ${tracked.length} tracked files, no NUL bytes in source. OK`);
