#!/usr/bin/env node
// Aligns markdown tables the way dprint's markdown plugin does: every
// cell padded to its column's widest cell, separator dashes spanning
// the full column width (`| --- |` style). Exists because dprint
// cannot run in the remote environment (its plugin CDN is blocked), so
// spec authors need a local way to produce tables that pass fmt:check.
//
// Usage: node scripts/align-md-tables.mjs <file.md> [more files...]
// Rewrites each file in place; prints which files changed.

import { readFileSync, writeFileSync } from "node:fs";

function alignTables(text) {
  const lines = text.split("\n");
  const out = [];
  let table = [];
  let fenced = false;

  const flush = () => {
    if (table.length === 0) return;
    const rows = table.map((ln) =>
      ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
    );
    const ncol = Math.max(...rows.map((r) => r.length));
    for (const r of rows) while (r.length < ncol) r.push("");
    const widths = new Array(ncol).fill(0);
    rows.forEach((r, i) => {
      if (i === 1) return; // separator row does not set widths
      r.forEach((c, j) => {
        widths[j] = Math.max(widths[j], c.length);
      });
    });
    rows.forEach((r, i) => {
      const cells = i === 1
        ? widths.map((w) => ` ${"-".repeat(w)} `)
        : r.map((c, j) => ` ${c.padEnd(widths[j])} `);
      out.push(`|${cells.join("|")}|`);
    });
    table = [];
  };

  for (const ln of lines) {
    if (ln.startsWith("```")) fenced = !fenced;
    if (!fenced && ln.startsWith("|")) {
      table.push(ln);
    } else {
      flush();
      out.push(ln);
    }
  }
  flush();
  return out.join("\n");
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/align-md-tables.mjs <file.md> [...]");
  process.exit(1);
}
for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = alignTables(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`aligned: ${file}`);
  } else {
    console.log(`unchanged: ${file}`);
  }
}
