#!/usr/bin/env node
/**
 * The correction-record ratchet (barwise-1013).
 *
 * Specs record what their drafts got wrong and what caught it. The
 * 2026-09-11 hand pass read 52 such records across 28 specs and found
 * that roughly three quarters of spec defects were caught by executing
 * something, and that verbosity caused none of them
 * (docs/spec-correction-taxonomy-2026-09-11.md). That reading started
 * decaying the moment it was written: the next spec to record a
 * correction is outside it and nothing notices.
 *
 * So the classification becomes a baseline row instead of a document.
 * `--check` fails BOTH ways, like `audit:duplication` and
 * `audit:rubric`: on a detected record with no row, and on a row no
 * longer detected. The first forces a new correction to say what caught
 * it while the author still knows; the second stops the baseline
 * describing spec text that is no longer there.
 *
 * WHAT THIS DOES NOT DO. It does not judge whether a correction was
 * avoidable, and it cannot -- the draft it corrects is already gone. It
 * records what caught the defect, not what should have. Nor does it
 * classify automatically: keyword-matching the catch mechanism is the
 * shadow, and "grounding by reading code" versus "reasoning" is exactly
 * the boundary a keyword cannot see. The verdict is a human's.
 *
 * The detector is deliberately over-inclusive. A paragraph it surfaces
 * that is not a correction gets a row with `caught_by: not-a-correction`
 * and a reason, which is the same move audit-baseline.json makes for
 * deliberately parallel code -- and it turns the hand filtering behind
 * the taxonomy's "34 of 52" into an auditable record rather than a
 * judgement that happened once in a session.
 *
 * Spec: docs/specs/correction-record-ratchet.spec.md.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

const BASELINE = resolve(REPO_ROOT, "barwise", "correction-baseline.json");

/**
 * The corpus definition. Widening this surfaces new candidates and
 * fails --check until they are classified; that is the intended
 * behaviour, not a reason to narrow it back.
 *
 * `deviation` earns its place -- specs head their implementation notes
 * with it -- but it also matches `standard deviation` throughout the
 * eval specs, which is a statistic and not a correction. The guard is
 * below rather than in the pattern because a negative lookbehind here
 * would be one more thing to read correctly.
 */
const MARKERS = [
  /\bthe draft\b/i,
  /\bwas wrong\b/i,
  /\bturned out\b/i,
  /\bcorrected during grounding\b/i,
  /\bfound by verification\b/i,
  /\bdid not survive grounding\b/i,
  /\bcould not fail\b/i,
  /\bnot decidable as written\b/i,
  /\bdid not anticipate\b/i,
  /\bwas dropped\b/i,
  /\bdeviations?\b/i,
  // Catch language. Added after the detector missed the corpus's
  // clearest provenance record -- "And writing it down is what caught it
  // being wrong" (model-graph-and-id-spaces) -- which names a catch
  // mechanism explicitly and matched none of the markers above. A
  // paragraph saying what caught something is the most on-target content
  // this gate can find, so missing it was a detector bug rather than a
  // judgement call. Found by checking a known record against the
  // detector instead of assuming the marker list covered it.
  /\bcaught it\b/i,
  /\bwhat caught\b/i,
  /\bdid not catch\b/i,
];

const NOT_A_MARKER = [/\bstandard deviations?\b/i];

/** The permitted verdicts. A row outside this set fails the check. */
const CAUGHT_BY = new Set([
  // Implementing it, writing the test, re-running a count, probing a
  // tool, mutation, replaying recorded eval data.
  "execution",
  // An objection raised, a question asked, a reviewer's request --
  // before or without running anything.
  "reasoning",
  // Writing the claim down with the command that produced it, which is
  // what exposed the claim.
  "provenance",
  // The detector surfaced a paragraph that records no correction.
  "not-a-correction",
]);

/**
 * Paragraphs shorter than this carry a marker and no correction: a
 * bare heading ("### Deviations from the design") says one is coming
 * and records nothing about it. The record is the paragraph that
 * follows, which the detector picks up on its own.
 */
const MIN_WORDS = 12;

/**
 * An id that survives reformatting and moves when the claim changes.
 *
 * dprint owns docs/specs/*.md, so hashing raw bytes would re-key every
 * row the first time a paragraph reflowed -- reporting the whole
 * baseline stale and the whole corpus new, in one formatting commit.
 * Whitespace collapsed, markdown emphasis stripped, case folded: reflow
 * does not move it, an edited word does.
 */
function normalise(text) {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function recordId(spec, text) {
  const digest = createHash("sha256").update(normalise(text)).digest("hex");
  return `${spec.replace(/\.spec\.md$/, "")}::${digest.slice(0, 12)}`;
}

function markersIn(text) {
  let probe = text;
  for (const nm of NOT_A_MARKER) probe = probe.replace(new RegExp(nm.source, "gi"), "");
  return MARKERS.filter((m) => m.test(probe)).map((m) => m.source);
}

/** Every correction candidate in the tracked specs, in file order. */
function detect() {
  const specs = trackedFiles().filter(
    (f) =>
      f.startsWith("barwise/docs/specs/") && f.endsWith(".spec.md")
      && !f.includes("/archive/"),
  );

  // An empty spec listing is the reading that looks like success: every
  // check below filters this list, so zero specs reports "baseline
  // matches" having read nothing. trackedFiles() already refuses an
  // empty repository; this refuses an empty corpus.
  if (specs.length === 0) {
    process.stderr.write(
      "audit-corrections: no specs found under barwise/docs/specs/, so there is\n"
        + "  nothing to audit. Refusing rather than reporting a baseline match\n"
        + "  over an empty corpus.\n",
    );
    process.exit(2);
  }

  const found = [];
  for (const file of specs) {
    const name = file.slice("barwise/docs/specs/".length);
    const text = readFileSync(resolve(REPO_ROOT, file), "utf8");
    for (const para of text.split("\n\n")) {
      const p = para.trim();
      if (p.split(/\s+/).length < MIN_WORDS) continue;
      const hits = markersIn(p);
      if (hits.length === 0) continue;
      found.push({
        id: recordId(name, p),
        spec: name,
        markers: hits,
        excerpt: normalise(p).slice(0, 160),
      });
    }
  }
  return { specs, found };
}

function main() {
  const mode = process.argv[2];
  const { specs, found } = detect();

  if (mode === "--write") {
    const records = {};
    for (const r of found) {
      records[r.id] = {
        spec: r.spec,
        excerpt: r.excerpt,
        caught_by: "TODO: classify",
        note: "",
      };
    }
    writeFileSync(
      BASELINE,
      JSON.stringify({ $comment: BASELINE_COMMENT, records }, null, 2) + "\n",
    );
    console.log(`audit-corrections: wrote ${found.length} record(s) to correction-baseline.json`);
    return;
  }

  if (mode !== "--check") {
    console.log(`audit-corrections: ${found.length} record(s) in ${specs.length} spec(s)\n`);
    for (const r of found) console.log(`  ${r.id}\n    ${r.excerpt.slice(0, 110)}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const known = baseline.records ?? {};
  const problems = [];

  for (const r of found) {
    if (!(r.id in known)) {
      problems.push(
        `NEW correction record, not in the baseline:\n`
          + `    ${r.id}\n`
          + `    ${r.spec}: ${r.excerpt.slice(0, 110)}\n`
          + `    Add a row saying what caught it: ${[...CAUGHT_BY].join(", ")}.`,
      );
    }
  }

  const foundIds = new Set(found.map((r) => r.id));
  for (const [id, row] of Object.entries(known)) {
    if (!foundIds.has(id)) {
      problems.push(
        `Baseline entry no longer detected: ${id}\n`
          + `    ${row.spec ?? "(no spec)"}: ${(row.excerpt ?? "").slice(0, 110)}\n`
          + `    Its spec text was rewritten or removed; drop the row or re-add the record.`,
      );
      continue;
    }
    if (!CAUGHT_BY.has(row.caught_by)) {
      problems.push(
        `Baseline entry has no usable verdict: ${id}\n`
          + `    caught_by: ${JSON.stringify(row.caught_by)}\n`
          + `    Must be one of: ${[...CAUGHT_BY].join(", ")}.`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("\ncorrection audit failed:\n\n" + problems.join("\n\n") + "\n");
    process.exit(1);
  }
  console.log(
    `correction audit: baseline matches, ${found.length} record(s) in ${specs.length} spec(s).`,
  );
}

const BASELINE_COMMENT = "Correction records in docs/specs, from scripts/audit-corrections.mjs "
  + "(npm run audit:corrections -- --check; CI runs it). A spec that records what its "
  + "draft got wrong carries a verdict here saying what CAUGHT it -- execution, "
  + "reasoning, or provenance -- or not-a-correction when the detector over-matched. "
  + "--check fails on a detected record missing here AND on a row no longer detected, "
  + "so the file always enumerates exactly the corpus. The detector is deliberately "
  + "over-inclusive; the markers are in the script, which is their only home. "
  + "Seed and method: docs/spec-correction-taxonomy-2026-09-11.md. "
  + "Spec: docs/specs/correction-record-ratchet.spec.md.";

main();
