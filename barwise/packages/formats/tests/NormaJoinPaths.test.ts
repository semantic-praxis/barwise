/**
 * NORMA join-path import (role-path spec WS6 / PR 4).
 *
 * The personCountryDemo fixture carries a join equality -- "Each Person
 * was born in the same Country of which that Person is a citizen" -- as
 * an EqualityConstraint whose two role sequences each declare a join
 * path. The importer must decode the purpose-tagged pathed roles into
 * `{ root, steps, projection }` operands; sequences outside the minimal
 * grammar fall back to the flat mapping.
 */
import { isJoinEquality, ValidationEngine } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importNormaXml } from "../src/norma/NormaXmlImporter.js";
import { parseNormaXml } from "../src/norma/NormaXmlParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
}

const BORN_IN_PERSON = "_FAB10000-0000-4000-8000-000000000002";
const BORN_IN_COUNTRY = "_FAB10000-0000-4000-8000-000000000003";
const CITIZEN_PERSON = "_FAC20000-0000-4000-8000-000000000002";
const CITIZEN_COUNTRY = "_FAC20000-0000-4000-8000-000000000003";

describe("NORMA join path parsing", () => {
  const doc = parseNormaXml(loadFixture("personCountryDemo.orm"));

  it("parses the join paths on the equality constraint's role sequences", () => {
    const eq = doc.constraints.find((c) => c.type === "equality");
    expect(eq).toBeDefined();
    if (eq?.type !== "equality") throw new Error("unreachable");

    expect(eq.roleSequences).toHaveLength(2);
    expect(eq.joinPaths).toBeDefined();
    expect(eq.joinPaths!.filter(Boolean)).toHaveLength(2);

    const first = eq.joinPaths![0]!;
    expect(first.rolePath.rootObjectTypeRef).toBe("_08FCB217-4D5A-4D6E-BB08-033359BFEF51");
    expect(first.rolePath.pathedRoles.map((p) => p.purpose)).toEqual([
      "None",
      "SameFactType",
    ]);
    expect(first.projections).toHaveLength(2);
  });
});

describe("NORMA join path import", () => {
  const model = importNormaXml(loadFixture("personCountryDemo.orm"));

  function findJoinEquality() {
    for (const ft of model.factTypes) {
      const c = ft.constraints.find(isJoinEquality);
      if (c) return c;
    }
    return undefined;
  }

  it("imports the join equality instead of dropping it", () => {
    const c = findJoinEquality();
    expect(c).toBeDefined();
    expect(c!.operands).toHaveLength(2);
  });

  it("decodes each operand as a one-hop path rooted at Person", () => {
    const c = findJoinEquality()!;
    const person = model.getObjectTypeByName("Person")!;

    const [bornIn, citizen] = c.operands;
    expect(bornIn!.path.root).toBe(person.id);
    expect(bornIn!.path.steps).toEqual([
      { entry: BORN_IN_PERSON, exit: BORN_IN_COUNTRY },
    ]);
    expect(bornIn!.projection).toEqual([0, 1]);

    expect(citizen!.path.root).toBe(person.id);
    expect(citizen!.path.steps).toEqual([
      { entry: CITIZEN_PERSON, exit: CITIZEN_COUNTRY },
    ]);
    expect(citizen!.projection).toEqual([0, 1]);
  });

  it("preserves NORMA object-type ids so the path root is id-stable", () => {
    const person = model.getObjectTypeByName("Person")!;
    expect(person.id).toBe("_08FCB217-4D5A-4D6E-BB08-033359BFEF51");
  });

  it("keeps the imported model valid", () => {
    const validator = new ValidationEngine();
    expect(validator.errors(model)).toHaveLength(0);
  });

  it("verbalizes the join equality", () => {
    const verbalizer = new Verbalizer();
    const texts = verbalizer.verbalizeModel(model).map((v) => v.text);
    expect(texts.some((t) => t.includes("was born in"))).toBe(true);
    expect(texts.some((t) => t.includes("is a citizen of"))).toBe(true);
  });
});

describe("NORMA join path fallbacks", () => {
  function equalityXml(joinRule1: string, joinRule2: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<ormRoot:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore" xmlns:ormRoot="http://schemas.neumont.edu/ORM/2006-04/ORMRoot">
  <orm:ORMModel id="_M1" Name="JoinFallback">
    <orm:Objects>
      <orm:EntityType id="_P" Name="Person" _ReferenceMode="id">
        <orm:PlayedRoles>
          <orm:Role ref="_R1" />
          <orm:Role ref="_R3" />
        </orm:PlayedRoles>
      </orm:EntityType>
      <orm:EntityType id="_C" Name="Country" _ReferenceMode="name">
        <orm:PlayedRoles>
          <orm:Role ref="_R2" />
          <orm:Role ref="_R4" />
        </orm:PlayedRoles>
      </orm:EntityType>
    </orm:Objects>
    <orm:Facts>
      <orm:Fact id="_F1" _Name="PersonWasBornInCountry">
        <orm:FactRoles>
          <orm:Role id="_R1" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_P" />
          </orm:Role>
          <orm:Role id="_R2" _IsMandatory="false" _Multiplicity="ZeroToOne" Name="">
            <orm:RolePlayer ref="_C" />
          </orm:Role>
        </orm:FactRoles>
        <orm:ReadingOrders>
          <orm:ReadingOrder id="_RO1">
            <orm:Readings>
              <orm:Reading id="_RD1">
                <orm:Data>{0} was born in {1}</orm:Data>
              </orm:Reading>
            </orm:Readings>
            <orm:RoleSequence>
              <orm:Role ref="_R1" />
              <orm:Role ref="_R2" />
            </orm:RoleSequence>
          </orm:ReadingOrder>
        </orm:ReadingOrders>
      </orm:Fact>
      <orm:Fact id="_F2" _Name="PersonIsCitizenOfCountry">
        <orm:FactRoles>
          <orm:Role id="_R3" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_P" />
          </orm:Role>
          <orm:Role id="_R4" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_C" />
          </orm:Role>
        </orm:FactRoles>
        <orm:ReadingOrders>
          <orm:ReadingOrder id="_RO2">
            <orm:Readings>
              <orm:Reading id="_RD2">
                <orm:Data>{0} is a citizen of {1}</orm:Data>
              </orm:Reading>
            </orm:Readings>
            <orm:RoleSequence>
              <orm:Role ref="_R3" />
              <orm:Role ref="_R4" />
            </orm:RoleSequence>
          </orm:ReadingOrder>
        </orm:ReadingOrders>
      </orm:Fact>
    </orm:Facts>
    <orm:Constraints>
      <orm:EqualityConstraint id="_EQ1" Name="EqualityConstraint1">
        <orm:RoleSequences>
          <orm:RoleSequence id="_S1">
            <orm:Role ref="_R1" />
            <orm:Role ref="_R2" />
            ${joinRule1}
          </orm:RoleSequence>
          <orm:RoleSequence id="_S2">
            <orm:Role ref="_R3" />
            <orm:Role ref="_R4" />
            ${joinRule2}
          </orm:RoleSequence>
        </orm:RoleSequences>
      </orm:EqualityConstraint>
    </orm:Constraints>
  </orm:ORMModel>
</ormRoot:ORM2>`;
  }

  const validJoinRule = `<orm:JoinRule>
              <orm:JoinPath id="_JP2">
                <orm:PathComponents>
                  <orm:RolePath id="_RP2">
                    <orm:RootObjectType ref="_P" />
                    <orm:PathedRoles>
                      <orm:PathedRole id="_PR3" ref="_R3" />
                      <orm:PathedRole id="_PR4" ref="_R4" Purpose="SameFactType" />
                    </orm:PathedRoles>
                  </orm:RolePath>
                </orm:PathComponents>
              </orm:JoinPath>
            </orm:JoinRule>`;

  it("converts the flat side of a mixed flat/join comparison to a one-hop operand", () => {
    // Only the second sequence declares a join path; the first (flat,
    // two roles in one fact type) converts to the equivalent operand.
    const model = importNormaXml(equalityXml("", validJoinRule));
    const joins = model.factTypes.flatMap((ft) => ft.constraints.filter(isJoinEquality));
    expect(joins).toHaveLength(1);
    expect(joins[0]!.operands).toHaveLength(2);
    expect(joins[0]!.operands[0]!.path.steps).toEqual([{ entry: "_R1", exit: "_R2" }]);
    // No recorded projection: defaults to the (root, endpoint) pair.
    expect(joins[0]!.operands[1]!.projection).toEqual([0, 1]);
  });

  it("falls back to the flat equality when a join path is outside the grammar", () => {
    // A dangling entry role (no SameFactType exit) is not a linear path.
    const danglingRule = `<orm:JoinRule>
              <orm:JoinPath id="_JP3">
                <orm:PathComponents>
                  <orm:RolePath id="_RP3">
                    <orm:RootObjectType ref="_P" />
                    <orm:PathedRoles>
                      <orm:PathedRole id="_PR5" ref="_R3" />
                    </orm:PathedRoles>
                  </orm:RolePath>
                </orm:PathComponents>
              </orm:JoinPath>
            </orm:JoinRule>`;
    const model = importNormaXml(equalityXml("", danglingRule));
    const joins = model.factTypes.flatMap((ft) => ft.constraints.filter(isJoinEquality));
    expect(joins).toHaveLength(0);
    const flats = model.factTypes.flatMap((ft) =>
      ft.constraints.filter((c) => c.type === "equality")
    );
    expect(flats).toHaveLength(1);
  });
});
