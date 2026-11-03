/**
 * The rules format 4.0 needs (iri-identity WS6, 6b-3b): an id that is not
 * the one its name gives (decision 13), a minted name whose element now
 * says something else (decision 14), an alias the model does not import,
 * and an import whose context the project does not supply; and the model's
 * `imports`, which the alias rules read.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { projectRules } from "../../src/validation/rules/projectRules.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

const serializer = new OrmYamlSerializer();
const read = (yaml: string) => serializer.deserialize(yaml, { lenient: true });
const found = (model: OrmModel, rule: string) =>
  new ValidationEngine().validate(model).filter((d) => d.ruleId === rule);

const SMOKERS = `orm_version: "4.0"
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
        - { type: mandatory, role: Person_smokes.smokes }
  subtype_facts:
    - { subtype: Smoker, supertype: Person }
`;

describe("structural/id-not-from-name (decision 13)", () => {
  it("says nothing of a model whose ids are the ones its names give", () => {
    expect(found(read(SMOKERS), "structural/id-not-from-name")).toEqual([]);
  });

  it("reports an object type, a fact type and a role whose ids differ, naming the id each name gives", () => {
    const model = read(
      SMOKERS.replace("{ id: Person, name: Person", "{ id: Human, name: Person")
        .replaceAll("player: Person", "player: Human")
        .replace("supertype: Person", "supertype: Human")
        .replace("{ id: Person_smokes.smokes,", "{ id: Person_smokes.puffs,")
        .replace("role: Person_smokes.smokes", "role: Person_smokes.puffs"),
    );
    expect(
      found(model, "structural/id-not-from-name").map((d) => [d.severity, d.elementId, d.message]),
    ).toEqual([
      [
        "warning",
        "Human",
        'The object type "Person" has the id "Human", where its name gives "Person". A rename gives it the id its name gives.',
      ],
      [
        "warning",
        "Person_smokes.puffs",
        'The role "smokes" has the id "Person_smokes.puffs", where its name gives "Person_smokes.smokes". A rename gives it the id its name gives.',
      ],
    ]);
  });

  it("says a suffixed id is suffixed, and why", () => {
    const model = read(`orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: Order Line, kind: entity, reference_mode: nr }
    - { id: u2, name: Order_Line, kind: entity, reference_mode: nr }
`);
    expect(found(model, "structural/id-not-from-name").map((d) => d.message)).toEqual([
      'The object type "Order_Line" has the suffixed id "Order_Line_2", because another element holds "Order_Line", the id its name gives. Rename one of them so each name gives its own id.',
    ]);
  });

  it("exempts a shadow, whose id is its owner's behind an alias", () => {
    const model = read(`orm_version: "4.0"
model:
  name: billing
  imports: { sales: sales }
  object_types:
    - { id: "sales:Order_Line_2", name: Order Line, kind: entity, reference_mode: nr }
`);
    expect(found(model, "structural/id-not-from-name")).toEqual([]);
  });

  it("exempts a fact type named like its objectifying type, until a rename ends the collision", () => {
    const marriage = (objectifier: string) =>
      read(`orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Person, name: Person, kind: entity, reference_mode: nr }
    - { id: ${objectifier}, name: ${objectifier}, kind: entity, reference_mode: nr }
  fact_types:
    - id: Person_marries_Person
      name: Marriage
      roles:
        - { id: Person_marries_Person.marries, player: Person, role_name: marries }
        - { id: Person_marries_Person.is_married_to, player: Person, role_name: is married to }
      readings: ["{0} marries {1}"]
  objectified_fact_types:
    - { fact_type: Person_marries_Person, object_type: ${objectifier} }
`);
    // Decision 20's id, from the first reading: exempt.
    expect(found(marriage("Marriage"), "structural/id-not-from-name")).toEqual([]);
    // The objectifying type renamed: the fact type's name now gives an id
    // nothing holds, which a rename of the fact type takes.
    expect(found(marriage("Wedding"), "structural/id-not-from-name").map((d) => d.elementId))
      .toEqual(["Person_marries_Person"]);
  });
});

describe("structural/stale-minted-name (decision 14)", () => {
  it("says nothing while each minted id's element says what it was minted from", () => {
    expect(found(read(SMOKERS), "structural/stale-minted-name")).toEqual([]);
  });

  it("reports a minted id whose element now says something else", () => {
    // Stored, then the constraint changed by hand to a frequency of the
    // same role: its stored key no longer matches.
    const stored = serializer.serialize(read(SMOKERS));
    const changed = stored.replace(
      /type: mandatory/,
      "type: frequency\n          min: 2\n          max: 3",
    );
    const [d] = found(read(changed), "structural/stale-minted-name");
    expect([d?.severity, d?.elementId]).toEqual(["warning", "Each_Person_smokes"]);
    expect(d?.message).toContain("remove its minted_from to keep this one as chosen");
  });

  it("never reports an id with no stored key, which a person chose", () => {
    const stored = serializer.serialize(read(SMOKERS));
    const chosen = stored.replace(
      /\n\s+minted_from: .*\n(\s+)type: mandatory/,
      "\n$1type: frequency\n$1min: 2\n$1max: 3",
    );
    expect(chosen).not.toMatch(/minted_from: .*Each_Person_smokes/);
    expect(found(read(chosen), "structural/stale-minted-name")).toEqual([]);
  });
});

describe("imports and structural/alias-not-imported", () => {
  const BILLING = `orm_version: "4.0"
model:
  name: billing
  domain_context: billing
  imports: { sales: sales, ext: "https://example.com/ns/" }
  object_types:
    - { id: "sales:Order", name: Order, kind: entity, reference_mode: nr }
    - { id: Invoice, name: Invoice, kind: entity, reference_mode: nr }
`;

  it("reads imports, keeps their order, and writes them after the namespace", () => {
    const model = read(BILLING);
    expect([...model.imports]).toEqual([["sales", "sales"], ["ext", "https://example.com/ns/"]]);
    const text = serializer.serialize(model);
    expect(text).toMatch(
      /domain_context: billing\n {2}imports:\n {4}sales: sales\n {4}ext: https:\/\/example.com\/ns\/\n/,
    );
    expect([...read(text).imports]).toEqual([...model.imports]);
  });

  it("is an error for an alias the model does not import", () => {
    const model = read(BILLING.replace("imports: { sales: sales, ", "imports: { "));
    expect(found(model, "structural/alias-not-imported").map((d) => [d.severity, d.message]))
      .toEqual([[
        "error",
        '"sales:Order" names the alias "sales", which the model does not import. Add "sales" to its imports, bound to the context it means.',
      ]]);
    expect(found(read(BILLING), "structural/alias-not-imported")).toEqual([]);
  });

  it("refuses an alias that is not a local name, and an import bound to nothing", () => {
    const model = new OrmModel({ name: "M" });
    expect(() => model.setImport("a:b", "x")).toThrow(/not a local name/);
    expect(() => model.setImport("a", " ")).toThrow(/bound to nothing/);
  });

  it("is added by the replay for each shadow, bound to its context", () => {
    const model = read(`orm_version: "3.0"
model:
  name: billing
  object_types:
    - { id: s1, name: Order, kind: entity, reference_mode: nr, source_context: Sales Ops }
`);
    expect([...model.imports]).toEqual([["Sales_Ops", "Sales Ops"]]);
    expect(model.objectTypes[0]!.id).toBe("Sales_Ops:Order");
    expect(found(model, "structural/alias-not-imported")).toEqual([]);
  });

  it("is carried by a merge, the base's first, then each the incoming side adds", () => {
    const base = read(BILLING);
    const incoming = read(
      BILLING.replace(
        'imports: { sales: sales, ext: "https://example.com/ns/" }',
        "imports: { sales: other, crm: crm }",
      ),
    );
    const merged = mergeModels(
      base,
      incoming,
      diffModels(base, incoming, MERGE_DIFF_OPTIONS),
      new Set(),
    );
    expect([...merged.imports]).toEqual([
      ["sales", "sales"],
      ["ext", "https://example.com/ns/"],
      ["crm", "crm"],
    ]);
  });
});

describe("project/imported-context-missing", () => {
  const domain = (context: string, imports: string) =>
    read(`orm_version: "4.0"
model:
  name: ${context}
  domain_context: ${context}
  imports: { ${imports} }
`);

  it("warns of an import bound to a context no domain supplies, and not of an IRI", () => {
    const project = new OrmProject({ name: "P" });
    project.addDomain({ path: "sales.orm.yaml", context: "sales" }).setModel(
      domain("sales", "x: billing"),
    );
    project.addDomain({ path: "billing.orm.yaml", context: "billing" })
      .setModel(domain("billing", 'sales: sales, gone: crm, ext: "urn:example:ns"'));
    expect(
      projectRules(project)
        .filter((d) => d.ruleId === "project/imported-context-missing")
        .map((d) => [d.severity, d.message]),
    ).toEqual([[
      "warning",
      'Domain "billing" (billing.orm.yaml) imports "gone" as the context "crm", which no domain of this project supplies. Add that domain to the project, or bind "gone" to a context the project holds.',
    ]]);
  });
});
