/**
 * What a file states of its model's ids (iri-identity WS6, 6b-3a): the
 * ids a 4.0 file leaves to the load (decision 17), written into the file
 * by `storeIds` and reported until they are; the one note a file before
 * 4.0 gets (barwise-wcg.frh); and a shadow replayed with its owner's id.
 */
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { storeIds } from "../../src/serialization/storeIds.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

const serializer = new OrmYamlSerializer();
const read = (yaml: string) => serializer.deserialize(yaml, { lenient: true });
const ruleIds = (yaml: string) => new ValidationEngine().validate(read(yaml)).map((d) => d.ruleId);

/** Person smokes, with a mandatory constraint the person typed without an id. */
const typed = `orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Person, name: Person, kind: entity, reference_mode: nr }
    - { id: Smoker, name: Smoker, kind: entity, reference_mode: nr }
  fact_types:
    - id: Person_smokes
      name: Person smokes
      roles:
        - { id: Person_smokes.smokes, player: Person, role_name: smokes }
      readings: ["{0} smokes"]
      constraints:
        # Typed in the editor; no id yet.
        - type: mandatory
          role: Person_smokes.smokes
  subtype_facts:
    - subtype: Smoker
      supertype: Person
`;

describe("ids a 4.0 file does not state", () => {
  it("are listed on the model the file loads to, and not those the file states", () => {
    const model = read(typed);
    expect(model.unstoredIds).toEqual(["Each_Person_smokes", "Smoker_is_a_subtype_of_Person"]);
    const stated = storeIds(typed).text;
    expect(read(stated).unstoredIds).toEqual([]);
  });

  it("each get a warning naming the id, until the file states it", () => {
    const diagnostics = new ValidationEngine().validate(read(typed))
      .filter((d) => d.ruleId === "structural/unstored-id");
    expect(diagnostics.map((d) => [d.severity, d.elementId])).toEqual([
      ["warning", "Each_Person_smokes"],
      ["warning", "Smoker_is_a_subtype_of_Person"],
    ]);
    expect(diagnostics[0]!.message).toContain("barwise migrate");
    expect(ruleIds(storeIds(typed).text)).not.toContain("structural/unstored-id");
  });

  it("go from the list with their element", () => {
    const model = read(typed);
    model.removeSubtypeFact("Smoker_is_a_subtype_of_Person");
    expect(model.unstoredIds).toEqual(["Each_Person_smokes"]);
  });

  it("are written as each element's first keys, with its key, and the comments kept", () => {
    const { text, stored } = storeIds(typed);
    expect(stored).toEqual([
      { id: "Each_Person_smokes", path: ["model", "fact_types", 0, "constraints", 0] },
      { id: "Smoker_is_a_subtype_of_Person", path: ["model", "subtype_facts", 0] },
    ]);
    expect(text).toContain("# Typed in the editor; no id yet.");
    expect(text).toMatch(/- id: Each_Person_smokes\n\s+minted_from: .+\n\s+type: mandatory/);
    // The key stored is the one the model holds, so decision 14's check
    // has something to compare.
    const model = read(text);
    expect(model.mintedFromOf("Each_Person_smokes")).toBe(
      read(typed).mintedFromOf("Each_Person_smokes"),
    );
    // Everything else is as it was.
    expect(serializer.serialize(model)).toBe(serializer.serialize(read(typed)));
  });

  it("leave a file that states every id as it is", () => {
    const { text } = storeIds(typed);
    expect(storeIds(text)).toEqual({ text, stored: [] });
  });

  it("are none in a file before 4.0, which states no 4.0 id at all", () => {
    const v3 = `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: Person, kind: entity, reference_mode: nr }
`;
    expect(read(v3).unstoredIds).toEqual([]);
    expect(storeIds(v3)).toEqual({ text: v3, stored: [] });
  });
});

describe("a file before 4.0", () => {
  it("gets one note, at no element, saying its ids are 4.0's and naming migrate", () => {
    const v3 = `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: Person, kind: entity, reference_mode: nr }
    - { id: u2, name: Car, kind: entity, reference_mode: vin }
`;
    const notes = new ValidationEngine().validate(read(v3))
      .filter((d) => d.ruleId === "structural/replayed-ids");
    expect(notes.map((d) => [d.severity, d.elementId])).toEqual([["info", ""]]);
    expect(notes[0]!.message).toContain("barwise migrate");
    expect(ruleIds(typed)).not.toContain("structural/replayed-ids");
  });
});

describe("a shadow replayed with its owner's id", () => {
  const shadow = `orm_version: "3.0"
model:
  name: billing
  domain_context: billing
  object_types:
    - { id: s1, name: Order Line, kind: entity, reference_mode: nr, source_context: sales }
`;

  it("names the owner by its local name when nothing says otherwise", () => {
    expect(read(shadow).objectTypes[0]!.id).toBe("sales:Order_Line");
  });

  it("names the id the owner's domain gives, a suffixed one included", () => {
    const ownerId = (context: string, name: string) =>
      context === "sales" && name === "Order Line" ? "Order_Line_2" : undefined;
    const { model } = serializer.migrate(shadow, { lenient: true, ownerId });
    expect(model.objectTypes[0]!.id).toBe("sales:Order_Line_2");
    expect(model.priorIds?.get("sales:Order_Line_2")).toBe("s1");
  });
});
