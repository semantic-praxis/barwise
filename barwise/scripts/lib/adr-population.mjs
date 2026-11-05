/**
 * The facts the ADR governance schema judges, built from what the
 * governance reader answers, and the schema's verdict on them
 * (docs/specs/adr-conformance-model.spec.md).
 *
 * check:adr-model judges five rules with it (WS4), which check:architecture
 * no longer judges. The builder asks the reader what check:architecture
 * asks for the same entries, and no more: `scripts()` only for an npm
 * entry the shared `scriptVerdict` lets through, `issues()` only for a
 * `none` entry, never the workflow. When an input cannot be read the
 * reader answers `null` and records the refusal, and the builder writes
 * none of the facts that would oblige anything of it, so the model reports
 * nothing it cannot answer. An ADR with no `Enforced-by:` header gets no
 * facts at all: check:architecture reports the missing header.
 */
import { decisionIds, parseEnforcedBy } from "./adr-enforcement.mjs";
import { scriptVerdict } from "./adr-judge.mjs";
import { ADR_DIR } from "./architecture-section.mjs";

/**
 * The five fact rules: the governance schema states each as a subset
 * constraint whose id is the rule's id, and check:adr-model judges them.
 * A chain is the rules one stops short, ranked in the order they are
 * checked: an issue not in the tracker is reported only as that, not also
 * as not open. A rule that cuts nothing short is a chain of one. The key
 * is the one value a finding is about: the decision `<adr>#<id>`, the
 * script, or the issue.
 */
export const RULES = [
  { id: "ids-exist", chain: "ids-exist", rank: 1, key: "decision" },
  { id: "coverage", chain: "coverage", rank: 1, key: "decision" },
  { id: "script-exists", chain: "script-exists", rank: 1, key: "script" },
  { id: "issue-tracked", chain: "issue", rank: 1, key: "issue" },
  { id: "issue-open", chain: "issue", rank: 2, key: "issue" },
];

/**
 * Each fact type the builder writes: its id and its two role ids, as
 * `governance.orm.yaml` states them (format 4.0 keeps them as written).
 * `adr-facts.test.mjs` holds each to the schema file, since core reports a
 * misspelled role only as an incomplete instance and a misspelled fact
 * type only as a load failure.
 */
export const ROLES = {
  has: [
    "Decision_belongs_to_ADR",
    "Decision_belongs_to_ADR.belongs_to",
    "Decision_belongs_to_ADR.has",
  ],
  lists: [
    "Entry_lists_Decision",
    "Entry_lists_Decision.lists",
    "Entry_lists_Decision.is_listed_by",
  ],
  names: ["Entry_names_Script", "Entry_names_Script.names", "Entry_names_Script.is_named_by"],
  defines: [
    "Package_defines_Script",
    "Package_defines_Script.is_defined_by",
    "Package_defines_Script.defines",
  ],
  cites: ["Entry_cites_Issue", "Entry_cites_Issue.cites", "Entry_cites_Issue.is_cited_by"],
  tracked: [
    "Issue_is_tracked_in_Tracker",
    "Issue_is_tracked_in_Tracker.is_tracked_in",
    "Issue_is_tracked_in_Tracker.tracks",
  ],
  open: [
    "Issue_is_open_in_Tracker",
    "Issue_is_open_in_Tracker.is_open_in",
    "Issue_is_open_in_Tracker.holds_open",
  ],
};

/** The entry key a fact names: the ADR and the entry's position. */
export const entryKey = (adr, position) => `${adr}:${position}`;

/**
 * The populations, by fact type id, as rows of role values; `entries`,
 * from entry key to `{ adr, file, position, ids, text }`, so a violation of
 * a rule keyed by a decision, script or issue can be expanded to the
 * entries that carry it; and `decisions`, from `<adr>#<id>` to
 * `{ file, n }`. The file, entry text and decision number are what the
 * findings' messages quote.
 */
export function build(adrs, reader) {
  const pops = {};
  const entries = new Map();
  const decisions = new Map();
  const fact = (kind, a, b) => {
    const [ft, ra, rb] = ROLES[kind];
    (pops[ft] ??= []).push({ [ra]: a, [rb]: b });
  };
  let askedScripts = false;
  let askedIssues = false;
  for (const { f, text } of adrs) {
    const adr = f.slice(ADR_DIR.length, -".md".length);
    const parsed = parseEnforcedBy(text);
    if (!parsed.present) continue;
    // Facts are sets: a repeated id or entry would break the schema's own
    // uniqueness constraints, which is a builder bug, never a finding.
    const seen = new Set();
    for (const d of decisionIds(text).decisions) {
      if (d.id === null || seen.has(d.id)) continue;
      seen.add(d.id);
      decisions.set(`${adr}#${d.id}`, { file: f, n: d.n });
      fact("has", `${adr}#${d.id}`, adr);
    }
    for (const [position, e] of parsed.entries.entries()) {
      const entry = entryKey(adr, position);
      entries.set(entry, { adr, file: f, position, ids: e.ids, text: e.text });
      for (const id of new Set(e.ids)) fact("lists", entry, `${adr}#${id}`);
      if (e.kind === "npm" && scriptVerdict(e, adr) === null) {
        askedScripts = true;
        if (reader.scripts() !== null) fact("names", entry, e.script);
      }
      if (e.kind === "none") {
        askedIssues = true;
        if (reader.issues() !== null) fact("cites", entry, e.issue);
      }
    }
  }
  if (askedScripts) {
    for (const s of Object.keys(reader.scripts() ?? {})) fact("defines", s, "barwise");
  }
  if (askedIssues) {
    for (const [id, o] of reader.issues() ?? []) {
      fact("tracked", id, "beads");
      if (o.status !== "closed") fact("open", id, "beads");
    }
  }
  return { pops, entries, decisions };
}

// The entry's fact type that carries a value of each kind RULES keys a
// rule by. A decision is carried by "Entry lists Decision"; coverage, the
// one rule about a decision with no entry, is reported by the decision.
const CARRIED_BY = { decision: "lists", script: "names", issue: "cites" };

const idOf = (key) => key.slice(key.indexOf("#") + 1);

// The message each rule's finding prints: what check:architecture printed
// before WS4, so an author sees the same words from a different gate.
const MESSAGE = {
  "ids-exist": ({ file, text }, key) =>
    `${file}: "${text}" lists ${idOf(key)}, which no decision here has`,
  coverage: ({ file, n }, key) =>
    `${file}: decision ${n} {#${idOf(key)}} has no Enforced-by: entry`,
  "script-exists": ({ file, text }, key) =>
    `${file}: "${text}": barwise/package.json has no script ${key}`,
  "issue-tracked": ({ file, text }, key) =>
    `${file}: "${text}": ${key} is not in .beads/issues.jsonl`,
  "issue-open": ({ file, text }, key) =>
    `${file}: "${text}": ${key} is closed; declare the enforcer it built, or reopen it`,
};

/**
 * The findings left once each chain is applied: one is dropped when a
 * lower-ranked rule of its chain is violated on the same entry and key.
 */
export function withinChains(findings) {
  const rule = new Map(RULES.map((r) => [r.id, r]));
  const at = (f) => `${f.adr}|${f.position}|${f.key}`;
  return findings.filter((f) =>
    !findings.some((g) =>
      at(g) === at(f)
      && rule.get(g.rule).chain === rule.get(f.rule).chain
      && rule.get(g.rule).rank < rule.get(f.rule).rank
    )
  );
}

/**
 * The model's verdict: the schema text with these facts as its
 * populations, judged by core. `core` is `@barwise/core` and `YAML` the
 * `yaml` package, passed in so this file loads without either and the
 * caller decides how a missing one is reported. Returns `findings` as
 * `{ rule, adr, position, key, message }`, one per entry that carries a
 * violated key (and per time it lists an id, for ids-exist), each chain
 * applied, in ADR and entry order; and `self`: the model's own refusals (a
 * load failure, a deontic or missing rule constraint, an error or message
 * it cannot classify). With any of those some rule may have gone
 * unjudged, so it has no answer, whatever it found.
 */
export function modelJudge(adrs, reader, { core, YAML, schemaText }) {
  const { pops, entries, decisions } = build(adrs, reader);
  const self = [];
  let model;
  let diagnostics;
  try {
    const doc = YAML.parse(schemaText);
    doc.model.populations = Object.entries(pops).map(([ft, rows]) => ({
      id: `${ft}.population`,
      fact_type: ft,
      instances: rows.map((role_values, i) => ({ id: `${ft}.population.${i + 1}`, role_values })),
    }));
    model = new core.OrmYamlSerializer().deserialize(YAML.stringify(doc));
    diagnostics = new core.ValidationEngine().validate(model);
  } catch (err) {
    return {
      findings: [],
      self: [
        `the schema and its population would not load: ${err instanceof Error ? err.message : err}`,
      ],
    };
  }
  const ruleIds = new Set(RULES.map((r) => r.id));
  for (const c of model.constraints) {
    // A deontic constraint's violations are warnings, not findings, so its
    // rule would never report.
    if (ruleIds.has(c.id) && c.modality === "deontic") self.push(`${c.id} is deontic`);
  }
  const missing = [...ruleIds].filter((id) => !model.constraints.some((c) => c.id === id));
  if (missing.length > 0) self.push(`the schema states no constraint ${missing.join(", ")}`);
  const findings = [];
  for (const d of diagnostics) {
    if (d.severity !== "error") continue;
    if (!(ruleIds.has(d.elementId) && d.ruleId === "population/subset-violation")) {
      self.push(`an error it cannot classify: ${d.ruleId} ${d.elementId}: ${d.message}`);
      continue;
    }
    // The violating tuple is in the message, between the first "tuple ["
    // and the last "] in roles [", so a value containing "]" is read whole.
    const start = d.message.indexOf("tuple [");
    const end = d.message.lastIndexOf("] in roles [");
    if (start < 0 || end < start) {
      self.push(`a violation message it cannot read: ${d.message}`);
      continue;
    }
    const key = d.message.slice(start + "tuple [".length, end);
    const rule = d.elementId;
    if (rule === "coverage") {
      const decision = decisions.get(key);
      if (decision === undefined) {
        self.push(`coverage: a violation of ${key}, which is no decision it built`);
        continue;
      }
      findings.push({
        rule,
        adr: key.slice(0, key.indexOf("#")),
        position: null,
        key,
        message: MESSAGE.coverage(decision, key),
      });
      continue;
    }
    const carrier = ROLES[CARRIED_BY[RULES.find((r) => r.id === rule).key]];
    if (carrier === undefined) {
      self.push(`${rule}: no entry fact carries its key`);
      continue;
    }
    const [ft, entryRole, valueRole] = carrier;
    const carriers = (pops[ft] ?? []).filter((r) => r[valueRole] === key);
    // A violation no entry carries is not one of this rule's: the schema
    // states the constraint some other way (its roles reversed, say), and
    // dropping it would read as no finding.
    if (carriers.length === 0) {
      self.push(`${rule}: a violation of ${key} that no entry carries`);
      continue;
    }
    for (const row of carriers) {
      const entry = entries.get(row[entryRole]);
      // ids-exist counts once per time the entry lists the id, as
      // check:architecture reported it; the facts hold each id once.
      const times = rule === "ids-exist"
        ? entry.ids.filter((id) => `${entry.adr}#${id}` === key).length
        : 1;
      for (let i = 0; i < times; i++) {
        findings.push({
          rule,
          adr: entry.adr,
          position: entry.position,
          key,
          message: MESSAGE[rule](entry, key),
        });
      }
    }
  }
  // In ADR and entry order, coverage after an ADR's entries.
  const sorted = withinChains(findings).sort((x, y) =>
    x.adr < y.adr
      ? -1
      : x.adr > y.adr
      ? 1
      : (x.position ?? Infinity) - (y.position ?? Infinity)
  );
  return { findings: sorted, self };
}
