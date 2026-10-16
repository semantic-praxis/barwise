/**
 * Constraint problems on load. The decoder owns a constraint it found a
 * problem in: its messages replace the schema's, which for a constraint are
 * one per `oneOf` branch it failed. A constraint the decoder accepted keeps
 * every schema error on it. A constraint without an id gets exactly one,
 * filled by the loader before decoding (decision 8).
 */
import { describe, expect, it } from "vitest";
import { setIdGenerator } from "../../src/model/id.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import type { SchemaError } from "../../src/serialization/SchemaValidator.js";

function withConstraints(constraints: string): string {
  return `orm_version: "2.0"
model:
  name: Merge
  object_types:
    - id: ot-p
      name: Person
      kind: entity
      reference_mode: id
  fact_types:
    - id: ft-1
      name: Person exists
      roles:
        - id: r-1
          player: ot-p
          role_name: exists
      readings:
        - "{0} exists"
      constraints:
${constraints}`;
}

function loadErrors(yaml: string): readonly SchemaError[] {
  try {
    new OrmYamlSerializer().deserialize(yaml);
  } catch (e) {
    return (e as DeserializationError).validationResult!.errors;
  }
  throw new Error("expected the load to refuse");
}

describe("constraint problems on load", () => {
  it("reports a bad constraint once, in the decoder's words, at the field", () => {
    const errors = loadErrors(withConstraints(`        - id: c-1
          type: ring
          role_1: r-1
          role_2: r-1
          ring_type: sideways
`));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("/model/fact_types/0/constraints/0/ring_type");
    expect(errors[0]!.message).toMatch(
      /^Constraint "c-1" in Fact type "Person exists" has an invalid ring_type: /,
    );
  });

  it("names a constraint without an id by its position", () => {
    const errors = loadErrors(withConstraints(`        - type: mandatory
          role: r-1
        - type: mandatory
`));
    expect(errors).toEqual([{
      path: "/model/fact_types/0/constraints/1/role",
      message: 'Constraint at constraints/1 in Fact type "Person exists" is missing "role".',
    }]);
  });

  it("reports an unknown key holding a slash once, at its escaped pointer", () => {
    const errors = loadErrors(withConstraints(`        - id: c-1
          type: mandatory
          role: r-1
          "a/b": 1
`));
    expect(errors.map((e) => e.path)).toEqual(["/model/fact_types/0/constraints/0/a~1b"]);
  });

  it("keeps the schema's errors where the decoder has nothing to own", () => {
    // A `constraints` that is not a list is never decoded, so the schema's
    // error on it is the only report and must survive the merge.
    const errors = loadErrors(withConstraints("").replace("constraints:\n", "constraints: oops\n"));
    expect(errors.map((e) => e.path)).toContain("/model/fact_types/0/constraints");
  });

  it("fills one id for a constraint the file gave none, and loads it", () => {
    let n = 0;
    setIdGenerator(() => `minted-${++n}`);
    try {
      const model = new OrmYamlSerializer().deserialize(withConstraints(`        - type: mandatory
          role: r-1
        - id: ""
          type: internal_uniqueness
          roles: [r-1]
`));
      const ids = model.getFactType("ft-1")!.constraints.map((c) => c.id);
      expect(ids).toEqual(["minted-1", "minted-2"]);
      expect(n).toBe(2);
    } finally {
      setIdGenerator(undefined);
    }
  });
});
