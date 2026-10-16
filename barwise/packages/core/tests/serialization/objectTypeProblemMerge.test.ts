/**
 * Schema errors and decoder problems on one object type, merged by
 * OrmYamlSerializer. A schema error the decoder does not replace must survive
 * (the file format asks for an id the decoder mints), and a field the decoder
 * names replaces the schema's error on that field once, not once per keyword.
 */
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

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

describe("schema errors and decoder problems on one object type", () => {
  it("keeps a missing id when the decoder refuses the same object type for cardinality", () => {
    const message = loadError(`    - name: Size
      kind: value
      cardinality:
        min: 5
        max: 2
`);
    expect(message).toContain("must have required property 'id'");
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

  it("reports an entity without a reference mode once", () => {
    const message = loadError(`    - id: ot-p
      name: Person
      kind: entity
`);
    expect(message.match(/reference mode/g)).toHaveLength(1);
  });
});
