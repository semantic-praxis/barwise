/**
 * A lenient load defers reference resolution to the validator.
 *
 * `addFactType` and `addSubtypeFact` have always taken
 * `skipPlayerValidation`, and the deserializer has always passed
 * `lenient` through to them. `addObjectifiedFactType` and
 * `addPopulation` did not, so a schema-valid `.orm.yaml` naming a
 * missing fact type could not be loaded at all -- `barwise validate`
 * printed one parse error instead of every problem in the file, and the
 * three rules that report exactly those references had never fired for
 * any consumer (barwise-977).
 *
 * The JSON Schema check still runs at parse time either way; only
 * reference resolution moves to `ValidationEngine`, which reports it.
 */
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

const withDanglingPopulation = `
orm_version: "1.1"
model:
  name: "M"
  object_types:
    - id: "ot1"
      name: "Customer"
      kind: "entity"
      reference_mode: "id"
  fact_types: []
  populations:
    - id: "pop1"
      fact_type: "ft-missing"
      instances: []
`;

const withDanglingObjectification = `
orm_version: "1.1"
model:
  name: "M"
  object_types:
    - id: "ot1"
      name: "Customer"
      kind: "entity"
      reference_mode: "id"
  fact_types: []
  objectified_fact_types:
    - id: "oft1"
      fact_type: "ft-missing"
      object_type: "ot-missing"
`;

const load = (yaml: string, lenient: boolean) =>
  new OrmYamlSerializer().deserialize(yaml, { lenient });

describe("lenient loading of population and objectification references", () => {
  it("a strict load still refuses a dangling population fact type", () => {
    // The strict path is unchanged: a caller who wants the throw keeps it.
    expect(() => load(withDanglingPopulation, false)).toThrow("ft-missing");
  });

  it("a lenient load yields a model the validator can report on", () => {
    const model = load(withDanglingPopulation, true);
    const ruleIds = new ValidationEngine().validate(model).map((d) => d.ruleId);

    expect(ruleIds).toContain("population/dangling-fact-type");
    // Not only the reference: the point of loading at all is that the
    // caller sees everything else wrong with the file too.
    expect(ruleIds.some((r) => r.startsWith("completeness/"))).toBe(true);
  });

  it("a strict load still refuses a dangling objectification", () => {
    expect(() => load(withDanglingObjectification, false)).toThrow("ft-missing");
  });

  it("a lenient load reports both sides of a dangling objectification", () => {
    const model = load(withDanglingObjectification, true);
    const ruleIds = new ValidationEngine().validate(model).map((d) => d.ruleId);

    expect(ruleIds).toContain("structural/objectified-dangling-fact-type");
    expect(ruleIds).toContain("structural/objectified-dangling-object-type");
  });

  it("still refuses a duplicate objectification even when lenient", () => {
    // The skip covers what a record REFERENCES, not whether this model's
    // own records contradict each other.
    const duplicated = `
orm_version: "1.1"
model:
  name: "M"
  object_types:
    - id: "ot1"
      name: "Customer"
      kind: "entity"
      reference_mode: "id"
  fact_types: []
  objectified_fact_types:
    - id: "oft1"
      fact_type: "ft-missing"
      object_type: "ot-missing"
    - id: "oft2"
      fact_type: "ft-missing"
      object_type: "ot-other"
`;
    expect(() => load(duplicated, true)).toThrow("already objectified");
  });
});
