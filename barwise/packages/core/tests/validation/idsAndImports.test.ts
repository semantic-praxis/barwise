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
import { renameInModel } from "../../src/rename/renameInModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { projectRules } from "../../src/validation/rules/projectRules.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

const serializer = new OrmYamlSerializer();
const read = (yaml: string) => serializer.deserialize(yaml, { lenient: true });
const found = (model: OrmModel, rule: string) =>
  new ValidationEngine().validate(model).filter((d) => d.ruleId === rule);

/** A 3.x fact type with a role named `population`, and a population. */
const CITY = `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: City, kind: entity, reference_mode: name }
  fact_types:
    - id: f1
      name: City has Count
      roles:
        - { id: r1, player: u1, role_name: has }
        - { id: r2, player: u1, role_name: population }
      readings: ["{0} has {1}"]
  populations:
    - { id: p1, fact_type: f1, instances: [{ id: p1.1, role_values: { r1: Oslo, r2: Bergen } }] }
`;

/** Two populations; the second states the id the first's instance would take. */
const TWO_POPULATIONS = `orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: City, name: City, kind: entity, reference_mode: name }
  fact_types:
    - id: City_exists
      name: City exists
      roles:
        - { id: City_exists.exists, player: City, role_name: exists }
      readings: ["{0} exists"]
  populations:
    - id: City_exists.population_2
      fact_type: City_exists
      instances: [{ id: City_exists.population_2.1, role_values: { City_exists.exists: Oslo } }]
    - id: City_exists.population_3
      fact_type: City_exists
      instances: [{ id: City_exists.population.1, role_values: { City_exists.exists: Rome } }]
`;

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
        'The object type "Person" has the id "Human", where its name gives "Person". Renaming it, even to the name it has, gives it that id.',
      ],
      [
        "warning",
        "Person_smokes.puffs",
        'The role "smokes" has the id "Person_smokes.puffs", where its name gives "Person_smokes.smokes". Renaming it, even to the name it has, gives it that id.',
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

  it("reports a population whose id took a suffix because a role held it, and rename repairs it", () => {
    // 6b-3b's pr-review: main's name-based check warned here, and the
    // id-based one had nothing until populations were checked (decision 7).
    const model = read(CITY);
    expect(found(model, "structural/id-not-from-name").map((d) => d.message)).toEqual([
      'The population of fact type "City has Count" has the suffixed id "City_has_Count.population_2", because a role holds "City_has_Count.population", the id its fact type gives. Rename the role, and the population takes that id.',
    ]);
    const { model: renamed } = renameInModel(model, {
      kind: "role",
      factType: "City has Count",
      role: "population",
    }, "residents");
    expect(renamed.populations[0]).toMatchObject({ id: "City_has_Count.population" });
    expect(renamed.populations[0]!.instances[0]!.id).toBe("City_has_Count.population.1");
    expect(found(renamed, "structural/id-not-from-name")).toEqual([]);
  });

  it("keeps a renamed fact type's population suffixed while its role still holds the id", () => {
    // The guard against mapping the role and the population onto one id.
    const model = read(CITY);
    const { model: renamed } = renameInModel(
      model,
      { kind: "factType", name: "City has Count" },
      "Town has Count",
    );
    expect(renamed.getFactType("Town_has_Count")!.roles[1]!.id).toBe("Town_has_Count.population");
    expect(renamed.populations[0]!.id).toBe("Town_has_Count.population_2");
  });

  it("refuses a rename to the name it has that repairs nothing", () => {
    // The role still holds <ft>.population, so the population cannot move.
    const model = read(CITY);
    expect(() =>
      renameInModel(model, { kind: "factType", name: "City has Count" }, "City has Count")
    ).toThrow(/already named "City has Count", and holds the id it gives/);
  });

  it("repairs a population whose id came from elsewhere by renaming its fact type to the name it has", () => {
    const model = read(`orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: City, name: City, kind: entity, reference_mode: name }
  fact_types:
    - id: City_exists
      name: City exists
      roles:
        - { id: City_exists.exists, player: City, role_name: exists }
      readings: ["{0} exists"]
  populations:
    - { id: Census.population, fact_type: City_exists, instances: [{ id: Census.population.1, role_values: { City_exists.exists: Oslo } }] }
`);
    expect(found(model, "structural/id-not-from-name").map((d) => d.message)).toEqual([
      'The population of fact type "City exists" has the id "Census.population", where its fact type gives "City_exists.population". Renaming the fact type, even to the name it has, gives it that id.',
    ]);
    const { model: renamed } = renameInModel(
      model,
      { kind: "factType", name: "City exists" },
      "City exists",
    );
    expect(renamed.populations[0]!.id).toBe("City_exists.population");
    expect(renamed.populations[0]!.instances[0]!.id).toBe("City_exists.population.1");
  });

  it("does not give two instances one id when repairing a population", () => {
    // A second population states, by hand, the id the first's instance
    // would take; instance ids are not in the model's id index. 4.0, since
    // the replay re-mints every instance id.
    const model = read(`orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: City, name: City, kind: entity, reference_mode: name }
  fact_types:
    - id: City_has_Count
      name: City has Count
      roles:
        - { id: City_has_Count.has, player: City, role_name: has }
        - { id: City_has_Count.population, player: City, role_name: population }
      readings: ["{0} has {1}"]
  populations:
    - id: City_has_Count.population_2
      fact_type: City_has_Count
      instances: [{ id: City_has_Count.population_2.1, role_values: { City_has_Count.has: Oslo } }]
    - id: City_has_Count.population_3
      fact_type: City_has_Count
      instances: [{ id: City_has_Count.population.1, role_values: { City_has_Count.has: Rome } }]
`);
    const { model: renamed } = renameInModel(model, {
      kind: "role",
      factType: "City has Count",
      role: "population",
    }, "residents");
    const instanceIds = renamed.populations.flatMap((p) => p.instances.map((i) => i.id));
    expect(new Set(instanceIds).size).toBe(instanceIds.length);
  });

  it("keeps instance ids apart when a fact type rename moves both populations", () => {
    // 6b-3b's third pr-review pass: the clash check must see the other
    // population's instance ids as the rename leaves them.
    const model = read(TWO_POPULATIONS);
    const { model: renamed } = renameInModel(
      model,
      { kind: "factType", name: "City exists" },
      "Town exists",
    );
    const instanceIds = renamed.populations.flatMap((p) => p.instances.map((i) => i.id));
    expect(new Set(instanceIds).size).toBe(instanceIds.length);
  });

  it("refuses a rename to the name it has when the repair is skipped", () => {
    expect(() =>
      renameInModel(read(TWO_POPULATIONS), { kind: "factType", name: "City exists" }, "City exists")
    ).toThrow(/would leave fact type "City exists" as it is/);
  });

  it("does not blame a role for a lone suffixed population when no role holds the id", () => {
    const lone = read(TWO_POPULATIONS.replace(/ {4}- id: City_exists\.population_3[\s\S]*$/, ""));
    expect(found(lone, "structural/id-not-from-name").map((d) => d.message)).toEqual([
      'The population of fact type "City exists" has the id "City_exists.population_2", where its fact type gives "City_exists.population". Renaming the fact type, even to the name it has, gives it that id.',
    ]);
  });

  it("does not report a fact type's second population, which the suffix rule names", () => {
    const model = read(SMOKERS.replace(
      "  subtype_facts:",
      `  populations:
    - { id: Person_smokes.population, fact_type: Person_smokes, instances: [] }
    - { id: Person_smokes.population_2, fact_type: Person_smokes, instances: [] }
  subtype_facts:`,
    ));
    expect(model.populations.map((p) => p.id)).toEqual([
      "Person_smokes.population",
      "Person_smokes.population_2",
    ]);
    expect(found(model, "structural/id-not-from-name")).toEqual([]);
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
    expect(() => model.setImport("a", "")).toThrow(/bound to nothing/);
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

  it("is carried by a merge: the base's first, then each an accepted shadow uses", () => {
    const base = read(BILLING);
    const incoming = read(
      BILLING.replace(
        'imports: { sales: sales, ext: "https://example.com/ns/" }',
        "imports: { sales: sales, crm: crm, unused: hr }",
      ).replace(
        "    - { id: Invoice,",
        '    - { id: "crm:Lead", name: Lead, kind: entity, reference_mode: nr }\n    - { id: Invoice,',
      ),
    );
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    const lead = diff.deltas.findIndex((d) =>
      d.elementType === "object_type" && d.kind === "added"
    );
    expect(lead).toBeGreaterThanOrEqual(0);
    expect([...mergeModels(base, incoming, diff, new Set([lead])).imports]).toEqual([
      ["sales", "sales"],
      ["ext", "https://example.com/ns/"],
      ["crm", "crm"],
    ]);
    // Not accepted, the shadow is not merged, and neither is its alias.
    expect([...mergeModels(base, incoming, diff, new Set()).imports]).toEqual([
      ["sales", "sales"],
      ["ext", "https://example.com/ns/"],
    ]);
  });
});

describe("a merge whose sides bind one alias to different contexts", () => {
  it("is refused, naming the alias and both bindings", () => {
    const side = (target: string) =>
      read(`orm_version: "4.0"
model:
  name: billing
  imports: { x: ${target} }
  object_types:
    - { id: "x:Invoice", name: Invoice, kind: entity, reference_mode: nr }
`);
    const base = side("crm");
    const incoming = side("billing");
    expect(() =>
      mergeModels(base, incoming, diffModels(base, incoming, MERGE_DIFF_OPTIONS), new Set())
    ).toThrow(/the alias "x" is bound to "crm" in the base and to "billing" in the incoming model/);
  });
});

describe("the replay, given two contexts with one local name", () => {
  it("gives two shadows of one context one alias and one import", () => {
    const model = read(`orm_version: "3.0"
model:
  name: billing
  object_types:
    - { id: s1, name: Lead, kind: entity, reference_mode: nr, source_context: sales }
    - { id: s2, name: Deal, kind: entity, reference_mode: nr, source_context: sales }
`);
    expect(model.objectTypes.map((o) => o.id)).toEqual(["sales:Lead", "sales:Deal"]);
    expect([...model.imports]).toEqual([["sales", "sales"]]);
  });

  it("gives the second its own alias, so no shadow names the wrong context", () => {
    const model = read(`orm_version: "3.0"
model:
  name: billing
  object_types:
    - { id: s1, name: Lead, kind: entity, reference_mode: nr, source_context: Sales Ops }
    - { id: s2, name: Deal, kind: entity, reference_mode: nr, source_context: Sales_Ops }
`);
    expect(model.objectTypes.map((o) => o.id)).toEqual(["Sales_Ops:Lead", "Sales_Ops_2:Deal"]);
    expect([...model.imports]).toEqual([["Sales_Ops", "Sales Ops"], ["Sales_Ops_2", "Sales_Ops"]]);
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
