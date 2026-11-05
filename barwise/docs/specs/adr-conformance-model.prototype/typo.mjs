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
    if (o.id === "rule-script-exists") o.modality = "deontic";
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
).filter((d) => d.elementId === "rule-script-exists");
console.log("deontic rule violation severity:", sev.map((d) => d.severity));
const m = new OrmYamlSerializer().deserialize(YAML.stringify(deon));
console.log(
  "deontic is visible on load:",
  m.constraints.filter((c) => c.id === "rule-script-exists").map((c) => c.modality),
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
