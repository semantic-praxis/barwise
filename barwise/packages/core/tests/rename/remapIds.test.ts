/**
 * `remapIds`, held to the tracked corpus (iri-identity WS6, 6b-3b): an
 * identity map gives back the same file, so no field is dropped; and a map
 * of every id gives the same model under the new ids, so no reference is
 * left behind.
 */
import { describe, expect, it } from "vitest";
import { remapIds } from "../../src/rename/remapIds.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { replayInto40 } from "../../src/serialization/replay.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

const serializer = new OrmYamlSerializer();
const corpus = modelCorpus().map((c) => ({
  file: c.file,
  model: replayInto40(serializer.deserializeAsWritten(JSON.stringify(c.doc))),
}));

/** Every id the model holds, of every kind it writes. */
function idsOf(model: ReturnType<typeof replayInto40>): string[] {
  return [
    ...model.objectTypes.map((e) => e.id),
    ...model.factTypes.flatMap((ft) => [ft.id, ...ft.roles.map((r) => r.id)]),
    ...model.everyConstraint().map(([c]) => c.id),
    ...model.subtypeFacts.map((e) => e.id),
    ...model.objectifiedFactTypes.map((e) => e.id),
    ...model.populations.flatMap((p) => [p.id, ...p.instances.map((i) => i.id)]),
  ].filter((id): id is string => id !== undefined);
}

describe("remapIds over the corpus", () => {
  it.each(corpus.map((c) => [c.file, c.model] as const))(
    "%s: an identity map writes the same file",
    (_, model) => {
      expect(serializer.serialize(remapIds(model, new Map()))).toBe(serializer.serialize(model));
    },
  );

  it.each(corpus.map((c) => [c.file, c.model] as const))(
    "%s: a map of every id writes the same file under the new ids",
    (_, model) => {
      // A suffix no id holds, kept a local name; a shadow's alias stays.
      const ids = new Map(idsOf(model).map((id) => [id, `${id}_r`] as const));
      const remapped = serializer.serialize(remapIds(model, ids));
      // Back by the inverse map, the file is the original.
      const back = new Map([...ids].map(([from, now]) => [now, from] as const));
      expect(
        serializer.serialize(remapIds(serializer.deserialize(remapped, { lenient: true }), back)),
      )
        .toBe(serializer.serialize(model));
      // And nothing still names an old id that was remapped.
      const written = serializer.deserialize(remapped, { lenient: true });
      expect(idsOf(written).filter((id) => ids.has(id))).toEqual([]);
    },
  );

  it("follows an id into a diagram's elements, positions and orientations", () => {
    // No tracked model has a diagram with positions, so the corpus cases
    // above never reach these (6b-3b's mutation pass).
    const model = serializer.deserialize(`orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Person, name: Person, kind: entity, reference_mode: nr }
  fact_types:
    - id: Person_smokes
      name: Person smokes
      roles:
        - { id: Person_smokes.smokes, player: Person, role_name: smokes }
      readings: ["{0} smokes"]
  diagrams:
    - name: Main
      elements: [Person]
      positions: { Person: { x: 1, y: 2 }, Person_smokes: { x: 3, y: 4 } }
      orientations: { Person_smokes: vertical }
`);
    const [layout] = remapIds(
      model,
      new Map([["Person", "Human"], ["Person_smokes", "Human_smokes"]]),
    ).diagramLayouts;
    expect([layout!.elements, layout!.positions, layout!.orientations]).toEqual([
      ["Human"],
      { Human: { x: 1, y: 2 }, Human_smokes: { x: 3, y: 4 } },
      { Human_smokes: "vertical" },
    ]);
  });

  it("keeps each minted key under its new id", () => {
    const model = corpus.find((c) => c.model.everyConstraint().some(([c]) => c.id))!.model;
    const [[c]] = model.everyConstraint().filter(([c]) => c.id !== undefined);
    const ids = new Map([[c!.id!, "Renamed_constraint"]]);
    expect(remapIds(model, ids).mintedFromOf("Renamed_constraint")).toBe(
      model.mintedFromOf(c!.id!),
    );
  });
});
