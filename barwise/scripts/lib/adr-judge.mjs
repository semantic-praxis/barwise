/**
 * The rules behind the ADR governance gates, judging only what
 * scripts/lib/adr-facts.mjs answers (docs/specs/adr-gate-reader-split.spec.md).
 * Moved from check:architecture's declaration pass and from check:adr-tests
 * unchanged: the same order, the same short-circuits, the same messages.
 * Refusals go into the gate's own list, after or between the reader's, in
 * the order they arise.
 */
import {
  decisionIds,
  GATE_EXCEPTIONS,
  gateName,
  META_GATES,
  parseEnforcedBy,
  tagsIn,
} from "./adr-enforcement.mjs";
import { ADR_DIR } from "./architecture-section.mjs";
import { shouldRun } from "./ci-gates.mjs";

// A step counts as the gate's when it runs in barwise/, cannot be told to
// keep going on failure, and has a guard that runs it on every code change:
// for both optimizer values, since a gate that runs only on optimizer
// changes skips the rest.
const guard = (condition) => {
  const both = [true, false].map((optimizer) =>
    shouldRun(condition, { docsOnly: false, optimizer })
  );
  return { understood: both.every((r) => r.understood), runs: both.every((r) => r.run) };
};

/**
 * Each ADR's `Enforced-by:` declarations, judged (check:architecture).
 * `reader` is createGovernanceReader()'s; `refusals` is the gate's list.
 * Returns the findings and how many ADRs declare the header.
 */
export function judgeDeclarations(adrs, reader, refusals) {
  const problems = [];
  let declaring = 0;
  for (const { f, text } of adrs) {
    const parsed = parseEnforcedBy(text);
    const fail = (msg) => problems.push(`${f}: ${msg}`);
    if (!parsed.present) {
      fail(
        "no Enforced-by: header; every ADR names what holds each decision, and `none (<issue>: <ids>)` for one with no enforcer",
      );
      continue;
    }
    declaring++;
    const name = f.slice(ADR_DIR.length, -".md".length);
    for (const p of parsed.problems) fail(p);
    const { decisions, problems: decisionProblems } = decisionIds(text);
    for (const p of decisionProblems) fail(p);
    if (decisions.length === 0) fail("its ## Decision section has no numbered decision");
    const ids = new Map();
    for (const d of decisions) {
      // A malformed id was already reported by decisionIds().
      if (d.id === null) {
        if (!d.malformed) {
          fail(`decision ${d.n} (line ${d.line}) has no {#id} after its bold title`);
        }
      } else if (ids.has(d.id)) {
        fail(`decisions ${ids.get(d.id).n} and ${d.n} share the id ${d.id}`);
      } else ids.set(d.id, d);
    }
    const covered = new Set();
    for (const entry of parsed.entries) {
      for (const id of entry.ids) {
        if (!ids.has(id)) fail(`"${entry.text}" lists ${id}, which no decision here has`);
        covered.add(id);
      }
      if (entry.kind === "npm") {
        const { script } = entry;
        if (!gateName(script)) {
          fail(
            `"${entry.text}": ${script} is not a gate name (check:*, audit:*, or one of`
              + ` ${Object.keys(GATE_EXCEPTIONS).join(", ")} in GATE_EXCEPTIONS)`,
          );
          continue;
        }
        if (Object.hasOwn(META_GATES, script) && !META_GATES[script].includes(name)) {
          fail(`"${entry.text}": ${script} checks other gates and cannot vouch for this ADR`);
          continue;
        }
        const scripts = reader.scripts();
        if (scripts !== null && !Object.hasOwn(scripts, script)) {
          fail(`"${entry.text}": barwise/package.json has no script ${script}`);
          continue;
        }
        const want = entry.args === null
          ? `npm run ${script}`
          : `npm run ${script} -- ${entry.args}`;
        const matching = reader.steps(want);
        if (matching === null) continue;
        const inBarwise = matching.filter((s) => s.workingDirectory === "barwise");
        const judged = inBarwise.map((s) => ({ s, g: guard(s.condition) }));
        if (judged.some(({ s, g }) => s.continueOnError === false && g.understood && g.runs)) {
          continue;
        }
        // Unreadable means it might still qualify. An expression
        // continue-on-error on a step whose guard plainly never runs it on a
        // code change cannot qualify either way, so that stays a finding.
        const unreadable = judged
          .filter(({ s, g }) =>
            (s.continueOnError === null && (!g.understood || g.runs))
            || (s.continueOnError === false && !g.understood)
          )
          .map(({ s }) => s);
        if (unreadable.length > 0) {
          refusals.push(
            `${f}: "${entry.text}": cannot tell whether the step runs; its`
              + ` ${
                unreadable[0].continueOnError === null
                  ? "continue-on-error"
                  : `if: ${unreadable[0].condition}`
              }`
              + " is not a form this check reads",
          );
          continue;
        }
        const why = matching.length === 0
          ? `no ci.yml step's run: is exactly "${want}"`
          : inBarwise.length === 0
          ? `the step "${want}" does not run in barwise/`
          : inBarwise.some((s) => s.continueOnError === true)
          ? `the step "${want}" is continue-on-error, so it cannot fail CI`
          : `the step "${want}" has a guard that does not run it on every code change`;
        fail(`"${entry.text}": ${why}`);
      } else if (entry.kind === "none") {
        const tracker = reader.issues();
        if (tracker === null) continue;
        const issue = tracker.get(entry.issue);
        if (issue === undefined) {
          fail(`"${entry.text}": ${entry.issue} is not in .beads/issues.jsonl`);
        } else if (issue.status === "closed") {
          fail(
            `"${entry.text}": ${entry.issue} is closed; declare the enforcer it built, or reopen it`,
          );
        }
      }
    }
    for (const [id, d] of ids) {
      if (!covered.has(id)) fail(`decision ${d.n} {#${id}} has no Enforced-by: entry`);
    }
  }
  return { problems, declaring };
}

/**
 * Each tested decision, and each tag, judged against the tests that ran
 * (check:adr-tests). `reports` is readTestReports()'s; `refusals` is the
 * gate's list, holding the report refusals already, and the judge appends
 * after them. The unread count is `reports.unreadable`, fixed at read time:
 * the list's length grows here.
 */
export function judgeTestedDecisions(adrs, reports, refusals) {
  const findings = [];
  const { ran, unreadable: unreadableReports } = reports;
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

  // The evidence: a test, by its own title, that passed. Beside it, by
  // decision, the tagged tests that failed (an answer) and that skipped (none).
  const passed = new Set();
  const failed = new Set();
  const skipped = new Map();
  for (const t of ran) {
    if (t.type !== "test") continue;
    for (const { adr, id } of tagsIn(t.title)) {
      const key = `${adr}#${id}`;
      if (t.status === "passed") passed.add(key);
      else if (t.status === "failed") failed.add(key);
      else if (t.status === "skipped" || t.status === "pending") {
        if (!skipped.has(key)) skipped.set(key, []);
        skipped.get(key).push(t.title);
      }
    }
  }
  let skipOnly = 0;
  const quoted = (titles) => titles.map((s) => `"${s}"`).join(", ");
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
      if (failed.has(key)) {
        findings.push(`${a.f}: tests (${id}): a test carrying [adr:${key}] failed in this run`);
      } else if (skipped.has(key)) {
        skipOnly++;
        refusals.push(
          `${a.f}: tests (${id}): every test carrying [adr:${key}] skipped, so this run cannot`
            + ` tell: ${quoted(skipped.get(key))}`,
        );
      } else if (unreadableReports > 0) {
        // With a report missing or unreadable, its passing test may be the one
        // not read: the answer is "cannot tell", never the finding code.
        refusals.push(`${unproven}, and ${unreadableReports} report(s) were not read`);
      } else findings.push(unproven);
    }
  }
  const tested = declaring.reduce((n, a) => n + testedIds(a).length, 0);
  return { findings, declaring: declaring.length, tested, skipOnly };
}
