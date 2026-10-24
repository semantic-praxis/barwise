/**
 * NORMA rings over a join path (`docs/specs/join-ring-constraint.spec.md`,
 * WS2).
 *
 * NORMA's `RingConstraintType` extends `SetConstraintWithJoinType`: one role
 * sequence, which may carry a `JoinRule`. Before WS2 the importer never read
 * it. A ring whose roles spanned fact types was dropped, and one whose two
 * roles happened to share a fact type was read as a flat ring over them. The
 * grandparent ring below is the second case: both projected roles belong to
 * the one parenthood fact type, so it imported as "no Person is their own
 * parent".
 */
import { type JoinRingConstraint, OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { importNormaXml } from "../src/norma/NormaXmlImporter.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";

/** Child then parent, joined to itself: the grandparent relation. */
const GRANDPARENT = `<orm:JoinRule>
          <orm:JoinPath id="_JP1">
            <orm:PathComponents>
              <orm:RolePath id="_RP1">
                <orm:RootObjectType ref="_P" />
                <orm:PathedRoles>
                  <orm:PathedRole id="_PR1" ref="_R1" />
                  <orm:PathedRole id="_PR2" ref="_R2" Purpose="SameFactType" />
                  <orm:PathedRole id="_PR3" ref="_R1" Purpose="PostInnerJoin" />
                  <orm:PathedRole id="_PR4" ref="_R2" Purpose="SameFactType" />
                </orm:PathedRoles>
              </orm:RolePath>
            </orm:PathComponents>
          </orm:JoinPath>
        </orm:JoinRule>`;

/** One hop: the parenthood relation itself. */
const PARENT = `<orm:JoinRule>
          <orm:JoinPath id="_JP1">
            <orm:PathComponents>
              <orm:RolePath id="_RP1">
                <orm:RootObjectType ref="_P" />
                <orm:PathedRoles>
                  <orm:PathedRole id="_PR1" ref="_R1" />
                  <orm:PathedRole id="_PR2" ref="_R2" Purpose="SameFactType" />
                </orm:PathedRoles>
              </orm:RolePath>
            </orm:PathComponents>
          </orm:JoinPath>
        </orm:JoinRule>`;

/** No pathed roles: outside the grammar the decoder reads. */
const UNREADABLE = `<orm:JoinRule>
          <orm:JoinPath id="_JP1">
            <orm:PathComponents>
              <orm:RolePath id="_RP1">
                <orm:RootObjectType ref="_P" />
              </orm:RolePath>
            </orm:PathComponents>
          </orm:JoinPath>
        </orm:JoinRule>`;

/** Child then liking: a path over two fact types. */
const CHILD_THEN_LIKES = `<orm:JoinRule>
          <orm:JoinPath id="_JP1">
            <orm:PathComponents>
              <orm:RolePath id="_RP1">
                <orm:RootObjectType ref="_P" />
                <orm:PathedRoles>
                  <orm:PathedRole id="_PR1" ref="_R1" />
                  <orm:PathedRole id="_PR2" ref="_R2" Purpose="SameFactType" />
                  <orm:PathedRole id="_PR3" ref="_R3" Purpose="PostInnerJoin" />
                  <orm:PathedRole id="_PR4" ref="_R4" Purpose="SameFactType" />
                </orm:PathedRoles>
              </orm:RolePath>
            </orm:PathComponents>
          </orm:JoinPath>
        </orm:JoinRule>`;

/** One hop whose projection names one column only: malformed for a ring. */
const ONE_COLUMN = `<orm:JoinRule>
          <orm:JoinPath id="_JP1">
            <orm:PathComponents>
              <orm:RolePath id="_RP1">
                <orm:RootObjectType ref="_P" />
                <orm:PathedRoles>
                  <orm:PathedRole id="_PR1" ref="_R1" />
                  <orm:PathedRole id="_PR2" ref="_R2" Purpose="SameFactType" />
                </orm:PathedRoles>
              </orm:RolePath>
            </orm:PathComponents>
            <orm:JoinPathProjections>
              <orm:JoinPathProjection id="_JPP1">
                <orm:ConstraintRoleProjection id="_CRP1" ref="_R2">
                  <orm:ProjectedFromPathedRole ref="_PR2" />
                </orm:ConstraintRoleProjection>
              </orm:JoinPathProjection>
            </orm:JoinPathProjections>
          </orm:JoinPath>
        </orm:JoinRule>`;

const listing = (fact: string, listedIn: readonly string[]) =>
  listedIn.includes(fact)
    ? `<orm:InternalConstraints><orm:RingConstraint ref="_RC1" /></orm:InternalConstraints>`
    : "";

/** A Person, parenthood (_F1) and liking (_F2), and one irreflexive ring. */
function document(joinRule: string, listed: boolean | readonly string[]): string {
  const listedIn = listed === true ? ["_F1"] : listed === false ? [] : listed;
  return `<?xml version="1.0" encoding="utf-8"?>
<ormRoot:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore" xmlns:ormRoot="http://schemas.neumont.edu/ORM/2006-04/ORMRoot">
  <orm:ORMModel id="_M1" Name="Family">
    <orm:Objects>
      <orm:EntityType id="_P" Name="Person" _ReferenceMode="id">
        <orm:PlayedRoles>
          <orm:Role ref="_R1" />
          <orm:Role ref="_R2" />
          <orm:Role ref="_R3" />
          <orm:Role ref="_R4" />
        </orm:PlayedRoles>
      </orm:EntityType>
    </orm:Objects>
    <orm:Facts>
      <orm:Fact id="_F1" _Name="PersonIsChildOfPerson">
        <orm:FactRoles>
          <orm:Role id="_R1" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_P" />
          </orm:Role>
          <orm:Role id="_R2" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_P" />
          </orm:Role>
        </orm:FactRoles>
        <orm:ReadingOrders>
          <orm:ReadingOrder id="_RO1">
            <orm:Readings>
              <orm:Reading id="_RD1">
                <orm:Data>{0} is child of {1}</orm:Data>
              </orm:Reading>
            </orm:Readings>
            <orm:RoleSequence>
              <orm:Role ref="_R1" />
              <orm:Role ref="_R2" />
            </orm:RoleSequence>
          </orm:ReadingOrder>
        </orm:ReadingOrders>
        ${listing("_F1", listedIn)}
      </orm:Fact>
      <orm:Fact id="_F2" _Name="PersonLikesPerson">
        <orm:FactRoles>
          <orm:Role id="_R3" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_P" />
          </orm:Role>
          <orm:Role id="_R4" _IsMandatory="false" _Multiplicity="ZeroToMany" Name="">
            <orm:RolePlayer ref="_P" />
          </orm:Role>
        </orm:FactRoles>
        <orm:ReadingOrders>
          <orm:ReadingOrder id="_RO2">
            <orm:Readings>
              <orm:Reading id="_RD2">
                <orm:Data>{0} likes {1}</orm:Data>
              </orm:Reading>
            </orm:Readings>
            <orm:RoleSequence>
              <orm:Role ref="_R3" />
              <orm:Role ref="_R4" />
            </orm:RoleSequence>
          </orm:ReadingOrder>
        </orm:ReadingOrders>
        ${listing("_F2", listedIn)}
      </orm:Fact>
    </orm:Facts>
    <orm:Constraints>
      <orm:RingConstraint id="_RC1" Name="RingConstraint1" Type="Irreflexive">
        <orm:RoleSequence>
          <orm:Role ref="_R1" />
          <orm:Role ref="_R2" />
          ${joinRule}
        </orm:RoleSequence>
      </orm:RingConstraint>
    </orm:Constraints>
  </orm:ORMModel>
</ormRoot:ORM2>`;
}

const rings = (model: OrmModel) => [
  ...model.factTypes.flatMap((ft) => ft.internalConstraints.filter((c) => c.type === "ring")),
  ...model.constraints.filter((c) => c.type === "join_ring"),
];

describe("a NORMA ring over a join path", () => {
  for (const listed of [true, false]) {
    describe(listed ? "listed in its fact's InternalConstraints" : "listed nowhere", () => {
      it("imports the grandparent ring as a join_ring, never a flat parent ring", () => {
        const model = importNormaXml(document(GRANDPARENT, listed));
        const found = rings(model);
        expect(found.map((c) => c.type)).toEqual(["join_ring"]);
        const jr = found[0] as JoinRingConstraint;
        expect(jr.ringType).toBe("irreflexive");
        expect(jr.operand.path.steps).toHaveLength(2);
        expect(jr.operand.projection).toEqual([0, 2]);
      });

      it("imports a one-hop path as the plain ring of that fact type", () => {
        const found = rings(importNormaXml(document(PARENT, listed)));
        expect(found).toMatchObject([{ type: "ring", ringType: "irreflexive" }]);
      });

      it("imports nothing, rather than a flat ring, for a path it cannot read", () => {
        expect(rings(importNormaXml(document(UNREADABLE, listed)))).toEqual([]);
      });
    });
  }

  // From the review of WS2: each of these reproduced against its first draft.
  it("maps a one-hop ring listed under another fact type onto its hop's fact type", () => {
    const model = importNormaXml(document(PARENT, ["_F2"]));
    expect(model.getFactType("_F1")?.internalConstraints.filter((c) => c.type === "ring"))
      .toHaveLength(1);
    expect(rings(model)).toHaveLength(1);
  });

  it("maps a join ring that two fact types list once", () => {
    const found = rings(importNormaXml(document(CHILD_THEN_LIKES, ["_F1", "_F2"])));
    expect(found.map((c) => c.type)).toEqual(["join_ring"]);
  });

  it("keeps a one-column projection as a join_ring, for validation to report", () => {
    const found = rings(importNormaXml(document(ONE_COLUMN, true)));
    expect(found).toMatchObject([{ type: "join_ring", operand: { projection: [1] } }]);
  });

  it("round-trips a join_ring through NORMA export", () => {
    const model = importNormaXml(document(GRANDPARENT, true));
    const back = importNormaXml(serializeNormaDocument(writeOrmToNorma(model)));
    const [before] = model.constraints.filter((c) => c.type === "join_ring");
    const [after] = back.constraints.filter((c) => c.type === "join_ring");
    expect(after).toEqual(before);
  });
});
