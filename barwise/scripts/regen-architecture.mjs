#!/usr/bin/env node
/**
 * Rewrite the generated first section of barwise/docs/ARCHITECTURE.md from
 * the ADRs and INTENDED (docs/specs/architecture-index.spec.md, WS3).
 * Writes only between the markers; the rest of the file is the hand-written
 * design record. check:architecture fails when the section is stale.
 *
 *   npm run regen:architecture
 *
 * Exit 0 written (or already current), 2 when an input cannot be read, the
 * markers are missing, or there is no ADR -- a parse failure must not
 * write an empty index.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentSection, renderSection } from "./lib/architecture-section.mjs";
import { opt } from "./lib/args.mjs";

// --root runs against another tree, for check:architecture's own tests.
const root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const ADR_DIR = "barwise/docs/adr/";
const DOC = join(root, "barwise", "docs", "ARCHITECTURE.md");
try {
  const adrs = readdirSync(join(root, ADR_DIR))
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .sort()
    .map((n) => ({ f: ADR_DIR + n, text: readFileSync(join(root, ADR_DIR, n), "utf8") }));
  if (adrs.length === 0) throw new Error(`no ADR under ${ADR_DIR}`);
  const intended = createRequire(import.meta.url)("./lib/intended.cjs");
  const doc = readFileSync(DOC, "utf8");
  const now = currentSection(doc);
  if (now === null) throw new Error("ARCHITECTURE.md has no regen:architecture markers");
  const next = renderSection(adrs, intended);
  if (next === now) {
    console.log("regen:architecture: ARCHITECTURE.md is already current.");
  } else {
    writeFileSync(DOC, doc.replace(now, next));
    console.log("regen:architecture: wrote the generated section of ARCHITECTURE.md.");
  }
} catch (err) {
  console.error(`regen:architecture: cannot answer -- ${err.message}`);
  process.exit(2);
}
