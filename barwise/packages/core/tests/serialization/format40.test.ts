/**
 * Reading a format 4.0 document (iri-identity WS6, 6b-2b-1): a stated id
 * is kept; an absent one is minted by the model and skips every id the
 * file states, wherever it sits; an id stated twice, of any kinds, is
 * refused; a malformed id is refused in the decoder's words; and the
 * loader still refuses 4.0, because nothing writes it until 6b-2b-2.
 */
import { describe, expect, it } from "vitest";
import {
  DeserializationError,
  OrmYamlSerializer,
  readDocument40,
} from "../../src/serialization/OrmYamlSerializer.js";

/** A 4.0 document: Person smokes, with the parts each case changes. */
function doc(extra: {
  constraints?: Record<string, unknown>[];
  subtypeFacts?: Record<string, unknown>[];
  objectTypes?: Record<string, unknown>[];
  populations?: Record<string, unknown>[];
} = {}): Record<string, unknown> {
  return {
    orm_version: "4.0",
    model: {
      name: "M",
      object_types: [
        { id: "Person", name: "Person", kind: "entity", reference_mode: "nr" },
        ...(extra.objectTypes ?? []),
      ],
      fact_types: [{
        id: "Person_smokes",
        name: "Person smokes",
        roles: [{ id: "Person_smokes.smokes", player: "Person", role_name: "smokes" }],
        readings: ["{0} smokes"],
        constraints: extra.constraints ?? [],
      }],
      ...(extra.subtypeFacts ? { subtype_facts: extra.subtypeFacts } : {}),
      ...(extra.populations ? { populations: extra.populations } : {}),
    },
  };
}

describe("reading a format 4.0 document", () => {
  it("keeps every id the file states", () => {
    const model = readDocument40(doc({
      constraints: [{ id: "Smokers_are_known", type: "mandatory", role: "Person_smokes.smokes" }],
    }));
    expect(model.getObjectType("Person")?.name).toBe("Person");
    expect(model.getFactType("Person_smokes")?.roles[0]!.id).toBe("Person_smokes.smokes");
    expect(model.getFactType("Person_smokes")!.internalConstraints[0]!.id).toBe(
      "Smokers_are_known",
    );
  });

  it("names an element the file gives no id, past an id the file states later", () => {
    const model = readDocument40(doc({
      objectTypes: [
        { id: "Smoker", name: "Smoker", kind: "entity", reference_mode: "nr" },
        // Stated after the subtype fact, and equal to the name minted for it.
        { id: "Smoker_is_a_subtype_of_Person", name: "Odd", kind: "entity", reference_mode: "x" },
      ],
      constraints: [{ type: "mandatory", role: "Person_smokes.smokes" }],
      subtypeFacts: [{ subtype: "Smoker", supertype: "Person" }],
    }));
    expect(model.getFactType("Person_smokes")!.internalConstraints[0]!.id).toBe(
      "Each_Person_smokes",
    );
    expect(model.subtypeFacts[0]!.id).toBe("Smoker_is_a_subtype_of_Person_2");
  });

  it("gives a minted constraint the next free name when the file states its name for another", () => {
    const model = readDocument40(doc({
      constraints: [
        { type: "mandatory", role: "Person_smokes.smokes" },
        { id: "Each_Person_smokes", type: "mandatory", role: "Person_smokes.smokes" },
      ],
    }));
    expect(model.getFactType("Person_smokes")!.internalConstraints.map((c) => c.id)).toEqual([
      "Each_Person_smokes_2",
      "Each_Person_smokes",
    ]);
  });

  it("reserves a stated id for its element when a kind added earlier would mint it", () => {
    // Fact types and their constraints are added before subtype facts, so
    // without the reservation the unnamed constraint would take the id the
    // subtype fact states.
    const model = readDocument40(doc({
      objectTypes: [{ id: "Smoker", name: "Smoker", kind: "entity", reference_mode: "nr" }],
      constraints: [{ type: "mandatory", role: "Person_smokes.smokes" }],
      subtypeFacts: [{ id: "Each_Person_smokes", subtype: "Smoker", supertype: "Person" }],
    }));
    expect(model.getFactType("Person_smokes")!.internalConstraints[0]!.id).toBe(
      "Each_Person_smokes_2",
    );
    expect(model.subtypeFacts[0]!.id).toBe("Each_Person_smokes");
  });

  it("refuses an id two elements state, whatever their kinds", () => {
    expect(() =>
      readDocument40(doc({
        objectTypes: [{ id: "Person_smokes", name: "Smokes", kind: "entity", reference_mode: "x" }],
      }))
    ).toThrow(/"Person_smokes" \(an object type, a fact type\).*An id names one element/);
    expect(() =>
      readDocument40(doc({
        constraints: [{ id: "Person", type: "mandatory", role: "Person_smokes.smokes" }],
      }))
    ).toThrow(DeserializationError);
  });

  it("refuses a malformed id in the decoder's words, naming format 4.0", () => {
    const bad = doc();
    (bad.model as any).fact_types[0].roles[0].id = "0193c8e2-6f4b-7c3a-9d1e-2b4f6a8c0e12";
    expect(() => readDocument40(bad)).toThrow(
      /does not conform to format 4\.0.*<fact type>\.<role>/,
    );
  });

  it("names an id-less subtype fact by what it relates when it has a problem", () => {
    const bad = doc({ subtypeFacts: [{ subtype: "Person", supertype: "a.b" }] });
    expect(() => readDocument40(bad)).toThrow(/Subtype fact of "Person" under "a\.b"/);
  });

  it("refuses a blank diagram name with the file's other problems", () => {
    const bad = doc();
    (bad.model as Record<string, unknown>).diagrams = [{ name: "   " }];
    expect(() => readDocument40(bad)).toThrow(DeserializationError);
    expect(() => readDocument40(bad)).toThrow(/does not conform to format 4\.0.*blank/);
  });

  it("numbers a population's unnamed instances past every number it states", () => {
    const model = readDocument40(doc({
      populations: [{
        id: "Person_smokes.population",
        fact_type: "Person_smokes",
        instances: [{ id: "Person_smokes.population.2", role_values: {} }],
      }],
    }));
    const pop = model.populations[0]!;
    expect(pop.addInstance({ roleValues: {} }).id).toBe("Person_smokes.population.3");
  });

  it("is not reached by the loader yet: 4.0 is refused until the writer writes it", () => {
    const yaml = 'orm_version: "4.0"\nmodel:\n  name: M\n';
    expect(() => new OrmYamlSerializer().deserialize(yaml)).toThrow(
      /Unsupported orm_version "4\.0"/,
    );
  });
});
