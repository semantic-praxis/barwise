/**
 * Writing a format 4.0 document (iri-identity WS6, 6b-2b-2b-1): every
 * tracked model, replayed, writes a document the 4.0 schema accepts and
 * the 4.0 reader reads back to the same document; an element the model
 * left unnamed is written without an id; and the key a minted id was
 * minted from is written beside it, kept by the reader, and dropped with
 * the id. A lenient 4.0 load of what cannot be named gives one model on
 * every read.
 */
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/orm-model-4.0.schema.json" with { type: "json" };
import { mintedKey } from "../../src/model/mint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import {
  OrmYamlSerializer,
  readDocument40,
  writeDocument,
  writeDocument40,
} from "../../src/serialization/OrmYamlSerializer.js";
import { replayInto40 } from "../../src/serialization/replay.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
/** The document as YAML would carry it: no undefined keys, plain objects. */
const plain = (doc: unknown) => JSON.parse(JSON.stringify(doc));

/** Person smokes; Smoker is a Person. */
function smokers(config: { idsAcrossKinds?: boolean; } = {}): OrmModel {
  const model = new OrmModel({ name: "M", idsAcrossKinds: config.idsAcrossKinds ?? true });
  model.addObjectType({ id: "Person", name: "Person", kind: "entity", referenceMode: "nr" });
  model.addObjectType({ id: "Smoker", name: "Smoker", kind: "entity", referenceMode: "nr" });
  model.addFactType({
    id: "Person_smokes",
    name: "Person smokes",
    roles: [{ id: "Person_smokes.smokes", name: "smokes", playerId: "Person" }],
    readings: ["{0} smokes"],
    constraints: [{ type: "mandatory", roleId: "Person_smokes.smokes" }],
  });
  model.addSubtypeFact({ subtypeId: "Smoker", supertypeId: "Person" });
  return model;
}

describe("writing a format 4.0 document", () => {
  const corpus = modelCorpus();

  it.each(corpus.map((c) => [c.file, c] as const))(
    "%s, replayed, writes a 4.0 document that reads back to itself",
    (_, c) => {
      const model = replayInto40(new OrmYamlSerializer().deserialize(JSON.stringify(c.doc)));
      const doc = plain(writeDocument40(model));
      expect(doc.orm_version).toBe("4.0");
      expect([c.file, validate(doc) ? [] : validate.errors]).toEqual([c.file, []]);
      expect(plain(writeDocument40(readDocument40(doc)))).toEqual(doc);
    },
  );

  it("states minted_from beside the ids the replay minted, across the corpus", () => {
    // A guard on the round trip above: it shows minted_from survives only
    // if some document carries one.
    const keys = corpus.flatMap((c) => {
      const model = replayInto40(new OrmYamlSerializer().deserialize(JSON.stringify(c.doc)));
      return JSON.stringify(writeDocument40(model)).match(/"minted_from"/g) ?? [];
    });
    expect(keys.length).toBeGreaterThan(100);
  });

  it("writes each minted id's key beside it, and none beside a stated id", () => {
    const model = smokers();
    const doc = plain(writeDocument40(model));
    const [constraint] = doc.model.fact_types[0].constraints;
    const [subtypeFact] = doc.model.subtype_facts;
    expect(constraint.id).toBe("Each_Person_smokes");
    expect(constraint.minted_from).toBe(
      mintedKey({
        kind: "constraint",
        inView: [model.factTypes[0]!.internalConstraints[0]!, model.factTypes[0]!],
      }, model),
    );
    expect(subtypeFact).toMatchObject({
      id: "Smoker_is_a_subtype_of_Person",
      minted_from: expect.stringContaining('"subtype":"Smoker"'),
    });
    expect(doc.model.object_types[0]).not.toHaveProperty("minted_from");
    expect(doc.model.fact_types[0]).not.toHaveProperty("minted_from");
  });

  it("keeps the key a file states, not the one the model would mint now", () => {
    const doc = plain(writeDocument40(smokers()));
    doc.model.subtype_facts[0].minted_from = '{"stated":"by the file"}';
    const model = readDocument40(doc);
    expect(model.mintedFromOf("Smoker_is_a_subtype_of_Person")).toBe('{"stated":"by the file"}');
    expect(plain(writeDocument40(model)).model.subtype_facts[0].minted_from).toBe(
      '{"stated":"by the file"}',
    );
  });

  it("drops a key with its id, so an element stating that id later has none", () => {
    const model = smokers();
    model.removeSubtypeFact("Smoker_is_a_subtype_of_Person");
    expect(model.mintedFromOf("Smoker_is_a_subtype_of_Person")).toBeUndefined();
    model.addSubtypeFact({
      id: "Smoker_is_a_subtype_of_Person",
      subtypeId: "Smoker",
      supertypeId: "Person",
    });
    expect(plain(writeDocument40(model)).model.subtype_facts[0]).not.toHaveProperty("minted_from");
  });

  it("drops the keys of a removed fact type's constraints", () => {
    const model = smokers();
    expect(model.mintedFromOf("Each_Person_smokes")).toBeDefined();
    model.removeFactType("Person_smokes");
    expect(model.mintedFromOf("Each_Person_smokes")).toBeUndefined();
  });

  it("keeps the key of a constraint across fact types and of an objectification", () => {
    const model = smokers();
    model.addObjectType({ id: "Habit", name: "Habit", kind: "entity", referenceMode: "nr" });
    model.addFactType({
      id: "Person_runs",
      name: "Person runs",
      roles: [{ id: "Person_runs.runs", name: "runs", playerId: "Person" }],
      readings: ["{0} runs"],
    });
    const c = model.addConstraint({
      type: "exclusion",
      roleIds: ["Person_smokes.smokes", "Person_runs.runs"],
    });
    const o = model.addObjectifiedFactType({ factTypeId: "Person_runs", objectTypeId: "Habit" });
    const doc = plain(writeDocument40(model));
    expect(doc.model.constraints[0].minted_from).toEqual(expect.any(String));
    expect(doc.model.objectified_fact_types[0].minted_from).toEqual(expect.any(String));
    model.removeConstraint(c);
    model.removeObjectifiedFactType(o);
    expect([model.mintedFromOf(c.id!), model.mintedFromOf(o.id!)]).toEqual([undefined, undefined]);
  });

  it("writes the key right after the id it names", () => {
    const [subtypeFact] = plain(writeDocument40(smokers())).model.subtype_facts;
    expect(Object.keys(subtypeFact).slice(0, 2)).toEqual(["id", "minted_from"]);
  });

  it("never passes a key to an element that states the id, in a model that admits a repeat", () => {
    const model = smokers({ idsAcrossKinds: false });
    model.addFactType({
      id: "Person_runs",
      name: "Person runs",
      roles: [{ id: "Person_runs.runs", name: "runs", playerId: "Person" }],
      readings: ["{0} runs"],
    });
    const a = model.addConstraint({
      type: "exclusion",
      roleIds: ["Person_smokes.smokes", "Person_runs.runs"],
    });
    expect(model.mintedFromOf(a.id!)).toBeDefined();
    model.addConstraint({
      id: a.id!,
      type: "equality",
      roleIds: ["Person_smokes.smokes", "Person_runs.runs"],
    });
    model.removeConstraint(a);
    expect(model.mintedFromOf(a.id!)).toBeUndefined();
  });

  it("refuses a key for an id nothing holds", () => {
    expect(() => smokers().recordMintedFrom("Nobody", "{}")).toThrow(/No element holds "Nobody"/);
  });

  it("writes an element the model left unnamed without an id", () => {
    const model = new OrmModel({ name: "M", idsAcrossKinds: true });
    model.addObjectType({ id: "Person", name: "Person", kind: "entity", referenceMode: "nr" });
    model.addSubtypeFact({ subtypeId: "Ghost", supertypeId: "Person" }, {
      skipPlayerValidation: true,
    });
    model.addConstraint({ type: "external_uniqueness", roleIds: ["nowhere.a", "nowhere.b"] });
    const doc = plain(writeDocument40(model));
    expect(doc.model.subtype_facts).toEqual([{ subtype: "Ghost", supertype: "Person" }]);
    expect(doc.model.constraints).toEqual([
      { type: "external_uniqueness", roles: ["nowhere.a", "nowhere.b"] },
    ]);
    expect(validate(doc)).toBe(true);
    // The 3.0 writer cannot state either, and says why.
    expect(() => writeDocument(model)).toThrow(/Format 3\.0 states every constraint's id/);
    model.removeConstraint(model.constraints[0]!);
    expect(() => writeDocument(model)).toThrow(/Format 3\.0 states every subtype fact's id/);
  });

  it("refuses to write an unnamed constraint as 3.0, which states every id", () => {
    const model = new OrmModel({ name: "M", idsAcrossKinds: true });
    model.addConstraint({ type: "external_uniqueness", roleIds: ["nowhere.a", "nowhere.b"] });
    expect(() => writeDocument(model)).toThrow(
      /Format 3\.0 states every constraint's id, and this external_uniqueness constraint has none/,
    );
  });

  it("gives one model on every lenient read of what cannot be named", () => {
    // Required by 6b-2b-1's review: a constraint and a subtype fact whose
    // references dangle, so neither can be minted.
    const doc = plain(writeDocument40(smokers()));
    doc.model.constraints = [{ type: "external_uniqueness", roles: ["Gone.a", "Gone.b"] }];
    doc.model.subtype_facts.push({ subtype: "Ghost", supertype: "Person" });
    const read = () => plain(writeDocument40(readDocument40(doc, { lenient: true })));
    const first = read();
    expect(first.model.constraints).toEqual([
      { type: "external_uniqueness", roles: ["Gone.a", "Gone.b"] },
    ]);
    expect(first.model.subtype_facts[1]).toEqual({ subtype: "Ghost", supertype: "Person" });
    expect(read()).toEqual(first);
  });

  it("still names an unmintable constraint in a model that writes 3.0", () => {
    const model = new OrmModel({ name: "M" });
    const stored = model.addConstraint({
      type: "external_uniqueness",
      roleIds: ["nowhere.a", "nowhere.b"],
    });
    expect(stored.id).toBeDefined();
    expect(model.mintedFromOf(stored.id!)).toBeUndefined();
  });
});
