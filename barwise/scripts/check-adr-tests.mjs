#!/usr/bin/env node
/**
 * A decision an ADR declares as `tests (<ids>)` is pinned by a test that
 * ran and passed in this CI run (docs/specs/executable-adrs.spec.md, WS2).
 *
 * The evidence is what the runners report, not what the source says: a test
 * carries `[adr:<adr>#<id>]` in its own title, vitest's json reporter and
 * scripts/lib/test-tag-reporter.mjs write every test that ran with its
 * status, and this check reads those reports. A skipped or todo test, a
 * test inside a skipped suite, a loop-built title and a tag quoted in a
 * fixture all settle themselves: none reaches a report as a passed test.
 *
 * Findings, exit 1:
 *   - a `tests` entry lists an id with no passed test carrying its tag,
 *     when every report was read (with one unread, that is a refusal);
 *   - a reported test or suite carries a tag naming an ADR that does not
 *     exist or an id that ADR does not have (a tag that outlived its
 *     decision). A tag on a suite never counts as a passed test; it is read
 *     only to be reported, so an author learns why the decision reads as
 *     untested (barwise-ym8.7jz, item 7).
 * Refusals, exit 2: a report this run should have written is missing or is
 * not the shape this check reads -- a vitest upgrade that renamed a field
 * must stop the check, not pass it. The expected reports are derived: one
 * per package with a `test:coverage` script, one per file in
 * scripts/tests/expected-counts.json, and the `test:trial` report.
 * Any finding is exit 1, with the refusals listed beside it.
 *
 * It runs in CI after the test steps, on the same guard; on a docs-only
 * change no test ran, and an ADR change is not docs-only
 * (scripts/lib/changed-class.mjs).
 *
 * `--root <dir>` reads another tree, for this check's own tests.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decisionIds, parseEnforcedBy, tagsIn } from "./lib/adr-enforcement.mjs";
import { ADR_DIR, isAdr, readFiles, trackedPaths } from "./lib/architecture-section.mjs";
import { opt } from "./lib/args.mjs";
import { scriptReport, TRIAL_REPORT, vitestReport } from "./lib/test-reports.mjs";

const findings = [];
const refusals = [];

/** Each test or suite a report says ran: `{ title, ancestors, type, status, from }`. */
function readVitest(path, rel) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(json?.testResults)) throw new Error("no testResults array");
  const out = [];
  for (const file of json.testResults) {
    if (!Array.isArray(file?.assertionResults)) {
      throw new Error("a testResults entry has no assertionResults");
    }
    for (const a of file.assertionResults) {
      if (
        typeof a?.title !== "string" || typeof a?.status !== "string"
        || !Array.isArray(a.ancestorTitles)
      ) {
        throw new Error("an assertionResult has no title, status or ancestorTitles");
      }
      out.push({
        title: a.title,
        ancestors: a.ancestorTitles,
        type: "test",
        status: a.status,
        from: rel,
      });
    }
  }
  return out;
}

function readNodeTest(path, rel) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line);
    if (
      typeof r?.name !== "string" || typeof r?.status !== "string" || typeof r?.type !== "string"
    ) {
      throw new Error("a line has no name, status or type");
    }
    out.push({ title: r.name, ancestors: [], type: r.type, status: r.status, from: rel });
  }
  return out;
}

let root, adrs, ran;
try {
  root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  adrs = readFiles(root, trackedPaths(root).filter(isAdr));
  if (adrs.length === 0) throw new Error(`no ADR under ${join(root, ADR_DIR)}`);
} catch (err) {
  console.error(`check:adr-tests: cannot answer -- ${err.message}`);
  process.exit(2);
}

// The ADRs that declare tests. The reports are read even when none does:
// a stale tag in a test is a finding whatever the headers say.
const declaring = adrs
  .map(({ f, text }) => ({
    f,
    name: f.slice(ADR_DIR.length, -".md".length),
    text,
    parsed: parseEnforcedBy(text),
  }))
  .filter((a) => a.parsed.present);
const testedIds = (a) => a.parsed.entries.filter((e) => e.kind === "tests").flatMap((e) => e.ids);

// Every report this run should have written.
const expected = [];
try {
  const pkgs = join(root, "barwise", "packages");
  for (const dir of readdirSync(pkgs, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifest = join(pkgs, dir.name, "package.json");
    if (!existsSync(manifest)) continue;
    const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
    if (Object.hasOwn(scripts, "test:coverage")) {
      expected.push({ rel: vitestReport(dir.name), read: readVitest });
    }
  }
  const counts = JSON.parse(
    readFileSync(join(root, "barwise", "scripts", "tests", "expected-counts.json"), "utf8"),
  );
  for (const file of Object.keys(counts.counts ?? {})) {
    expected.push({ rel: scriptReport(file), read: readNodeTest });
  }
  expected.push({ rel: TRIAL_REPORT, read: readNodeTest });
} catch (err) {
  console.error(`check:adr-tests: cannot answer -- the list of reports: ${err.message}`);
  process.exit(2);
}

ran = [];
for (const { rel, read } of expected) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    refusals.push(`${rel}: missing; did its test step run in this checkout?`);
    continue;
  }
  try {
    ran.push(...read(path, rel));
  } catch (err) {
    refusals.push(`${rel}: not a report this check reads (${err.message})`);
  }
}

const unreadableReports = refusals.length;

// Stale tags: on a test or a suite, in its own title or an enclosing one.
const idsOf = new Map(
  adrs.map(({ f, text }) => [
    f.slice(ADR_DIR.length, -".md".length),
    new Set(decisionIds(text).decisions.map((d) => d.id).filter(Boolean)),
  ]),
);
const seenStale = new Set();
for (const t of ran) {
  for (const title of [t.title, ...t.ancestors]) {
    for (const { adr, id } of tagsIn(title)) {
      const key = `${adr}#${id}`;
      if (seenStale.has(key)) continue;
      const ids = idsOf.get(adr);
      const why = ids === undefined
        ? `names ADR ${adr}, which does not exist`
        : !ids.has(id)
        ? `names ${id}, which ${adr} has no decision with`
        : null;
      if (why === null) continue;
      seenStale.add(key);
      findings.push(`[adr:${key}] in "${title}" (${t.from}) ${why}`);
    }
  }
}

// The evidence: a test, by its own title, that passed.
const passed = new Set();
for (const t of ran) {
  if (t.type !== "test" || t.status !== "passed") continue;
  for (const { adr, id } of tagsIn(t.title)) passed.add(`${adr}#${id}`);
}
const suiteOnly = new Set(
  ran.flatMap((t) => [...(t.type === "suite" ? [t.title] : []), ...t.ancestors])
    .flatMap((title) => tagsIn(title).map(({ adr, id }) => `${adr}#${id}`)),
);
for (const a of declaring) {
  for (const id of testedIds(a)) {
    const key = `${a.name}#${id}`;
    if (passed.has(key)) continue;
    const hint = suiteOnly.has(key)
      ? "; the tag is on a describe, and must be on the test itself"
      : "";
    const unproven =
      `${a.f}: tests (${id}): no test carrying [adr:${key}] passed in this run${hint}`;
    // With a report missing or unreadable, its passing test may be the one
    // not read: the answer is "cannot tell", never the finding code.
    if (unreadableReports > 0) {
      refusals.push(`${unproven}, and ${unreadableReports} report(s) were not read`);
    } else findings.push(unproven);
  }
}

if (findings.length > 0) {
  console.error(`check:adr-tests: FAIL -- ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
}
if (refusals.length > 0) {
  console.error(`check:adr-tests: cannot answer for ${refusals.length} report(s):`);
  for (const r of refusals) console.error(`  ${r}`);
}
if (findings.length > 0) process.exit(1);
if (refusals.length > 0) process.exit(2);
const tested = declaring.reduce((n, a) => n + testedIds(a).length, 0);
console.log(
  `check:adr-tests: ${tested} tested decision(s) across ${declaring.length} ADR(s) each have a`
    + ` passing tagged test, in ${expected.length} report(s) of ${ran.length} test(s). OK`,
);
