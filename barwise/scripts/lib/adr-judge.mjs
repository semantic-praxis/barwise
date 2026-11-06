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
  GAP_LABEL,
  GATE_EXCEPTIONS,
  gateName,
  META_GATES,
  parseEnforcedBy,
  tagsIn,
} from "./adr-enforcement.mjs";
import { ADR_DIR, TESTED_IN } from "./architecture-section.mjs";
import { shouldRun } from "./ci-gates.mjs";
import { reportFor } from "./test-reports.mjs";

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
 * Whether a ci.yml step (as ci-occurrences.mjs reads it) can fail CI on
 * every code change: run in barwise/, never continue-on-error, under a guard
 * this reader understands and that runs it. The judgement the declaration
 * pass makes for an npm entry, for any other check that needs it.
 */
export const stepGates = (s) => {
  const g = guard(s.condition);
  return s.workingDirectory === "barwise" && s.continueOnError === false && g.understood && g.runs;
};

/**
 * Whether the code judge's reader needs the workflow reader: some ADR
 * declares a gate. ci-occurrences.mjs needs the `yaml` package, so a tree
 * with no such entry runs on builtins.
 */
export function needsWorkflow(adrs) {
  return adrs.some(({ text }) => parseEnforcedBy(text).entries.some((e) => e.kind === "npm"));
}

/**
 * Whether the judge looks an `npm` entry's script up at all: the gate-name
 * and meta-gate verdicts, as the finding's text, or `null` when the script
 * passes both. Shared, so the conformance model's fact builder writes a
 * "names script" fact exactly when the judge would look the script up.
 */
export function scriptVerdict(entry, adr) {
  const { script } = entry;
  if (!gateName(script)) {
    return `"${entry.text}": ${script} is not a gate name (check:*, audit:*, or one of`
      + ` ${Object.keys(GATE_EXCEPTIONS).join(", ")} in GATE_EXCEPTIONS)`;
  }
  if (Object.hasOwn(META_GATES, script) && !META_GATES[script].includes(adr)) {
    return `"${entry.text}": ${script} checks other gates and cannot vouch for this ADR`;
  }
  return null;
}

/**
 * Each ADR's `Enforced-by:` declarations, judged (check:architecture).
 * `reader` is createGovernanceReader()'s; `refusals` is the gate's list.
 * The five fact rules (listed ids exist, every decision has an entry, the
 * named script exists, the cited issue is tracked and open) are not judged
 * here but by the governance schema, through check:adr-model
 * (docs/specs/adr-conformance-model.spec.md, WS4). Where one of them cut a
 * verdict rule short, the judge still stops there, silently, so one defect
 * fails one gate. Returns the findings and `held`: how the decisions are
 * held, over every decision with an id
 * (docs/specs/enforceable-adr-practice.spec.md, WS2). A decision with an
 * `npm` entry has a gate; with `tests` and no `npm`, tests and no gate;
 * with only `none`, none only; `gap` counts any `none` entry, so it
 * overlaps the other three.
 */
export function judgeDeclarations(adrs, reader, refusals) {
  const problems = [];
  const held = { decisions: 0, gate: 0, testsOnly: 0, noneOnly: 0, gap: 0, none: 0 };
  // Each gap issue is one decision's own: the first entry to name an issue,
  // across every ADR, by file and entry text.
  const gapNamedBy = new Map();
  for (const { f, text } of adrs) {
    const parsed = parseEnforcedBy(text);
    const fail = (msg) => problems.push(`${f}: ${msg}`);
    if (!parsed.present) {
      fail(
        "no Enforced-by: header; every ADR names what holds each decision, and `none (<issue>: <id>)` for one with no enforcer",
      );
      continue;
    }
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
    // Each id an entry lists, with the kinds of entry that list it.
    const covered = new Map();
    for (const entry of parsed.entries) {
      for (const id of entry.ids) {
        if (!covered.has(id)) covered.set(id, new Set());
        covered.get(id).add(entry.kind);
      }
      if (entry.kind === "npm") {
        const { script } = entry;
        const verdict = scriptVerdict(entry, name);
        if (verdict !== null) {
          fail(verdict);
          continue;
        }
        // A silent guard: a script package.json lacks is check:adr-model's
        // finding (script-exists), and has no step to look up.
        const scripts = reader.scripts();
        if (scripts !== null && !Object.hasOwn(scripts, script)) continue;
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
        // These two need no tracker, so they are judged even when it is not
        // read: one decision per entry, and one entry per gap issue.
        if (entry.ids.length !== 1) {
          fail(
            `"${entry.text}": lists ${entry.ids.length} decisions; a none entry names one,`
              + " on that decision's own gap issue",
          );
        }
        const first = gapNamedBy.get(entry.issue);
        if (first === undefined) gapNamedBy.set(entry.issue, `${f}: "${entry.text}"`);
        else {
          fail(
            `"${entry.text}": ${entry.issue} is also named by ${first}; a gap issue is one decision's own`,
          );
        }
        const tracker = reader.issues();
        if (tracker === null) continue;
        const issue = tracker.get(entry.issue);
        // A silent guard: an issue missing or closed is check:adr-model's
        // finding (issue-tracked, issue-open), and reports only that, not
        // also its label or title.
        if (issue === undefined || issue.status === "closed") continue;
        // A labels field that is not a list is not the label, whatever it
        // holds: a string would otherwise match on a substring.
        if (!(Array.isArray(issue.labels) && issue.labels.includes(GAP_LABEL))) {
          fail(`"${entry.text}": ${entry.issue} does not carry the ${GAP_LABEL} label`);
        }
        // With more than one id there is no one decision for the title to
        // name; the finding above covers that entry. An id the ADR does not
        // have is check:adr-model's finding (ids-exist), reported only as
        // that. The space after the id keeps "decision four" from matching
        // "decision fourteen".
        if (entry.ids.length === 1 && ids.has(entry.ids[0])) {
          const prefix = `Gap: ${name} decision ${entry.ids[0]} `;
          if (!String(issue.title ?? "").startsWith(prefix)) {
            fail(
              `"${entry.text}": ${entry.issue}'s title does not begin "${prefix}"`
                + " (that prefix, a space, then what the gap is)",
            );
          }
        }
      }
    }
    // Every decision counts; the three buckets sum to those with an entry,
    // and `none` counts those without, which check:adr-model reports
    // (coverage), so the OK line never reads as covering them.
    for (const id of ids.keys()) {
      const kinds = covered.get(id);
      held.decisions++;
      if (kinds === undefined) {
        held.none++;
        continue;
      }
      if (kinds.has("npm")) held.gate++;
      else if (kinds.has("tests")) held.testsOnly++;
      else if (kinds.has("none")) held.noneOnly++;
      if (kinds.has("none")) held.gap++;
    }
  }
  return { problems, held };
}

const quoted = (titles) => titles.map((s) => `"${s}"`).join(", ");

/**
 * What a set of tagged tests answers, for the decision rule and the per-file
 * rule alike, so the two cannot order it differently: one passed proves it;
 * else one failed is an answer against; else any skipped (vitest's
 * `pending` is a test queued or cut short, never run) is "cannot tell",
 * with their titles; else (none, or only todos) there is no evidence.
 */
export function verdict(tests) {
  const statuses = new Set(tests.map((t) => t.status));
  if (statuses.has("passed")) return { kind: "passed" };
  if (statuses.has("failed")) return { kind: "failed" };
  const skipped = tests.filter((t) => t.status === "skipped" || t.status === "pending")
    .map((t) => t.title);
  return skipped.length > 0 ? { kind: "skipped", skipped } : { kind: "none" };
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

  // The evidence: each tagged test, by its own title, with its status.
  const tagged = new Map();
  for (const t of ran) {
    if (t.type !== "test") continue;
    for (const { adr, id } of tagsIn(t.title)) {
      const key = `${adr}#${id}`;
      if (!tagged.has(key)) tagged.set(key, []);
      tagged.get(key).push(t);
    }
  }
  let skipOnly = 0;
  let unproven = 0;
  const suiteOnly = new Set(
    ran.flatMap((t) => [...(t.type === "suite" ? [t.title] : []), ...t.ancestors])
      .flatMap((title) => tagsIn(title).map(({ adr, id }) => `${adr}#${id}`)),
  );
  for (const a of declaring) {
    for (const id of testedIds(a)) {
      const key = `${a.name}#${id}`;
      const v = verdict(tagged.get(key) ?? []);
      if (v.kind === "passed") continue;
      const hint = suiteOnly.has(key)
        ? "; the tag is on a describe, and must be on the test itself"
        : "";
      const message =
        `${a.f}: tests (${id}): no test carrying [adr:${key}] passed in this run${hint}`;
      if (v.kind === "failed") {
        findings.push(`${a.f}: tests (${id}): a test carrying [adr:${key}] failed in this run`);
      } else if (v.kind === "skipped") {
        skipOnly++;
        refusals.push(
          `${a.f}: tests (${id}): every test carrying [adr:${key}] skipped, so this run cannot`
            + ` tell: ${quoted(v.skipped)}`,
        );
      } else if (unreadableReports > 0) {
        // With a report missing or unreadable, its passing test may be the one
        // not read: the answer is "cannot tell", never the finding code.
        unproven++;
        refusals.push(`${message}, and ${unreadableReports} report(s) were not read`);
      } else findings.push(message);
    }
  }
  const tested = declaring.reduce((n, a) => n + testedIds(a).length, 0);
  return { findings, declaring: declaring.length, tested, skipOnly, unproven };
}

/**
 * Each tested-in row, judged file by file (check:adr-tests;
 * docs/specs/capability-matrix-check.spec.md, WS2). The decision rule above
 * is satisfied by one passing tagged test anywhere, so a decision held by a
 * test on each of two surfaces read as proven with one of them gone; a row
 * names the files that must each carry one. `testedIn` is readTestedIn()'s,
 * never null here. The verdicts per file are the decision rule's, in its
 * order: a pass proves it, a failure is a finding, all skipped is a
 * refusal, and none at all is a refusal while the file's own report is
 * unread (reportFor()) and a finding once it was read. A row whose decision is no `tests` entry, or
 * a path git does not track, is a finding: the row outlived what it named.
 * Returns the findings and the two refusal counts, which the gate prints
 * apart from the decision rule's.
 */
export function judgeTestedIn(adrs, reports, testedIn, refusals) {
  const findings = [];
  let skipOnly = 0;
  let unproven = 0;
  const { ran, unread } = reports;
  const testsEntries = new Map(
    adrs.map(({ f, text }) => [
      f.slice(ADR_DIR.length, -".md".length),
      new Set(
        parseEnforcedBy(text).entries.filter((e) => e.kind === "tests").flatMap((e) => e.ids),
      ),
    ]),
  );
  const keys = (title) => tagsIn(title).map((x) => `${x.adr}#${x.id}`);
  for (const { decision, files } of testedIn.rows) {
    const [adr, id] = decision.split("#");
    if (!testsEntries.get(adr)?.has(id)) {
      findings.push(
        `${TESTED_IN}: "${decision}" is not a tests entry of ${adr}'s Enforced-by; a row that outlived its decision`,
      );
      continue;
    }
    const tag = `[adr:${decision}]`;
    for (const file of files) {
      if (!testedIn.tracked.has(file)) {
        findings.push(`${TESTED_IN}: "${decision}" names ${file}, which git does not track`);
        continue;
      }
      const inFile = ran.filter((t) => t.file === file);
      const v = verdict(
        inFile.filter((t) => t.type === "test" && keys(t.title).includes(decision)),
      );
      if (v.kind === "passed") continue;
      const onSuite = inFile.some((t) =>
        (t.type !== "test" && keys(t.title).includes(decision))
        || t.ancestors.some((a) => keys(a).includes(decision))
      );
      const hint = onSuite ? "; the tag is on a describe, and must be on the test itself" : "";
      const message =
        `${TESTED_IN}: "${decision}": no test in ${file} carrying ${tag} passed in this run${hint}`;
      // Only the file's own report can hold its test: another report unread
      // leaves this file's answer standing.
      const own = reportFor(file);
      if (v.kind === "failed") {
        findings.push(
          `${TESTED_IN}: "${decision}": a test in ${file} carrying ${tag} failed in this run`,
        );
      } else if (v.kind === "skipped") {
        skipOnly++;
        refusals.push(
          `${TESTED_IN}: "${decision}": every test in ${file} carrying ${tag} skipped, so this run`
            + ` cannot tell: ${quoted(v.skipped)}`,
        );
      } else if (own !== null && unread.has(own)) {
        unproven++;
        refusals.push(`${message}, and its report ${own} was not read`);
      } else findings.push(message);
    }
  }
  return { findings, skipOnly, unproven };
}
