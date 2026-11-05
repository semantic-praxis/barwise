/**
 * The facts the ADR governance schema judges, built from what the
 * governance reader answers (docs/specs/adr-conformance-model.spec.md).
 *
 * The builder asks the reader exactly what the code judge asks, and no
 * more: `scripts()` only for an npm entry the shared `scriptVerdict` lets
 * through, `issues()` only for a `none` entry, never the workflow. When an
 * input cannot be read the reader answers `null` and records the refusal,
 * and the builder writes none of the facts that would oblige anything of
 * it, so the model reports nothing where the code judge cannot answer. An
 * ADR with no `Enforced-by:` header gets no facts at all, as the code judge
 * `continue`s past it.
 */
import { decisionIds, parseEnforcedBy } from "./adr-enforcement.mjs";
import { scriptVerdict } from "./adr-judge.mjs";
import { ADR_DIR } from "./architecture-section.mjs";

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
 * The populations, by fact type id, as rows of role values; and `entries`,
 * from entry key to `{ adr, position, ids }`, so a violation of a rule
 * keyed by a decision, script or issue can be expanded to the entries that
 * carry it.
 */
export function build(adrs, reader) {
  const pops = {};
  const entries = new Map();
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
      fact("has", `${adr}#${d.id}`, adr);
    }
    for (const [position, e] of parsed.entries.entries()) {
      const entry = entryKey(adr, position);
      entries.set(entry, { adr, position, ids: e.ids });
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
  return { pops, entries };
}

// The entry's fact type that carries a value of each kind RULES keys a
// rule by. A decision is carried by "Entry lists Decision"; coverage, the
// one rule about a decision with no entry, is expanded by its ADR alone.
const CARRIED_BY = { decision: "lists", script: "names", issue: "cites" };

/**
 * The model's verdict: the schema text with these facts as its
 * populations, judged by core. `core` is `@barwise/core` and `YAML` the
 * `yaml` package, passed in so this file loads without either and the
 * caller decides how a missing one is reported. Returns `findings` as
 * `rule|adr|position|key` strings, one per entry that carries a violated
 * key, and `self`: the model's own refusals (a load failure, a deontic or
 * missing rule constraint, an error or message it cannot classify). With
 * any of those it has no answer.
 */
export function modelJudge(adrs, reader, { core, YAML, schemaText, rules }) {
  const { pops, entries } = build(adrs, reader);
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
  const ruleIds = new Set(rules.map((r) => r.id));
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
      findings.push(`${rule}|${key.slice(0, key.indexOf("#"))}|null|${key}`);
      continue;
    }
    const carrier = ROLES[CARRIED_BY[rules.find((r) => r.id === rule).key]];
    if (carrier === undefined) {
      self.push(`${rule}: no entry fact carries its key`);
      continue;
    }
    const [ft, entryRole, valueRole] = carrier;
    for (const row of (pops[ft] ?? []).filter((r) => r[valueRole] === key)) {
      const { adr, position, ids } = entries.get(row[entryRole]);
      // ids-exist counts once per time the entry lists the id, as the code
      // judge reports it; the facts hold each id once.
      const times = rule === "ids-exist" ? ids.filter((id) => `${adr}#${id}` === key).length : 1;
      for (let i = 0; i < times; i++) findings.push(`${rule}|${adr}|${position}|${key}`);
    }
  }
  return { findings, self };
}

/** The inputs the model reads, by the label the reader gives their refusals. */
export const MODEL_INPUTS = new Set(["barwise/package.json", ".beads/issues.jsonl"]);

/**
 * The code judge's facts against the model's findings, as multisets of
 * `rule|adr|position|key`, and the two refusal lists for the inputs the
 * model reads. A model finding the code judge did not make is shadowed,
 * not a disagreement, when the code judge reported a lower-ranked rule of
 * the same chain on the same entry and key. Returns the disagreements.
 */
export function compareJudges({ codeFacts, codeRefusals, modelFindings, modelRefusals, rules }) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const c = count(codeFacts);
  const m = count(modelFindings);
  const lower = new Map(
    rules.filter((r) => r.rank > 1).map((r) => [
      r.id,
      rules.filter((s) => s.chain === r.chain && s.rank < r.rank).map((s) => s.id),
    ]),
  );
  const shadowed = (x) => {
    const [rule, ...rest] = x.split("|");
    return (lower.get(rule) ?? []).some((l) => c.has([l, ...rest].join("|")));
  };
  const disagreements = [...new Set([...c.keys(), ...m.keys()])]
    .filter((x) => (c.get(x) ?? 0) !== (m.get(x) ?? 0) && !(!c.has(x) && shadowed(x)))
    .map((x) => `${x}: code judge ${c.get(x) ?? 0}, model ${m.get(x) ?? 0}`);
  const label = (r) => r.split(":")[0];
  const cr = new Set(codeRefusals.map(label).filter((x) => MODEL_INPUTS.has(x)));
  const mr = new Set(modelRefusals.map(label));
  for (const x of new Set([...cr, ...mr])) {
    if (cr.has(x) !== mr.has(x)) {
      disagreements.push(`${x}: refused by the ${cr.has(x) ? "code judge" : "model"} only`);
    }
  }
  return disagreements;
}

/** A code judge's facts, in the form compareJudges reads. */
export const factStrings = (facts) => facts.map((x) => `${x.rule}|${x.adr}|${x.position}|${x.key}`);
