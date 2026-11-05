// Both judges on one input, compared as sets of (rule, adr, entry, key);
// refusals compared for the inputs the model reads.
import { readFileSync } from "node:fs";
import YAML from "../../../node_modules/yaml/dist/index.js";
import { OrmYamlSerializer, ValidationEngine } from "../../../packages/core/dist/index.js";
import { build, ROLES } from "./build.mjs";
const { judgeDeclarations } = await import("../../../scripts/lib/adr-judge.mjs");
const { ADR_DIR } = await import("../../../scripts/lib/architecture-section.mjs");
export const RULES = [
  "ids-exist",
  "coverage",
  "script-exists",
  "issue-tracked",
  "issue-open",
];
const SCHEMA = new URL("./governance.orm.yaml", import.meta.url);
const CHAINS = { "issue-open": "issue-tracked" };
const MODEL_INPUTS = new Set(["barwise/package.json", ".beads/issues.jsonl"]);
// Which entry's role carries each rule's key, to list the entries behind a key.
const KEY_ROLE = {
  "ids-exist": "lists",
  "script-exists": "names",
  "issue-tracked": "cites",
  "issue-open": "cites",
};

const PATTERNS = [
  [
    "ids-exist",
    /^(?<f>\S+): "(?<e>.*)" lists (?<id>\S+), which no decision here has$/,
    (m) => `${m.adr}#${m.id}`,
  ],
  [
    "coverage",
    /^(?<f>\S+): decision \d+ \{#(?<id>[^}]+)\} has no Enforced-by: entry$/,
    (m) => `${m.adr}#${m.id}`,
  ],
  [
    "script-exists",
    /^(?<f>\S+): "(?<e>.*)": barwise\/package\.json has no script (?<s>\S+)$/,
    (m) => m.s,
  ],
  [
    "issue-tracked",
    /^(?<f>\S+): "(?<e>.*)": (?<i>\S+) is not in \.beads\/issues\.jsonl$/,
    (m) => m.i,
  ],
  ["issue-open", /^(?<f>\S+): "(?<e>.*)": (?<i>\S+) is closed; /, (m) => m.i],
];
export function codeJudge(adrs, reader, refusals) {
  const { problems } = judgeDeclarations(adrs, reader, refusals);
  const findings = [];
  for (const p of problems) {
    for (const [rule, re, key] of PATTERNS) {
      const m = p.match(re);
      if (!m) continue;
      const adr = m.groups.f.slice(ADR_DIR.length, -".md".length);
      findings.push(`${rule}|${adr}|${m.groups.e ?? ""}|${key({ ...m.groups, adr })}`);
    }
  }
  return { findings, refusals };
}

export function modelJudge(adrs, reader, refusals, opts = {}) {
  const entries = new Map();
  const pops = build(adrs, reader, { ...opts, entries });
  const doc = YAML.parse(readFileSync(SCHEMA, "utf8"));
  doc.model.populations = Object.entries(pops).map(([ft, rows]) => ({
    id: `${ft}.population`,
    fact_type: ft,
    instances: rows.map((role_values, i) => ({ id: `${ft}.population.${i + 1}`, role_values })),
  }));
  // The model's own refusals (it could not judge) are kept apart from the
  // reader's: with any of them the comparison does not run, and the answer
  // is exit 2.
  const self = [];
  let model;
  try {
    model = new OrmYamlSerializer().deserialize(YAML.stringify(doc));
  } catch (e) {
    return { findings: [], refusals, self: [`the population could not be loaded: ${e.message}`] };
  }
  for (const c of model.constraints) {
    if (RULES.includes(c.id) && c.modality === "deontic") {
      self.push(`${c.id} is deontic, so its violations would be warnings`);
    }
  }
  const findings = [];
  const rows = (k) => pops[ROLES[k][0]] ?? [];
  for (const d of new ValidationEngine().validate(model)) {
    if (d.severity !== "error") continue;
    if (!(RULES.includes(d.elementId) && d.ruleId === "population/subset-violation")) {
      self.push(`the population could not be judged: ${d.ruleId} ${d.message}`);
      continue;
    }
    const start = d.message.indexOf("tuple [");
    const end = d.message.lastIndexOf("] in roles [");
    if (start < 0 || end < start) {
      self.push(`unreadable violation: ${d.message}`);
      continue;
    }
    const key = d.message.slice(start + "tuple [".length, end);
    const rule = d.elementId;
    if (rule === "coverage") {
      findings.push(`${rule}|${key.split("#")[0]}||${key}`);
      continue;
    }
    // One finding per entry that carries the key, so two identical entries
    // are two findings, as they are for the code judge.
    const [, er, vr] = ROLES[KEY_ROLE[rule]];
    for (const row of rows(KEY_ROLE[rule]).filter((r) => r[vr] === key)) {
      const { adr, text } = entries.get(row[er]);
      findings.push(`${rule}|${adr}|${text}|${key}`);
    }
  }
  return { findings, refusals, self };
}

// With a model refusal the comparison does not run. Otherwise findings
// compare as multisets of (rule, ADR, entry, key), so identical entries
// count twice, and refusals for the inputs the model reads compare as sets.
export function compare(code, model) {
  if (model.self.length > 0) return { refused: model.self, diff: [], refusalDiff: [] };
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const c = count(code.findings);
  const m = count(model.findings);
  const shadowed = (x) => {
    const [rule, adr, entry, key] = x.split("|");
    return CHAINS[rule] !== undefined && c.has(`${CHAINS[rule]}|${adr}|${entry}|${key}`);
  };
  const diff = [...new Set([...c.keys(), ...m.keys()])]
    .filter((x) => (c.get(x) ?? 0) !== (m.get(x) ?? 0) && !(!c.has(x) && shadowed(x)))
    .map((x) => `${x}: code ${c.get(x) ?? 0}, model ${m.get(x) ?? 0}`);
  const label = (r) => r.split(":")[0];
  const cr = new Set(code.refusals.map(label).filter((x) => MODEL_INPUTS.has(x)));
  const mr = new Set(model.refusals.map(label));
  const refusalDiff = [...new Set([...cr, ...mr])].filter((x) => cr.has(x) !== mr.has(x))
    .map((x) => `refusal only in ${cr.has(x) ? "code" : "model"}: ${x}`);
  return { refused: [], diff, refusalDiff };
}

// The exit the check gives: a model refusal 2; else a disagreement 1 (a
// refusal-set mismatch is one: the builder asked differently); else a
// reader refusal on either side 2; else 0.
export function exitOf(code, model, c) {
  if (c.refused.length > 0) return 2;
  if (c.diff.length > 0 || c.refusalDiff.length > 0) return 1;
  return code.refusals.length > 0 || model.refusals.length > 0 ? 2 : 0;
}
