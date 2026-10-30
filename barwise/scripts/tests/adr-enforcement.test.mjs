/**
 * The one reader of an ADR's `Enforced-by:` header, decision ids and test
 * tags (docs/specs/executable-adrs.spec.md, WS1). `check:architecture`
 * and the generated index both read through it, so these cases pin what
 * an entry means, apart from what either caller does with it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decisionIds,
  gateName,
  parseEnforcedBy,
  parseEntry,
  splitEntries,
  tagsIn,
} from "../lib/adr-enforcement.mjs";

const adr = (headerLines, decision) =>
  `# A concern\n\nScope: process\nDate: 2026-10-24\n${headerLines}\n\n`
  + `## Context\n\nWhy.\n\n## Decision\n\n${decision}\n\n## Consequences\n\nWhat follows.\n`;

test("splitEntries splits at commas outside parentheses and reads a newline as a space", () => {
  assert.deepEqual(splitEntries("npm run check:x (a, b),\ntests (c)"), {
    parts: ["npm run check:x (a, b)", "tests (c)"],
    problem: null,
  });
  assert.match(splitEntries("tests (a").problem, /unclosed "\("/);
  assert.match(splitEntries("tests a)").problem, /unmatched "\)"/);
});

test("parseEntry reads each form exactly, and a leftover token is a problem", () => {
  assert.deepEqual(parseEntry("npm run check:x (a, b)"), {
    kind: "npm",
    script: "check:x",
    args: null,
    ids: ["a", "b"],
    text: "npm run check:x (a, b)",
  });
  assert.equal(parseEntry("npm run audit:y -- --check (a)").args, "--check");
  assert.deepEqual(parseEntry("tests (a)").ids, ["a"]);
  assert.deepEqual(parseEntry("none (barwise-920.k3x: a, b)"), {
    kind: "none",
    issue: "barwise-920.k3x",
    ids: ["a", "b"],
    text: "none (barwise-920.k3x: a, b)",
  });
  // A dropped comma joins two entries into one that matches no form.
  assert.match(parseEntry("npm run check:x (a) npm run check:y (b)").problem, /is not an entry/);
  assert.match(parseEntry("tests (A)").problem, /not a list of decision ids/);
  assert.match(parseEntry("none (gap-1: a)").problem, /is not an issue id/);
  assert.match(parseEntry("tests (a) extra").problem, /is not an entry/);
});

test("parseEnforcedBy reads the field through header(), and it must be the last field", () => {
  const ok = parseEnforcedBy(
    adr("Tracking: x\nEnforced-by: tests (a),\nnpm run check:x (b)", "1. **A.** {#a}"),
  );
  assert.equal(ok.present, true);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.entries.map((e) => e.kind), ["tests", "npm"]);
  assert.equal(parseEnforcedBy(adr("Tracking: x", "1. **A.**")).present, false);
  const late = parseEnforcedBy(adr("Enforced-by: tests (a)\nTracking: x", "1. **A.** {#a}"));
  assert.match(late.problems.join("\n"), /not the last header field \(Tracking follows it\)/);
  const empty = parseEnforcedBy(adr("Enforced-by:", "1. **A.** {#a}"));
  assert.match(empty.problems.join("\n"), /declares nothing/);
});

test("decisionIds finds the id after a bold title that wraps, and reports what is missing", () => {
  const { decisions, problems } = decisionIds(
    adr(
      "Tracking: x",
      "1. **One.** {#one} Text.\n2. **Two, whose title\n   wraps.** {#two} Text.\n"
        + "3. **Three.** Text with no id.\n4. **Four.** {#Bad_Id}\n5. Plain, no bold title.",
    ),
  );
  assert.deepEqual(
    decisions.map((d) => [d.n, d.id]),
    [[1, "one"], [2, "two"], [3, null], [4, null], [5, null]],
  );
  assert.match(problems.join("\n"), /decision 4 .*\{#Bad_Id\} is not a kebab-case id/);
  assert.match(problems.join("\n"), /decision 5 .*has no bold title/);
  // The malformed id is flagged so the caller does not also call it missing.
  assert.deepEqual(decisions.map((d) => d.malformed), [false, false, false, true, false]);
});

test("decisionIds ignores numbered lines inside a fenced block", () => {
  const { decisions, problems } = decisionIds(
    adr("Tracking: x", "1. **One.** {#one} Text.\n\n```text\n1. an example step\n2. another\n```"),
  );
  assert.deepEqual(decisions.map((d) => d.id), ["one"]);
  assert.deepEqual(problems, []);
  // A heading inside the fence ends neither the fence nor the section.
  const later = decisionIds(
    adr(
      "Tracking: x",
      "1. **One.** {#one}\n\n```markdown\n## Consequences\n1. not a decision\n```\n\n2. **Two.** {#two}",
    ),
  );
  assert.deepEqual(later.decisions.map((d) => d.id), ["one", "two"]);
});

test("decisionIds does not read an unclosed title into the next decision", () => {
  const { decisions, problems } = decisionIds(
    adr("Tracking: x", "1. **One. {#one}\n2. **Two.** {#two}"),
  );
  assert.deepEqual(decisions.map((d) => [d.n, d.id]), [[1, null], [2, "two"]]);
  assert.match(problems.join("\n"), /decision 1 .*its bold title does not close/);
});

test("tagsIn credits every tag in a title, not only the first", () => {
  assert.deepEqual(tagsIn("refuses a clock [adr:determinism-in-core#no-clock] [adr:x#pure-ids]"), [
    { adr: "determinism-in-core", id: "no-clock" },
    { adr: "x", id: "pure-ids" },
  ]);
  assert.deepEqual(tagsIn("no tag here [adr:Bad#x]"), []);
});

test("gateName admits check:*, audit:* and the named exceptions, and nothing else", () => {
  for (const s of ["check:x", "audit:specs", "purity", "depcruise"]) {
    assert.equal(gateName(s), true, s);
  }
  for (const s of ["lint", "test:coverage", "ci:local", "build", "checkx"]) {
    assert.equal(gateName(s), false, s);
  }
});
