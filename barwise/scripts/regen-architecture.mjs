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
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentSection, isAdr, renderSection } from "./lib/architecture-section.mjs";
import { opt } from "./lib/args.mjs";

// --root runs against another tree, for check:architecture's own tests.
const root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const DOC = join(root, "barwise", "docs", "ARCHITECTURE.md");
const isFile = (p) => {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
};
try {
  // The inputs as check:architecture reads them -- the tracked ADRs and
  // root's INTENDED -- because the section written here must be the one
  // the check renders, or the check reports stale a section no run of this
  // script can make current. A tracked path that is not a file on disk is
  // being deleted, and the check skips it too.
  const adrs = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => isAdr(f) && isFile(join(root, f)))
    .map((f) => ({ f, text: readFileSync(join(root, f), "utf8") }));
  if (adrs.length === 0) throw new Error(`no tracked ADR under ${root}`);
  const intended = createRequire(import.meta.url)(
    join(root, "barwise", "scripts", "lib", "intended.cjs"),
  );
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
