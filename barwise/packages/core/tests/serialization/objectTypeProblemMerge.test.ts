/**
 * Schema errors and decoder problems on one object type, merged by
 * OrmYamlSerializer. A schema error the decoder does not replace must survive
 * (the file format asks for an id the decoder mints), and a field the decoder
 * names replaces the schema's error on that field once, not once per keyword.
 */
import { describe, expect, it } from "vitest";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import type { SchemaError } from "../../src/serialization/SchemaValidator.js";

const HEAD = `orm_version: "2.0"
model:
  name: Merge
  object_types:
`;

function loadError(body: string): string {
  try {
    new OrmYamlSerializer().deserialize(HEAD + body);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the load to refuse");
}

function loadErrors(body: string): readonly SchemaError[] {
  try {
    new OrmYamlSerializer().deserialize(HEAD + body);
  } catch (e) {
    return (e as DeserializationError).validationResult!.errors;
  }
  throw new Error("expected the load to refuse");
}

describe("schema errors and decoder problems on one object type", () => {
  it("reports a missing id beside a cardinality problem on the same object type", () => {
    const message = loadError(`    - name: Size
      kind: value
      cardinality:
        min: 5
        max: 2
`);
    expect(message).toContain('is missing "id"');
    expect(message).toContain("must have a cardinality max >= min");
  });

  it("keeps a schema error inside a field the decoder also refuses", () => {
    // The decoder names the field (aliases); the schema also flags the empty
    // string, which the decoder accepts. That error must survive.
    const message = loadError(`    - id: ot-a
      name: Size
      kind: value
      data_type:
        name: text
      aliases: ["", 3]
`);
    expect(message).toContain("fewer than 1 characters");
  });

  it("keeps a bare list entry's schema error, not only the decoder's guess at its kind", () => {
    const message = loadError(`    - Customer
`);
    expect(message).toContain("must be object");
  });

  it("keeps an additional-property error beside an invalid kind", () => {
    const message = loadError(`    - id: ot-1
      name: Thing
      kind: both
      colour: red
`);
    expect(message).toContain("additional properties");
    expect(message).toContain("kind");
  });

  it("reports an entity without a reference mode once", () => {
    const errors = loadErrors(`    - id: ot-p
      name: Person
      kind: entity
`);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("/model/object_types/0/reference_mode");
  });
});
