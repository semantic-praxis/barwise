/**
 * Tests for the NormaXmlParser.
 *
 * Verifies XML parsing of NORMA .orm files into the NormaDocument
 * intermediate representation. Uses hand-crafted XML fixtures that
 * mirror NORMA's documented format without embedding NORMA source.
 */
import { describe, expect, it } from "vitest";
import { NormaParseError, parseNormaXml } from "../src/NormaXmlParser.js";

/** Minimal valid NORMA XML wrapper. */
function wrap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<orm:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore">
  <orm:ORMModel id="_model1" Name="TestModel">
    ${body}
  </orm:ORMModel>
</orm:ORM2>`;
}

describe("NormaXmlParser", () => {
  describe("basic structure", () => {
    it("parses an empty model", () => {
      const xml = wrap("");
      const doc = parseNormaXml(xml);

      expect(doc.modelId).toBe("_model1");
      expect(doc.modelName).toBe("TestModel");
      expect(doc.entityTypes).toHaveLength(0);
      expect(doc.valueTypes).toHaveLength(0);
      expect(doc.objectifiedTypes).toHaveLength(0);
      expect(doc.factTypes).toHaveLength(0);
      expect(doc.subtypeFacts).toHaveLength(0);
      expect(doc.constraints).toHaveLength(0);
      expect(doc.dataTypes).toHaveLength(0);
    });

    it("throws NormaParseError for malformed XML", () => {
      expect(() => parseNormaXml("<not closed")).toThrow(NormaParseError);
    });

    it("throws NormaParseError when ORM2 root is missing", () => {
      const xml = `<?xml version="1.0"?><SomeOtherRoot/>`;
      expect(() => parseNormaXml(xml)).toThrow("Missing root ORM2 element");
    });

    it("throws NormaParseError when ORMModel is missing", () => {
      const xml = `<?xml version="1.0"?>
        <orm:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore">
        </orm:ORM2>`;
      // An empty ORM2 element parses as a falsy value, so the parser
      // reports the root as missing rather than a missing child.
      expect(() => parseNormaXml(xml)).toThrow(NormaParseError);
    });
  });

  describe("entity types", () => {
    it("parses entity types with reference mode", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:EntityType id="_et1" Name="Customer" _ReferenceMode="Id">
            <orm:PlayedRoles>
              <orm:Role ref="_role1" />
            </orm:PlayedRoles>
          </orm:EntityType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.entityTypes).toHaveLength(1);
      expect(doc.entityTypes[0]!.id).toBe("_et1");
      expect(doc.entityTypes[0]!.name).toBe("Customer");
      expect(doc.entityTypes[0]!.referenceMode).toBe("Id");
      expect(doc.entityTypes[0]!.playedRoleRefs).toEqual(["_role1"]);
    });

    it("parses entity type with definition", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:EntityType id="_et1" Name="Customer" _ReferenceMode="Id">
            <orm:PlayedRoles />
            <orm:Definitions>
              <orm:Definition>
                <orm:DefinitionText>A person who buys things.</orm:DefinitionText>
              </orm:Definition>
            </orm:Definitions>
          </orm:EntityType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.entityTypes[0]!.definition).toBe("A person who buys things.");
    });

    it("parses multiple entity types", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:EntityType id="_et1" Name="Customer" _ReferenceMode="Id">
            <orm:PlayedRoles />
          </orm:EntityType>
          <orm:EntityType id="_et2" Name="Order" _ReferenceMode="Number">
            <orm:PlayedRoles />
          </orm:EntityType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.entityTypes).toHaveLength(2);
      expect(doc.entityTypes[0]!.name).toBe("Customer");
      expect(doc.entityTypes[1]!.name).toBe("Order");
    });
  });

  describe("value types", () => {
    it("parses value types", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:ValueType id="_vt1" Name="CustomerName">
            <orm:PlayedRoles>
              <orm:Role ref="_role2" />
            </orm:PlayedRoles>
          </orm:ValueType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.valueTypes).toHaveLength(1);
      expect(doc.valueTypes[0]!.id).toBe("_vt1");
      expect(doc.valueTypes[0]!.name).toBe("CustomerName");
      expect(doc.valueTypes[0]!.playedRoleRefs).toEqual(["_role2"]);
    });

    it("parses value type with ConceptualDataType reference", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:ValueType id="_vt1" Name="FirstName">
            <orm:PlayedRoles />
            <orm:ConceptualDataType id="_cdt1" ref="_dt1" Length="30" Scale="0" />
          </orm:ValueType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.valueTypes[0]!.dataTypeRef).toBe("_dt1");
      expect(doc.valueTypes[0]!.dataTypeLength).toBe(30);
      expect(doc.valueTypes[0]!.dataTypeScale).toBe(0);
    });

    it("parses value type without ConceptualDataType gracefully", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:ValueType id="_vt1" Name="Name">
            <orm:PlayedRoles />
          </orm:ValueType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.valueTypes[0]!.dataTypeRef).toBeUndefined();
      expect(doc.valueTypes[0]!.dataTypeLength).toBeUndefined();
      expect(doc.valueTypes[0]!.dataTypeScale).toBeUndefined();
    });

    it("parses value type with inline value constraint", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:ValueType id="_vt1" Name="Rating">
            <orm:PlayedRoles />
            <orm:ValueRestriction>
              <orm:ValueConstraint>
                <orm:ValueRanges>
                  <orm:ValueRange MinValue="A" MaxValue="A" />
                  <orm:ValueRange MinValue="B" MaxValue="B" />
                  <orm:ValueRange MinValue="C" MaxValue="C" />
                </orm:ValueRanges>
              </orm:ValueConstraint>
            </orm:ValueRestriction>
          </orm:ValueType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.valueTypes[0]!.valueConstraint).toBeDefined();
      expect(doc.valueTypes[0]!.valueConstraint!.values).toEqual(["A", "B", "C"]);
    });
  });

  describe("objectified types", () => {
    it("parses objectified types", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:ObjectifiedType id="_ot1" Name="Enrollment" _ReferenceMode="">
            <orm:NestedPredicate ref="_ft1" />
            <orm:PlayedRoles>
              <orm:Role ref="_role3" />
            </orm:PlayedRoles>
          </orm:ObjectifiedType>
        </orm:Objects>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.objectifiedTypes).toHaveLength(1);
      expect(doc.objectifiedTypes[0]!.id).toBe("_ot1");
      expect(doc.objectifiedTypes[0]!.name).toBe("Enrollment");
      expect(doc.objectifiedTypes[0]!.nestedFactTypeRef).toBe("_ft1");
      expect(doc.objectifiedTypes[0]!.playedRoleRefs).toEqual(["_role3"]);
    });
  });

  describe("fact types", () => {
    it("parses fact types with roles and readings", () => {
      const xml = wrap(`
        <orm:Objects>
          <orm:EntityType id="_et1" Name="Customer" _ReferenceMode="Id">
            <orm:PlayedRoles />
          </orm:EntityType>
          <orm:EntityType id="_et2" Name="Order" _ReferenceMode="Number">
            <orm:PlayedRoles />
          </orm:EntityType>
        </orm:Objects>
        <orm:Facts>
          <orm:Fact id="_ft1" _Name="CustomerPlacesOrder">
            <orm:FactRoles>
              <orm:Role id="_r1" Name="places" _IsMandatory="false">
                <orm:RolePlayer ref="_et1" />
              </orm:Role>
              <orm:Role id="_r2" Name="is placed by" _IsMandatory="true">
                <orm:RolePlayer ref="_et2" />
              </orm:Role>
            </orm:FactRoles>
            <orm:ReadingOrders>
              <orm:ReadingOrder id="_ro1">
                <orm:Readings>
                  <orm:Reading id="_rd1">
                    <orm:Data>{0} places {1}</orm:Data>
                  </orm:Reading>
                </orm:Readings>
                <orm:RoleSequence>
                  <orm:Role ref="_r1" />
                  <orm:Role ref="_r2" />
                </orm:RoleSequence>
              </orm:ReadingOrder>
            </orm:ReadingOrders>
            <orm:InternalConstraints>
              <orm:UniquenessConstraint ref="_uc1" />
            </orm:InternalConstraints>
          </orm:Fact>
        </orm:Facts>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.factTypes).toHaveLength(1);
      const ft = doc.factTypes[0]!;
      expect(ft.id).toBe("_ft1");
      expect(ft.name).toBe("CustomerPlacesOrder");

      expect(ft.roles).toHaveLength(2);
      expect(ft.roles[0]!.id).toBe("_r1");
      expect(ft.roles[0]!.name).toBe("places");
      expect(ft.roles[0]!.playerRef).toBe("_et1");
      expect(ft.roles[0]!.isMandatory).toBe(false);
      expect(ft.roles[1]!.id).toBe("_r2");
      expect(ft.roles[1]!.isMandatory).toBe(true);

      expect(ft.readingOrders).toHaveLength(1);
      expect(ft.readingOrders[0]!.readings[0]!.data).toBe("{0} places {1}");
      expect(ft.readingOrders[0]!.roleSequence).toEqual(["_r1", "_r2"]);

      expect(ft.internalConstraintRefs).toEqual(["_uc1"]);
    });

    it("parses role multiplicity", () => {
      const xml = wrap(`
        <orm:Facts>
          <orm:Fact id="_ft1" _Name="Test">
            <orm:FactRoles>
              <orm:Role id="_r1" Name="places" _IsMandatory="true" _Multiplicity="ExactlyOne">
                <orm:RolePlayer ref="_et1" />
              </orm:Role>
              <orm:Role id="_r2" Name="is placed by" _IsMandatory="false" _Multiplicity="ZeroToMany">
                <orm:RolePlayer ref="_et2" />
              </orm:Role>
            </orm:FactRoles>
            <orm:ReadingOrders />
          </orm:Fact>
        </orm:Facts>
      `);
      const doc = parseNormaXml(xml);
      const ft = doc.factTypes[0]!;

      expect(ft.roles[0]!.multiplicity).toBe("ExactlyOne");
      expect(ft.roles[1]!.multiplicity).toBe("ZeroToMany");
    });

    it("defaults role multiplicity to Unspecified when absent", () => {
      const xml = wrap(`
        <orm:Facts>
          <orm:Fact id="_ft1" _Name="Test">
            <orm:FactRoles>
              <orm:Role id="_r1" Name="role1">
                <orm:RolePlayer ref="_et1" />
              </orm:Role>
            </orm:FactRoles>
            <orm:ReadingOrders />
          </orm:Fact>
        </orm:Facts>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.factTypes[0]!.roles[0]!.multiplicity).toBe("Unspecified");
    });

    it("parses fact type with multiple reading orders", () => {
      const xml = wrap(`
        <orm:Facts>
          <orm:Fact id="_ft1" _Name="CustomerPlacesOrder">
            <orm:FactRoles>
              <orm:Role id="_r1" Name="places">
                <orm:RolePlayer ref="_et1" />
              </orm:Role>
              <orm:Role id="_r2" Name="is placed by">
                <orm:RolePlayer ref="_et2" />
              </orm:Role>
            </orm:FactRoles>
            <orm:ReadingOrders>
              <orm:ReadingOrder id="_ro1">
                <orm:Readings>
                  <orm:Reading id="_rd1">
                    <orm:Data>{0} places {1}</orm:Data>
                  </orm:Reading>
                </orm:Readings>
                <orm:RoleSequence>
                  <orm:Role ref="_r1" />
                  <orm:Role ref="_r2" />
                </orm:RoleSequence>
              </orm:ReadingOrder>
              <orm:ReadingOrder id="_ro2">
                <orm:Readings>
                  <orm:Reading id="_rd2">
                    <orm:Data>{0} is placed by {1}</orm:Data>
                  </orm:Reading>
                </orm:Readings>
                <orm:RoleSequence>
                  <orm:Role ref="_r2" />
                  <orm:Role ref="_r1" />
                </orm:RoleSequence>
              </orm:ReadingOrder>
            </orm:ReadingOrders>
          </orm:Fact>
        </orm:Facts>
      `);
      const doc = parseNormaXml(xml);
      const ft = doc.factTypes[0]!;

      expect(ft.readingOrders).toHaveLength(2);
      expect(ft.readingOrders[1]!.readings[0]!.data).toBe("{0} is placed by {1}");
    });
  });

  describe("subtype facts", () => {
    it("parses subtype facts", () => {
      const xml = wrap(`
        <orm:Facts>
          <orm:SubtypeFact id="_sf1" PreferredIdentificationPath="true">
            <orm:FactRoles>
              <orm:SubtypeMetaRole id="_sr1">
                <orm:RolePlayer ref="_et2" />
              </orm:SubtypeMetaRole>
              <orm:SupertypeMetaRole id="_sr2">
                <orm:RolePlayer ref="_et1" />
              </orm:SupertypeMetaRole>
            </orm:FactRoles>
          </orm:SubtypeFact>
        </orm:Facts>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.subtypeFacts).toHaveLength(1);
      const sf = doc.subtypeFacts[0]!;
      expect(sf.id).toBe("_sf1");
      expect(sf.subtypeRoleId).toBe("_sr1");
      expect(sf.subtypePlayerRef).toBe("_et2");
      expect(sf.supertypeRoleId).toBe("_sr2");
      expect(sf.supertypePlayerRef).toBe("_et1");
      expect(sf.providesIdentification).toBe(true);
    });

    it("parses subtype fact without preferred identification", () => {
      const xml = wrap(`
        <orm:Facts>
          <orm:SubtypeFact id="_sf1" PreferredIdentificationPath="false">
            <orm:FactRoles>
              <orm:SubtypeMetaRole id="_sr1">
                <orm:RolePlayer ref="_et2" />
              </orm:SubtypeMetaRole>
              <orm:SupertypeMetaRole id="_sr2">
                <orm:RolePlayer ref="_et1" />
              </orm:SupertypeMetaRole>
            </orm:FactRoles>
          </orm:SubtypeFact>
        </orm:Facts>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.subtypeFacts[0]!.providesIdentification).toBe(false);
    });
  });

  describe("constraints", () => {
    it("parses uniqueness constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:UniquenessConstraint id="_uc1" Name="UC1" IsInternal="true" IsPreferred="true">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
          </orm:UniquenessConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("uniqueness");
      if (c.type === "uniqueness") {
        expect(c.id).toBe("_uc1");
        expect(c.name).toBe("UC1");
        expect(c.isInternal).toBe(true);
        expect(c.isPreferred).toBe(true);
        expect(c.roleRefs).toEqual(["_r1"]);
      }
    });

    it("parses mandatory constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:MandatoryConstraint id="_mc1" Name="MC1" IsSimple="true">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
          </orm:MandatoryConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("mandatory");
      if (c.type === "mandatory") {
        expect(c.isSimple).toBe(true);
        expect(c.isImplied).toBe(false);
        expect(c.roleRefs).toEqual(["_r1"]);
      }
    });

    it("parses implied mandatory constraints with IsImplied flag", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:MandatoryConstraint id="_imc1" Name="IMC1" IsSimple="true" IsImplied="true">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
          </orm:MandatoryConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("mandatory");
      if (c.type === "mandatory") {
        expect(c.isImplied).toBe(true);
      }
    });

    it("parses frequency constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:FrequencyConstraint id="_fc1" Name="FC1" MinFrequency="2" MaxFrequency="5">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
          </orm:FrequencyConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("frequency");
      if (c.type === "frequency") {
        expect(c.min).toBe(2);
        expect(c.max).toBe(5);
        expect(c.roleRefs).toEqual(["_r1"]);
      }
    });

    it("parses value constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:ValueConstraint id="_vc1" Name="VC1">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
            <orm:ValueRanges>
              <orm:ValueRange MinValue="A" MaxValue="A" />
              <orm:ValueRange MinValue="B" MaxValue="B" />
            </orm:ValueRanges>
          </orm:ValueConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("value_constraint");
      if (c.type === "value_constraint") {
        expect(c.values).toEqual(["A", "B"]);
        expect(c.roleRefs).toEqual(["_r1"]);
      }
    });

    it("parses subset constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:SubsetConstraint id="_sc1" Name="SC1">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
            <orm:RoleSequence>
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:SubsetConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("subset");
      if (c.type === "subset") {
        expect(c.subsetRoleRefs).toEqual(["_r1"]);
        expect(c.supersetRoleRefs).toEqual(["_r2"]);
      }
    });

    it("parses exclusion constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:ExclusionConstraint id="_ec1" Name="EC1">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
            <orm:RoleSequence>
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:ExclusionConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("exclusion");
      if (c.type === "exclusion") {
        expect(c.roleSequences).toEqual([["_r1"], ["_r2"]]);
      }
    });

    it("parses equality constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:EqualityConstraint id="_eq1" Name="EQ1">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
            <orm:RoleSequence>
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:EqualityConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("equality");
      if (c.type === "equality") {
        expect(c.roleSequences).toEqual([["_r1"], ["_r2"]]);
      }
    });

    it("parses ring constraints", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:RingConstraint id="_rc1" Name="RC1" Type="Irreflexive">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:RingConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(1);
      const c = doc.constraints[0]!;
      expect(c.type).toBe("ring");
      if (c.type === "ring") {
        expect(c.ringType).toBe("irreflexive");
        expect(c.roleRefs).toEqual(["_r1", "_r2"]);
      }
    });

    it("parses mandatory constraint without IsImplied defaults to false", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:MandatoryConstraint id="_mc1" Name="MC1" IsSimple="false">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:MandatoryConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);
      const c = doc.constraints[0]!;
      if (c.type === "mandatory") {
        expect(c.isImplied).toBe(false);
      }
    });

    it("normalizes ring type variants", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:RingConstraint id="_rc1" Name="RC1" Type="PurelyReflexive">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:RingConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);
      const c = doc.constraints[0]!;
      if (c.type === "ring") {
        expect(c.ringType).toBe("purely_reflexive");
      }
    });

    it("parses multiple constraint types together", () => {
      const xml = wrap(`
        <orm:Constraints>
          <orm:UniquenessConstraint id="_uc1" Name="UC1" IsInternal="true" IsPreferred="false">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
          </orm:UniquenessConstraint>
          <orm:MandatoryConstraint id="_mc1" Name="MC1" IsSimple="true">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
            </orm:RoleSequence>
          </orm:MandatoryConstraint>
          <orm:RingConstraint id="_rc1" Name="RC1" Type="Asymmetric">
            <orm:RoleSequence>
              <orm:Role ref="_r1" />
              <orm:Role ref="_r2" />
            </orm:RoleSequence>
          </orm:RingConstraint>
        </orm:Constraints>
      `);
      const doc = parseNormaXml(xml);

      expect(doc.constraints).toHaveLength(3);
      const types = doc.constraints.map((c) => c.type);
      expect(types).toContain("uniqueness");
      expect(types).toContain("mandatory");
      expect(types).toContain("ring");
    });
  });

  describe("data types", () => {
    it("parses DataTypes section", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<orm:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore">
  <orm:ORMModel id="_model1" Name="TestModel">
    <orm:DataTypes>
      <orm:VariableLengthTextDataType id="_dt1" />
      <orm:AutoCounterNumericDataType id="_dt2" />
      <orm:SignedIntegerNumericDataType id="_dt3" />
    </orm:DataTypes>
  </orm:ORMModel>
</orm:ORM2>`;
      const doc = parseNormaXml(xml);

      expect(doc.dataTypes).toHaveLength(3);
      expect(doc.dataTypes[0]!.id).toBe("_dt1");
      expect(doc.dataTypes[0]!.kind).toBe("variable_length_text");
      expect(doc.dataTypes[1]!.id).toBe("_dt2");
      expect(doc.dataTypes[1]!.kind).toBe("auto_counter_numeric");
      expect(doc.dataTypes[2]!.id).toBe("_dt3");
      expect(doc.dataTypes[2]!.kind).toBe("signed_integer_numeric");
    });

    it("returns empty dataTypes when DataTypes section is absent", () => {
      const xml = wrap("");
      const doc = parseNormaXml(xml);
      expect(doc.dataTypes).toHaveLength(0);
    });
  });
});
