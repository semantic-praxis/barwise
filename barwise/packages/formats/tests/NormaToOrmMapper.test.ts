/**
 * Tests for the NormaToOrmMapper.
 *
 * Verifies mapping from NormaDocument intermediate representation
 * to OrmModel. Uses hand-crafted NormaDocument objects to test
 * each mapping phase independently.
 */
import { describe, expect, it } from "vitest";
import { mapNormaToOrm, NormaMappingError } from "../src/norma/NormaToOrmMapper.js";
import type {
  NormaConstraint,
  NormaDocument,
  NormaEntityType,
  NormaFactType,
  NormaValueType,
} from "../src/norma/NormaXmlTypes.js";

/** Create a minimal valid NormaDocument. */
function makeDoc(overrides?: Partial<NormaDocument>): NormaDocument {
  return {
    modelId: "_model1",
    modelName: "TestModel",
    entityTypes: [],
    valueTypes: [],
    objectifiedTypes: [],
    factTypes: [],
    subtypeFacts: [],
    constraints: [],
    dataTypes: [],
    ...overrides,
  };
}

function makeEntity(id: string, name: string, refMode?: string): NormaEntityType {
  return {
    id,
    name,
    referenceMode: refMode,
    playedRoleRefs: [],
  };
}

function makeValue(id: string, name: string): NormaValueType {
  return {
    id,
    name,
    playedRoleRefs: [],
  };
}

function makeBinaryFactType(
  id: string,
  name: string,
  role1Player: string,
  role2Player: string,
  opts?: {
    role1Id?: string;
    role2Id?: string;
    reading?: string;
    internalConstraintRefs?: string[];
  },
): NormaFactType {
  const r1 = opts?.role1Id ?? `${id}_r1`;
  const r2 = opts?.role2Id ?? `${id}_r2`;
  return {
    id,
    name,
    roles: [
      {
        id: r1,
        name: "role1",
        playerRef: role1Player,
        isMandatory: false,
        multiplicity: "Unspecified" as const,
      },
      {
        id: r2,
        name: "role2",
        playerRef: role2Player,
        isMandatory: false,
        multiplicity: "Unspecified" as const,
      },
    ],
    readingOrders: [
      {
        id: `${id}_ro1`,
        readings: [{ id: `${id}_rd1`, data: opts?.reading ?? "{0} relates to {1}" }],
        roleSequence: [r1, r2],
      },
    ],
    internalConstraintRefs: opts?.internalConstraintRefs ?? [],
  };
}

describe("NormaToOrmMapper", () => {
  describe("basic model", () => {
    it("maps an empty document to an empty model", () => {
      const doc = makeDoc();
      const model = mapNormaToOrm(doc);

      expect(model.name).toBe("TestModel");
      expect(model.objectTypes).toHaveLength(0);
      expect(model.factTypes).toHaveLength(0);
    });
  });

  describe("object types", () => {
    it("maps entity types", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Customer", "Id")],
      });
      const model = mapNormaToOrm(doc);

      expect(model.objectTypes).toHaveLength(1);
      const ot = model.objectTypes[0]!;
      expect(ot.name).toBe("Customer");
      expect(ot.kind).toBe("entity");
      expect(ot.referenceMode).toBe("Id");
    });

    it("generates reference mode from name when not provided", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Customer")],
      });
      const model = mapNormaToOrm(doc);

      expect(model.objectTypes[0]!.referenceMode).toBe("customer_id");
    });

    it("maps the independent flag", () => {
      const doc = makeDoc({
        entityTypes: [
          {
            id: "_et1",
            name: "Color",
            referenceMode: "name",
            playedRoleRefs: [],
            independent: true,
          },
        ],
      });
      const model = mapNormaToOrm(doc);

      expect(model.objectTypes[0]!.independent).toBe(true);
    });

    it("maps value types", () => {
      const doc = makeDoc({
        valueTypes: [makeValue("_vt1", "CustomerName")],
      });
      const model = mapNormaToOrm(doc);

      expect(model.objectTypes).toHaveLength(1);
      const ot = model.objectTypes[0]!;
      expect(ot.name).toBe("CustomerName");
      expect(ot.kind).toBe("value");
    });

    it("maps value type with inline value constraint", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "Rating",
            playedRoleRefs: [],
            valueConstraint: { values: ["A", "B", "C"] },
          },
        ],
      });
      const model = mapNormaToOrm(doc);
      const ot = model.objectTypes[0]!;
      expect(ot.valueConstraint).toBeDefined();
      expect(ot.valueConstraint!.values).toEqual(["A", "B", "C"]);
    });

    it("maps value types with value ranges", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "Age",
            playedRoleRefs: [],
            valueConstraint: {
              values: [],
              ranges: [{ min: "18" }, { min: "0", max: "120", maxInclusive: false }],
            },
          },
        ],
      });
      const model = mapNormaToOrm(doc);
      const ot = model.objectTypes[0]!;
      expect(ot.valueConstraint).toBeDefined();
      expect(ot.valueConstraint!.ranges).toEqual([
        { min: "18" },
        { min: "0", max: "120", maxInclusive: false },
      ]);
    });

    it("maps entity types with definitions", () => {
      const doc = makeDoc({
        entityTypes: [
          {
            id: "_et1",
            name: "Customer",
            referenceMode: "Id",
            playedRoleRefs: [],
            definition: "A person who buys things.",
          },
        ],
      });
      const model = mapNormaToOrm(doc);
      expect(model.objectTypes[0]!.definition).toBe("A person who buys things.");
    });

    it("maps mixed entity and value types", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Customer", "Id")],
        valueTypes: [makeValue("_vt1", "Name")],
      });
      const model = mapNormaToOrm(doc);

      expect(model.objectTypes).toHaveLength(2);
      const entity = model.getObjectTypeByName("Customer");
      const value = model.getObjectTypeByName("Name");
      expect(entity!.kind).toBe("entity");
      expect(value!.kind).toBe("value");
    });
  });

  describe("fact types", () => {
    it("maps a binary fact type with roles", () => {
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            reading: "{0} places {1}",
          }),
        ],
      });
      const model = mapNormaToOrm(doc);

      expect(model.factTypes).toHaveLength(1);
      const ft = model.factTypes[0]!;
      expect(ft.name).toBe("CustomerPlacesOrder");
      expect(ft.arity).toBe(2);
      expect(ft.roles[0]!.playerId).toBe(model.getObjectTypeByName("Customer")!.id);
      expect(ft.roles[1]!.playerId).toBe(model.getObjectTypeByName("Order")!.id);
    });

    it("preserves reading templates", () => {
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            reading: "{0} places {1}",
          }),
        ],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      expect(ft.readings[0]!.template).toBe("{0} places {1}");
    });

    it("throws NormaMappingError for unknown role player", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Customer", "Id")],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et_unknown"),
        ],
      });
      expect(() => mapNormaToOrm(doc)).toThrow(NormaMappingError);
    });

    it("maps fact type with definition", () => {
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          {
            ...makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2"),
            definition: "Records an order placement.",
          },
        ],
      });
      const model = mapNormaToOrm(doc);
      expect(model.factTypes[0]!.definition).toBe("Records an order placement.");
    });
  });

  describe("constraints", () => {
    it("maps internal uniqueness constraint", () => {
      const uc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc1",
        name: "UC1",
        isInternal: true,
        isPreferred: false,
        roleRefs: ["_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            internalConstraintRefs: ["_uc1"],
          }),
        ],
        constraints: [uc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const iuc = ft.constraints.find((c) => c.type === "internal_uniqueness");
      expect(iuc).toBeDefined();
      if (iuc?.type === "internal_uniqueness") {
        expect(iuc.roleIds).toEqual(["_ft1_r2"]);
      }
    });

    it("maps isPreferred from uniqueness constraint", () => {
      const uc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc1",
        name: "UC1",
        isInternal: true,
        isPreferred: true,
        roleRefs: ["_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            internalConstraintRefs: ["_uc1"],
          }),
        ],
        constraints: [uc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const iuc = ft.constraints.find((c) => c.type === "internal_uniqueness");
      expect(iuc).toBeDefined();
      if (iuc?.type === "internal_uniqueness") {
        expect(iuc.isPreferred).toBe(true);
      }
    });

    it("does not set isPreferred when constraint is not preferred", () => {
      const uc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc1",
        name: "UC1",
        isInternal: true,
        isPreferred: false,
        roleRefs: ["_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            internalConstraintRefs: ["_uc1"],
          }),
        ],
        constraints: [uc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const iuc = ft.constraints.find((c) => c.type === "internal_uniqueness");
      expect(iuc).toBeDefined();
      if (iuc?.type === "internal_uniqueness") {
        expect(iuc.isPreferred).toBeUndefined();
      }
    });

    it("maps simple mandatory constraint from internalConstraintRefs", () => {
      const mc: NormaConstraint = {
        type: "mandatory",
        id: "_mc1",
        name: "MC1",
        isSimple: true,
        isImplied: false,
        roleRefs: ["_ft1_r1"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            internalConstraintRefs: ["_mc1"],
          }),
        ],
        constraints: [mc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const mandatory = ft.constraints.find((c) => c.type === "mandatory");
      expect(mandatory).toBeDefined();
      if (mandatory?.type === "mandatory") {
        expect(mandatory.roleId).toBe("_ft1_r1");
      }
    });

    it("maps frequency constraint", () => {
      const fc: NormaConstraint = {
        type: "frequency",
        id: "_fc1",
        name: "FC1",
        min: 2,
        max: 5,
        roleRefs: ["_ft1_r1"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            internalConstraintRefs: ["_fc1"],
          }),
        ],
        constraints: [fc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const freq = ft.constraints.find((c) => c.type === "frequency");
      expect(freq).toBeDefined();
      if (freq?.type === "frequency") {
        expect(freq.min).toBe(2);
        expect(freq.max).toBe(5);
      }
    });

    it("maps ring constraint", () => {
      const rc: NormaConstraint = {
        type: "ring",
        id: "_rc1",
        name: "RC1",
        ringType: "irreflexive",
        roleRefs: ["_ft1_r1", "_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Person", "Id")],
        factTypes: [
          makeBinaryFactType("_ft1", "PersonMentorsPerson", "_et1", "_et1", {
            internalConstraintRefs: ["_rc1"],
          }),
        ],
        constraints: [rc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const ring = ft.constraints.find((c) => c.type === "ring");
      expect(ring).toBeDefined();
      if (ring?.type === "ring") {
        expect(ring.ringType).toBe("irreflexive");
        expect(ring.roleId1).toBe("_ft1_r1");
        expect(ring.roleId2).toBe("_ft1_r2");
      }
    });

    it("maps subset constraint", () => {
      const sc: NormaConstraint = {
        type: "subset",
        id: "_sc1",
        name: "SC1",
        subsetRoleRefs: ["_ft1_r1"],
        supersetRoleRefs: ["_ft2_r1"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Product", "Code"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
            internalConstraintRefs: ["_sc1"],
          }),
          makeBinaryFactType("_ft2", "CustomerBuysProduct", "_et1", "_et2"),
        ],
        constraints: [sc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const subset = ft.constraints.find((c) => c.type === "subset");
      expect(subset).toBeDefined();
      if (subset?.type === "subset") {
        expect(subset.subsetRoleIds).toEqual(["_ft1_r1"]);
        expect(subset.supersetRoleIds).toEqual(["_ft2_r1"]);
      }
    });

    it("filters out implied mandatory constraints", () => {
      const simpleMc: NormaConstraint = {
        type: "mandatory",
        id: "_mc1",
        name: "MC1",
        isSimple: true,
        isImplied: false,
        roleRefs: ["_ft1_r1"],
      };
      const impliedMc: NormaConstraint = {
        type: "mandatory",
        id: "_mc2",
        name: "ImpliedMC",
        isSimple: true,
        isImplied: true,
        roleRefs: ["_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            internalConstraintRefs: ["_mc1", "_mc2"],
          }),
        ],
        constraints: [simpleMc, impliedMc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const mandatories = ft.constraints.filter((c) => c.type === "mandatory");
      // Only the non-implied one should be mapped.
      expect(mandatories).toHaveLength(1);
      if (mandatories[0]?.type === "mandatory") {
        expect(mandatories[0].roleId).toBe("_ft1_r1");
      }
    });

    it("filters out implied mandatory in addSimpleMandatoryConstraints path", () => {
      // Implied mandatory NOT referenced by internalConstraintRefs
      // but present in top-level constraints -- should still be filtered.
      const impliedMc: NormaConstraint = {
        type: "mandatory",
        id: "_mc_implied",
        name: "ImpliedMC",
        isSimple: true,
        isImplied: true,
        roleRefs: ["_ft1_r1"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2"),
        ],
        constraints: [impliedMc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const mandatories = ft.constraints.filter((c) => c.type === "mandatory");
      expect(mandatories).toHaveLength(0);
    });

    it("maps external uniqueness constraint not in internalConstraintRefs", () => {
      const extUc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc_ext",
        name: "ExtUC1",
        isInternal: false,
        isPreferred: false,
        roleRefs: ["_ft1_r2", "_ft2_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Employee", "Id"),
        ],
        valueTypes: [
          makeValue("_vt1", "FirstName"),
          makeValue("_vt2", "LastName"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasFirstName", "_et1", "_vt1"),
          makeBinaryFactType("_ft2", "EmployeeHasLastName", "_et1", "_vt2"),
        ],
        constraints: [extUc],
      });
      const model = mapNormaToOrm(doc);

      // External uniqueness should be attached to the first fact type
      // containing a referenced role.
      const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
      const extConstraints = allConstraints.filter(
        (c) => c.type === "external_uniqueness",
      );
      expect(extConstraints).toHaveLength(1);
      if (extConstraints[0]?.type === "external_uniqueness") {
        expect(extConstraints[0].roleIds).toContain("_ft1_r2");
        expect(extConstraints[0].roleIds).toContain("_ft2_r2");
      }
    });

    it("does not duplicate external uniqueness constraint already in internalConstraintRefs", () => {
      const extUc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc_ext",
        name: "ExtUC1",
        isInternal: false,
        isPreferred: false,
        roleRefs: ["_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Employee", "Id"),
        ],
        valueTypes: [
          makeValue("_vt1", "FirstName"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasFirstName", "_et1", "_vt1", {
            internalConstraintRefs: ["_uc_ext"],
          }),
        ],
        constraints: [extUc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const extConstraints = ft.constraints.filter(
        (c) => c.type === "external_uniqueness",
      );
      // Should only appear once (from internalConstraintRefs processing).
      expect(extConstraints).toHaveLength(1);
    });

    it("skips internal uniqueness constraints in external uniqueness pass", () => {
      const intUc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc_int",
        name: "IntUC1",
        isInternal: true,
        isPreferred: false,
        roleRefs: ["_ft1_r1"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Employee", "Id"),
        ],
        valueTypes: [
          makeValue("_vt1", "FirstName"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasFirstName", "_et1", "_vt1"),
        ],
        // Internal UC not referenced by any fact type's internalConstraintRefs.
        constraints: [intUc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      // The external uniqueness pass should NOT pick up internal uniqueness constraints.
      const extConstraints = ft.constraints.filter(
        (c) => c.type === "external_uniqueness",
      );
      expect(extConstraints).toHaveLength(0);
    });

    it("maps role-level value constraint not in internalConstraintRefs", () => {
      const vc: NormaConstraint = {
        type: "value_constraint",
        id: "_vc1",
        name: "VC1",
        roleRefs: ["_ft1_r2"],
        values: ["dev", "qa", "pm"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Employee", "Id"),
        ],
        valueTypes: [
          makeValue("_vt1", "RoleName"),
        ],
        factTypes: [
          // No internalConstraintRefs -- value constraint only in top-level.
          makeBinaryFactType("_ft1", "EmployeeHasRoleName", "_et1", "_vt1"),
        ],
        constraints: [vc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const valConstraints = ft.constraints.filter(
        (c) => c.type === "value_constraint",
      );
      expect(valConstraints).toHaveLength(1);
      if (valConstraints[0]?.type === "value_constraint") {
        expect(valConstraints[0].roleId).toBe("_ft1_r2");
        expect(valConstraints[0].values).toEqual(["dev", "qa", "pm"]);
      }
    });

    it("does not duplicate value constraint already in internalConstraintRefs", () => {
      const vc: NormaConstraint = {
        type: "value_constraint",
        id: "_vc1",
        name: "VC1",
        roleRefs: ["_ft1_r2"],
        values: ["dev", "qa", "pm"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Employee", "Id"),
        ],
        valueTypes: [
          makeValue("_vt1", "RoleName"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasRoleName", "_et1", "_vt1", {
            internalConstraintRefs: ["_vc1"],
          }),
        ],
        constraints: [vc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const valConstraints = ft.constraints.filter(
        (c) => c.type === "value_constraint",
      );
      // Should only appear once.
      expect(valConstraints).toHaveLength(1);
    });

    it("skips role-level value constraint with empty values", () => {
      const vc: NormaConstraint = {
        type: "value_constraint",
        id: "_vc1",
        name: "VC1",
        roleRefs: ["_ft1_r2"],
        values: [],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Employee", "Id"),
        ],
        valueTypes: [
          makeValue("_vt1", "RoleName"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasRoleName", "_et1", "_vt1"),
        ],
        constraints: [vc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const valConstraints = ft.constraints.filter(
        (c) => c.type === "value_constraint",
      );
      expect(valConstraints).toHaveLength(0);
    });

    it("maps value constraint on a role", () => {
      const vc: NormaConstraint = {
        type: "value_constraint",
        id: "_vc1",
        name: "VC1",
        roleRefs: ["_ft1_r1"],
        values: ["A", "B", "C"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Product", "Code"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
            internalConstraintRefs: ["_vc1"],
          }),
        ],
        constraints: [vc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const valConstraint = ft.constraints.find((c) => c.type === "value_constraint");
      expect(valConstraint).toBeDefined();
      if (valConstraint?.type === "value_constraint") {
        expect(valConstraint.values).toEqual(["A", "B", "C"]);
      }
    });
  });

  describe("subtype facts", () => {
    it("maps subtype facts", () => {
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Person", "Id"),
          makeEntity("_et2", "Employee", "Badge"),
        ],
        subtypeFacts: [
          {
            id: "_sf1",
            subtypeRoleId: "_sr1",
            subtypePlayerRef: "_et2",
            supertypeRoleId: "_sr2",
            supertypePlayerRef: "_et1",
            providesIdentification: true,
          },
        ],
      });
      const model = mapNormaToOrm(doc);

      expect(model.subtypeFacts).toHaveLength(1);
      const sf = model.subtypeFacts[0]!;
      expect(sf.subtypeId).toBe(model.getObjectTypeByName("Employee")!.id);
      expect(sf.supertypeId).toBe(model.getObjectTypeByName("Person")!.id);
      expect(sf.providesIdentification).toBe(true);
    });

    it("throws for unknown subtype player ref", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Person", "Id")],
        subtypeFacts: [
          {
            id: "_sf1",
            subtypeRoleId: "_sr1",
            subtypePlayerRef: "_et_unknown",
            supertypeRoleId: "_sr2",
            supertypePlayerRef: "_et1",
            providesIdentification: true,
          },
        ],
      });
      expect(() => mapNormaToOrm(doc)).toThrow(NormaMappingError);
    });

    it("throws for unknown supertype player ref", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Person", "Id")],
        subtypeFacts: [
          {
            id: "_sf1",
            subtypeRoleId: "_sr1",
            subtypePlayerRef: "_et1",
            supertypeRoleId: "_sr2",
            supertypePlayerRef: "_et_unknown",
            providesIdentification: true,
          },
        ],
      });
      expect(() => mapNormaToOrm(doc)).toThrow(NormaMappingError);
    });
  });

  describe("objectified fact types", () => {
    it("maps objectified fact types", () => {
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Student", "StudentId"),
          makeEntity("_et2", "Course", "CourseCode"),
        ],
        objectifiedTypes: [
          {
            id: "_ot1",
            name: "Enrollment",
            nestedFactTypeRef: "_ft1",
            playedRoleRefs: [],
          },
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "StudentEnrollsInCourse", "_et1", "_et2", {
            reading: "{0} enrolls in {1}",
          }),
        ],
      });
      const model = mapNormaToOrm(doc);

      // Should have 3 object types: Student, Course, Enrollment.
      expect(model.objectTypes).toHaveLength(3);
      const enrollment = model.getObjectTypeByName("Enrollment");
      expect(enrollment).toBeDefined();
      expect(enrollment!.kind).toBe("entity");

      // Should have 1 objectified fact type.
      expect(model.objectifiedFactTypes).toHaveLength(1);
      const oft = model.objectifiedFactTypes[0]!;
      expect(oft.objectTypeId).toBe(enrollment!.id);
      expect(oft.factTypeId).toBe(model.factTypes[0]!.id);
    });

    it("throws for objectified type referencing unknown fact type", () => {
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Student", "StudentId")],
        objectifiedTypes: [
          {
            id: "_ot1",
            name: "Enrollment",
            nestedFactTypeRef: "_ft_unknown",
            playedRoleRefs: [],
          },
        ],
      });
      expect(() => mapNormaToOrm(doc)).toThrow(NormaMappingError);
    });
  });

  describe("data type resolution", () => {
    it("resolves NORMA data type to conceptual data type", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "FirstName",
            playedRoleRefs: [],
            dataTypeRef: "_dt1",
            dataTypeLength: 30,
          },
        ],
        dataTypes: [{ id: "_dt1", kind: "variable_length_text" }],
      });
      const model = mapNormaToOrm(doc);
      const ot = model.getObjectTypeByName("FirstName")!;
      expect(ot.dataType).toBeDefined();
      expect(ot.dataType!.name).toBe("text");
      expect(ot.dataType!.length).toBe(30);
    });

    it("resolves auto_counter_numeric to auto_counter", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "PersonId",
            playedRoleRefs: [],
            dataTypeRef: "_dt1",
          },
        ],
        dataTypes: [{ id: "_dt1", kind: "auto_counter_numeric" }],
      });
      const model = mapNormaToOrm(doc);
      expect(model.getObjectTypeByName("PersonId")!.dataType!.name).toBe("auto_counter");
    });

    it("resolves unknown data type kind to 'other'", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "Weird",
            playedRoleRefs: [],
            dataTypeRef: "_dt1",
          },
        ],
        dataTypes: [{ id: "_dt1", kind: "some_future_norma_type" }],
      });
      const model = mapNormaToOrm(doc);
      expect(model.getObjectTypeByName("Weird")!.dataType!.name).toBe("other");
    });

    it("returns undefined dataType when no dataTypeRef", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "Name",
            playedRoleRefs: [],
          },
        ],
      });
      const model = mapNormaToOrm(doc);
      expect(model.getObjectTypeByName("Name")!.dataType).toBeUndefined();
    });

    it("resolves decimal with length and scale", () => {
      const doc = makeDoc({
        valueTypes: [
          {
            id: "_vt1",
            name: "Price",
            playedRoleRefs: [],
            dataTypeRef: "_dt1",
            dataTypeLength: 10,
            dataTypeScale: 2,
          },
        ],
        dataTypes: [{ id: "_dt1", kind: "decimal_numeric" }],
      });
      const model = mapNormaToOrm(doc);
      const dt = model.getObjectTypeByName("Price")!.dataType!;
      expect(dt.name).toBe("decimal");
      expect(dt.length).toBe(10);
      expect(dt.scale).toBe(2);
    });
  });

  describe("complete model mapping", () => {
    it("maps a model with entities, values, facts, and constraints", () => {
      const uc: NormaConstraint = {
        type: "uniqueness",
        id: "_uc1",
        name: "UC1",
        isInternal: true,
        isPreferred: false,
        roleRefs: ["_ft1_r2"],
      };
      const mc: NormaConstraint = {
        type: "mandatory",
        id: "_mc1",
        name: "MC1",
        isSimple: true,
        isImplied: false,
        roleRefs: ["_ft1_r2"],
      };
      const doc = makeDoc({
        entityTypes: [
          makeEntity("_et1", "Customer", "Id"),
          makeEntity("_et2", "Order", "Number"),
        ],
        valueTypes: [makeValue("_vt1", "Name")],
        factTypes: [
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2", {
            reading: "{0} places {1}",
            internalConstraintRefs: ["_uc1", "_mc1"],
          }),
          makeBinaryFactType("_ft2", "CustomerHasName", "_et1", "_vt1", {
            reading: "{0} has {1}",
          }),
        ],
        constraints: [uc, mc],
      });
      const model = mapNormaToOrm(doc);

      expect(model.objectTypes).toHaveLength(3);
      expect(model.factTypes).toHaveLength(2);

      const placesFt = model.getFactTypeByName("CustomerPlacesOrder")!;
      expect(placesFt.constraints).toHaveLength(2);

      const hasNameFt = model.getFactTypeByName("CustomerHasName")!;
      expect(hasNameFt.constraints).toHaveLength(0);
    });
  });
});
