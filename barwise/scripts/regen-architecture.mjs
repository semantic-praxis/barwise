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
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentSection,
  isAdr,
  loadIntended,
  readFiles,
  renderSection,
  trackedPaths,
} from "./lib/architecture-section.mjs";
import { opt } from "./lib/args.mjs";

try {
  // Inside the refusal: a bare `--root` throws, and that is exit 2.
  // --root runs against another tree, for check:architecture's own tests.
  const root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const DOC = join(root, "barwise", "docs", "ARCHITECTURE.md");
  // The inputs exactly as check:architecture reads them (the shared reader).
  const adrs = readFiles(root, trackedPaths(root).filter(isAdr));
  if (adrs.length === 0) throw new Error(`no tracked ADR under ${root}`);
  const intended = loadIntended(root);
  const doc = readFileSync(DOC, "utf8");
  const now = currentSection(doc);
  if (now === null) throw new Error("ARCHITECTURE.md has no regen:architecture markers");
  const next = renderSection(adrs, intended);
  if (next === now) {
    console.log("regen:architecture: ARCHITECTURE.md is already current.");
  } else {
    // A function replacement, so a dollar sign in an ADR title is text and
    // not a replacement pattern.
    writeFileSync(DOC, doc.replace(now, () => next));
    console.log("regen:architecture: wrote the generated section of ARCHITECTURE.md.");
  }
} catch (err) {
  console.error(`regen:architecture: cannot answer -- ${err.message}`);
  process.exit(2);
}
