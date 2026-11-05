// Both judges on one input, compared as sets of (rule, adr, entry, key);
// refusals compared for the inputs the model reads.
import { readFileSync } from "node:fs";
import YAML from "../../../node_modules/yaml/dist/index.js";
import { OrmYamlSerializer, ValidationEngine } from "../../../packages/core/dist/index.js";
import { build, ROLES } from "./build.mjs";
const { judgeDeclarations } = await import("../../../scripts/lib/adr-judge.mjs");
const { ADR_DIR } = await import("../../../scripts/lib/architecture-section.mjs");
export const RULES = [
  "rule-ids-exist",
  "rule-coverage",
  "rule-script-exists",
  "rule-issue-tracked",
  "rule-issue-open",
];
const SCHEMA = new URL("./governance.orm.yaml", import.meta.url);
const CHAINS = { "rule-issue-open": "rule-issue-tracked" };
const MODEL_INPUTS = new Set(["barwise/package.json", ".beads/issues.jsonl"]);
// Which entry's role carries each rule's key, to list the entries behind a key.
const KEY_ROLE = {
  "rule-ids-exist": "lists",
  "rule-script-exists": "names",
  "rule-issue-tracked": "cites",
  "rule-issue-open": "cites",
};

const PATTERNS = [
  [
    "rule-ids-exist",
    /^(?<f>\S+): "(?<e>.*)" lists (?<id>\S+), which no decision here has$/,
    (m) => `${m.adr}#${m.id}`,
  ],
  [
    "rule-coverage",
    /^(?<f>\S+): decision \d+ \{#(?<id>[^}]+)\} has no Enforced-by: entry$/,
    (m) => `${m.adr}#${m.id}`,
  ],
  [
    "rule-script-exists",
    /^(?<f>\S+): "(?<e>.*)": barwise\/package\.json has no script (?<s>\S+)$/,
    (m) => m.s,
  ],
  [
    "rule-issue-tracked",
    /^(?<f>\S+): "(?<e>.*)": (?<i>\S+) is not in \.beads\/issues\.jsonl$/,
    (m) => m.i,
  ],
  ["rule-issue-open", /^(?<f>\S+): "(?<e>.*)": (?<i>\S+) is closed; /, (m) => m.i],
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
  let model;
  try {
    model = new OrmYamlSerializer().deserialize(YAML.stringify(doc));
  } catch (e) {
    return {
      findings: [],
      refusals: [...refusals, `the population could not be loaded: ${e.message}`],
      other: [],
    };
  }
  for (const c of model.constraints) {
    if (RULES.includes(c.id) && c.modality === "deontic") {
      refusals.push(`${c.id} is deontic, so its violations would be warnings`);
    }
  }
  const findings = [];
  const other = [];
  const rows = (k) => pops[ROLES[k][0]] ?? [];
  for (const d of new ValidationEngine().validate(model)) {
    if (d.severity !== "error") continue;
    if (!(RULES.includes(d.elementId) && d.ruleId === "population/subset-violation")) {
      refusals.push(`the population could not be judged: ${d.ruleId} ${d.message}`);
      continue;
    }
    const start = d.message.indexOf("tuple [");
    const end = d.message.lastIndexOf("] in roles [");
    if (start < 0 || end < start) {
      refusals.push(`unreadable violation: ${d.message}`);
      continue;
    }
    const key = d.message.slice(start + "tuple [".length, end);
    const rule = d.elementId;
    if (rule === "rule-coverage") {
      findings.push(`${rule}|${key.split("#")[0]}||${key}`);
      continue;
    }
    const [, er, vr] = ROLES[KEY_ROLE[rule]];
    for (const row of rows(KEY_ROLE[rule]).filter((r) => r[vr] === key)) {
      const { adr, text } = entries.get(row[er]);
      findings.push(`${rule}|${adr}|${text}|${key}`);
    }
  }
  return { findings: [...new Set(findings)], refusals, other };
}

export function compare(code, model) {
  const c = new Set(code.findings);
  const m = new Set(model.findings);
  const shadowed = (x) => {
    const [rule, adr, entry, key] = x.split("|");
    return CHAINS[rule] !== undefined && c.has(`${CHAINS[rule]}|${adr}|${entry}|${key}`);
  };
  const diff = [
    ...[...c].filter((x) => !m.has(x)).map((x) => `missed by model: ${x}`),
    ...[...m].filter((x) => !c.has(x) && !shadowed(x)).map((x) => `extra in model: ${x}`),
  ];
  const label = (r) => r.split(":")[0];
  const cr = new Set(code.refusals.map(label).filter((x) => MODEL_INPUTS.has(x)));
  const mr = new Set(model.refusals.map(label));
  const refusalDiff = [...new Set([...cr, ...mr])].filter((x) => cr.has(x) !== mr.has(x))
    .map((x) => `refusal only in ${cr.has(x) ? "code" : "model"}: ${x}`);
  return { diff, refusalDiff };
}
