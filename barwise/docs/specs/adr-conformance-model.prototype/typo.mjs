// Edge cases for the classifier: a misspelled role, a misspelled fact type,
// a deontic rule, and the schema alone.
import { readFileSync } from "node:fs";
import YAML from "../../../node_modules/yaml/dist/index.js";
import { OrmYamlSerializer, ValidationEngine } from "../../../packages/core/dist/index.js";
const base = () =>
  YAML.parse(readFileSync(new URL("./governance.orm.yaml", import.meta.url), "utf8"));
const errors = (doc) => {
  try {
    return new ValidationEngine().validate(new OrmYamlSerializer().deserialize(YAML.stringify(doc)))
      .filter((d) => d.severity === "error").map((d) => `${d.ruleId}: ${d.message.slice(0, 90)}`);
  } catch (e) {
    return [`load threw: ${e.message.slice(0, 90)}`];
  }
};
const role = base();
role.model.populations = [{
  id: "Entry_names_Script.population",
  fact_type: "Entry_names_Script",
  instances: [{
    id: "Entry_names_Script.population.1",
    role_values: { "Entry_names_Script.names": "a:0", "Entry_names_Script.typo": "check:x" },
  }],
}];
console.log("misspelled role:", errors(role));
const ft = base();
ft.model.populations = [{
  id: "Entry_names_Scrpt.population",
  fact_type: "Entry_names_Scrpt",
  instances: [],
}];
console.log("misspelled fact type:", errors(ft));
const deon = base();
const walk = (o) => {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.id === "script-exists") o.modality = "deontic";
    Object.values(o).forEach(walk);
  }
};
walk(deon);
deon.model.populations = [
  {
    id: "Entry_names_Script.population",
    fact_type: "Entry_names_Script",
    instances: [{
      id: "Entry_names_Script.population.1",
      role_values: {
        "Entry_names_Script.names": "a:0",
        "Entry_names_Script.is_named_by": "check:gone",
      },
    }],
  },
];
const sev = new ValidationEngine().validate(
  new OrmYamlSerializer().deserialize(YAML.stringify(deon)),
).filter((d) => d.elementId === "script-exists");
console.log("deontic rule violation severity:", sev.map((d) => d.severity));
const m = new OrmYamlSerializer().deserialize(YAML.stringify(deon));
console.log(
  "deontic is visible on load:",
  m.constraints.filter((c) => c.id === "script-exists").map((c) => c.modality),
);
const alone = new ValidationEngine().validate(
  new OrmYamlSerializer().deserialize(YAML.stringify(base())),
);
console.log(
  "schema alone:",
  alone.length,
  "diagnostics,",
  alone.filter((d) => d.severity === "error").length,
  "errors",
);

// Core reports a subset violation once per distinct value: two entries
// naming one missing script are one diagnostic.
const twice = base();
twice.model.populations = [{
  id: "Entry_names_Script.population",
  fact_type: "Entry_names_Script",
  instances: ["a:0", "b:0"].map((e, i) => ({
    id: `Entry_names_Script.population.${i + 1}`,
    role_values: { "Entry_names_Script.names": e, "Entry_names_Script.is_named_by": "check:gone" },
  })),
}];
console.log(
  "one missing script on two entries:",
  errors(twice).filter((e) => e.startsWith("population/subset-violation")).length,
  "subset diagnostic(s)",
);

// Coverage as a mandatory constraint leaks: a tag naming a decision that no
// ADR has makes that decision look uncovered. As a subset it does not.
const leak = (form) => {
  const d = base();
  const walk = (o) => {
    if (Array.isArray(o)) {
      const i = o.findIndex((c) => c && c.id === "coverage");
      if (i >= 0 && form === "mandatory") {
        o.splice(i, 1);
      }
      o.forEach(walk);
    } else if (o && typeof o === "object") Object.values(o).forEach(walk);
  };
  walk(d);
  if (form === "mandatory") {
    const ft = d.model.fact_types.find((f) => f.id === "Entry_lists_Decision");
    (ft.constraints ??= []).push({ type: "mandatory", role: "Entry_lists_Decision.is_listed_by" });
  }
  d.model.populations = [{
    id: "Test_is_tagged_with_Decision.population",
    fact_type: "Test_is_tagged_with_Decision",
    instances: [{
      id: "Test_is_tagged_with_Decision.population.1",
      role_values: {
        "Test_is_tagged_with_Decision.is_tagged_with": "t1",
        "Test_is_tagged_with_Decision.tags": "a#gone",
      },
    }],
  }];
  return errors(d).filter((e) => /mandatory|subset/.test(e)).length;
};
console.log("a stray tag, coverage as subset:", leak("subset"), "violation(s)");
console.log("a stray tag, coverage as mandatory:", leak("mandatory"), "violation(s)");

// A model that cannot load beside a code finding: exit 2, not 1.
const { codeJudge, compare, exitOf, modelJudge } = await import("./judge.mjs");
const adrs = [{
  f: "barwise/docs/adr/a.md",
  text: "# a\n\nEnforced-by: npm run check:gone (one)\n\n## Decision\n\n1. **D** {#one}. Text.\n",
}];
const reader = () => ({ scripts: () => ({}), steps: () => [], issues: () => new Map() });
const code = codeJudge(adrs, reader(), []);
const model = modelJudge(adrs, reader(), [], { breakFactType: true });
const c = compare(code, model);
console.log("model fails to load, code has a finding: exit", exitOf(code, model, c));
const unbuilt = modelJudge(adrs, reader(), [], { coreMissing: true });
console.log(
  "core not built, code has a finding: exit",
  exitOf(code, unbuilt, compare(code, unbuilt)),
);
