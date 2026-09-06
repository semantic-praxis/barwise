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
        expect(freq.roleIds).toEqual(["_ft1_r1"]);
      }
    });

    it("maps a multi-role frequency constraint over the full role sequence", () => {
      const fc: NormaConstraint = {
        type: "frequency",
        id: "_fc1",
        name: "FC1",
        min: 1,
        max: 1,
        roleRefs: ["_ft1_r1", "_ft1_r2"],
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
      const freq = model.factTypes[0]!.constraints.find((c) => c.type === "frequency");
      expect(freq).toBeDefined();
      if (freq?.type === "frequency") {
        expect(freq.roleIds).toEqual(["_ft1_r1", "_ft1_r2"]);
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

    it("maps value-level range constraint with ranges from the top level", () => {
      const vc: NormaConstraint = {
        type: "value_constraint",
        id: "_vc1",
        name: "VC1",
        roleRefs: ["_ft1_r2"],
        values: [],
        ranges: [{ min: "1", max: "10" }],
      };
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Employee", "Id")],
        valueTypes: [makeValue("_vt1", "Age")],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasAge", "_et1", "_vt1"),
        ],
        constraints: [vc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const valConstraint = ft.constraints.find((c) => c.type === "value_constraint");
      expect(valConstraint).toBeDefined();
      if (valConstraint?.type === "value_constraint") {
        expect(valConstraint.ranges).toEqual([{ min: "1", max: "10" }]);
      }
    });

    it("does not duplicate a top-level range value constraint listed twice", () => {
      const vc1: NormaConstraint = {
        type: "value_constraint",
        id: "_vc1",
        name: "VC1",
        roleRefs: ["_ft1_r2"],
        values: [],
        ranges: [{ min: "1", max: "10" }],
      };
      const vc2: NormaConstraint = {
        type: "value_constraint",
        id: "_vc2",
        name: "VC2",
        roleRefs: ["_ft1_r2"],
        values: [],
        ranges: [{ min: "1", max: "10" }],
      };
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Employee", "Id")],
        valueTypes: [makeValue("_vt1", "Age")],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasAge", "_et1", "_vt1"),
        ],
        constraints: [vc1, vc2],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const valConstraints = ft.constraints.filter((c) => c.type === "value_constraint");
      expect(valConstraints).toHaveLength(1);
    });

    it("adds a simple mandatory constraint from the top level when unreferenced", () => {
      const mc: NormaConstraint = {
        type: "mandatory",
        id: "_mc_top",
        name: "TopMC",
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
          // A second fact type ensures the inner search over doc.factTypes
          // has to skip past a fact type that doesn't own the role.
          makeBinaryFactType("_ft0", "CustomerBrowsesCatalog", "_et1", "_et2"),
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2"),
        ],
        constraints: [mc],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes.find((f) => f.name === "CustomerPlacesOrder")!;
      const mandatory = ft.constraints.find((c) => c.type === "mandatory");
      expect(mandatory).toBeDefined();
      if (mandatory?.type === "mandatory") {
        expect(mandatory.roleId).toBe("_ft1_r1");
      }
    });

    it("does not duplicate a top-level simple mandatory constraint listed twice", () => {
      const mc1: NormaConstraint = {
        type: "mandatory",
        id: "_mc1",
        name: "MC1",
        isSimple: true,
        isImplied: false,
        roleRefs: ["_ft1_r1"],
      };
      const mc2: NormaConstraint = {
        type: "mandatory",
        id: "_mc2",
        name: "MC2",
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
          makeBinaryFactType("_ft1", "CustomerPlacesOrder", "_et1", "_et2"),
        ],
        constraints: [mc1, mc2],
      });
      const model = mapNormaToOrm(doc);
      const ft = model.factTypes[0]!;
      const mandatories = ft.constraints.filter((c) => c.type === "mandatory");
      expect(mandatories).toHaveLength(1);
    });

    it("does not duplicate a top-level external uniqueness constraint listed twice", () => {
      const extUc1: NormaConstraint = {
        type: "uniqueness",
        id: "_uc1",
        name: "ExtUC1",
        isInternal: false,
        isPreferred: false,
        roleRefs: ["_ft1_r2", "_ft2_r2"],
      };
      const extUc2: NormaConstraint = {
        type: "uniqueness",
        id: "_uc2",
        name: "ExtUC2",
        isInternal: false,
        isPreferred: false,
        roleRefs: ["_ft1_r2", "_ft2_r2"],
      };
      const doc = makeDoc({
        entityTypes: [makeEntity("_et1", "Employee", "Id")],
        valueTypes: [
          makeValue("_vt1", "FirstName"),
          makeValue("_vt2", "LastName"),
        ],
        factTypes: [
          makeBinaryFactType("_ft1", "EmployeeHasFirstName", "_et1", "_vt1"),
          makeBinaryFactType("_ft2", "EmployeeHasLastName", "_et1", "_vt2"),
        ],
        constraints: [extUc1, extUc2],
      });
      const model = mapNormaToOrm(doc);
      const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
      const extConstraints = allConstraints.filter((c) => c.type === "external_uniqueness");
      expect(extConstraints).toHaveLength(1);
    });

    describe("disjunctive mandatory and exclusive-or", () => {
      function makeSpanningDoc(constraints: NormaConstraint[]): NormaDocument {
        return makeDoc({
          entityTypes: [
            makeEntity("_etP", "Person", "Id"),
            makeEntity("_etC", "Car", "Plate"),
            makeEntity("_etB", "Bus", "Route"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "PersonDrivesCar", "_etP", "_etC"),
            makeBinaryFactType("_ft2", "PersonRidesBus", "_etP", "_etB"),
          ],
          constraints,
        });
      }

      it("adds a disjunctive mandatory constraint spanning fact types", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "DisjMC",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft2_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([mc]));
        const ft = model.factTypes.find((f) => f.name === "PersonDrivesCar")!;
        const disj = ft.constraints.find((c) => c.type === "disjunctive_mandatory");
        expect(disj).toBeDefined();
        if (disj?.type === "disjunctive_mandatory") {
          expect(disj.roleIds).toEqual(["_ft1_r1", "_ft2_r1"]);
        }
      });

      it("does not duplicate a disjunctive mandatory constraint listed twice", () => {
        const mc1: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "DisjMC1",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft2_r1"],
        };
        const mc2: NormaConstraint = {
          type: "mandatory",
          id: "_mc2",
          name: "DisjMC2",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft2_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([mc1, mc2]));
        const ft = model.factTypes.find((f) => f.name === "PersonDrivesCar")!;
        const disjs = ft.constraints.filter((c) => c.type === "disjunctive_mandatory");
        expect(disjs).toHaveLength(1);
      });

      it("skips a non-simple mandatory constraint with fewer than two roles", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "Malformed",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([mc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "disjunctive_mandatory")).toBe(false);
      });

      it("skips a disjunctive mandatory constraint whose roles are unknown", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "Unknown",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_missing_r1", "_missing_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([mc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "disjunctive_mandatory")).toBe(false);
      });

      it("maps a mandatory/exclusion pair as one exclusive-or constraint", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "XorMC",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft2_r1"],
          exclusiveOrExclusionRef: "_exc1",
        };
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "XorExc",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
          exclusiveOrMandatoryRef: "_mc1",
        };
        const model = mapNormaToOrm(makeSpanningDoc([mc, exc]));
        const ft = model.factTypes.find((f) => f.name === "PersonDrivesCar")!;
        const xor = ft.constraints.filter((c) => c.type === "exclusive_or");
        expect(xor).toHaveLength(1);
        if (xor[0]?.type === "exclusive_or") {
          expect(xor[0].roleIds).toEqual(["_ft1_r1", "_ft2_r1"]);
        }
        // The paired exclusion half must not also surface as a plain exclusion.
        expect(ft.constraints.some((c) => c.type === "exclusion")).toBe(false);
      });

      it("does not duplicate an exclusive-or constraint listed as two pairs", () => {
        const mc1: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "XorMC1",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft2_r1"],
          exclusiveOrExclusionRef: "_exc1",
        };
        const exc1: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "XorExc1",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
          exclusiveOrMandatoryRef: "_mc1",
        };
        const mc2: NormaConstraint = {
          type: "mandatory",
          id: "_mc2",
          name: "XorMC2",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft2_r1"],
          exclusiveOrExclusionRef: "_exc2",
        };
        const exc2: NormaConstraint = {
          type: "exclusion",
          id: "_exc2",
          name: "XorExc2",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
          exclusiveOrMandatoryRef: "_mc2",
        };
        const model = mapNormaToOrm(makeSpanningDoc([mc1, exc1, mc2, exc2]));
        const ft = model.factTypes.find((f) => f.name === "PersonDrivesCar")!;
        const xor = ft.constraints.filter((c) => c.type === "exclusive_or");
        expect(xor).toHaveLength(1);
      });
    });

    describe("top-level subset, exclusion, equality, value comparison, and ring", () => {
      function makeSpanningDoc(constraints: NormaConstraint[]): NormaDocument {
        return makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2"),
            makeBinaryFactType("_ft2", "CustomerBuysProduct", "_et1", "_et2"),
          ],
          constraints,
        });
      }

      it("adds a top-level subset constraint spanning fact types", () => {
        const sc: NormaConstraint = {
          type: "subset",
          id: "_sc1",
          name: "SC1",
          subsetRoleRefs: ["_ft1_r1"],
          supersetRoleRefs: ["_ft2_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([sc]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const subset = ft.constraints.find((c) => c.type === "subset");
        expect(subset).toBeDefined();
      });

      it("does not duplicate a top-level subset constraint listed twice", () => {
        const sc1: NormaConstraint = {
          type: "subset",
          id: "_sc1",
          name: "SC1",
          subsetRoleRefs: ["_ft1_r1"],
          supersetRoleRefs: ["_ft2_r1"],
        };
        const sc2: NormaConstraint = {
          type: "subset",
          id: "_sc2",
          name: "SC2",
          subsetRoleRefs: ["_ft1_r1"],
          supersetRoleRefs: ["_ft2_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([sc1, sc2]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const subsets = ft.constraints.filter((c) => c.type === "subset");
        expect(subsets).toHaveLength(1);
      });

      it("skips a top-level subset constraint with no roles on either side", () => {
        const sc: NormaConstraint = {
          type: "subset",
          id: "_sc1",
          name: "Empty",
          subsetRoleRefs: [],
          supersetRoleRefs: [],
        };
        const model = mapNormaToOrm(makeSpanningDoc([sc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "subset")).toBe(false);
      });

      it("skips a top-level subset constraint whose roles are unknown", () => {
        const sc: NormaConstraint = {
          type: "subset",
          id: "_sc1",
          name: "Unknown",
          subsetRoleRefs: ["_missing_r1"],
          supersetRoleRefs: ["_missing_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([sc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "subset")).toBe(false);
      });

      it("adds a top-level exclusion constraint spanning fact types", () => {
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Exc1",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([exc]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const exclusion = ft.constraints.find((c) => c.type === "exclusion");
        expect(exclusion).toBeDefined();
        if (exclusion?.type === "exclusion") {
          expect(exclusion.roleIds).toEqual(["_ft1_r1", "_ft2_r1"]);
        }
      });

      it("does not duplicate a top-level exclusion constraint listed twice", () => {
        const exc1: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Exc1",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
        };
        const exc2: NormaConstraint = {
          type: "exclusion",
          id: "_exc2",
          name: "Exc2",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([exc1, exc2]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const exclusions = ft.constraints.filter((c) => c.type === "exclusion");
        expect(exclusions).toHaveLength(1);
      });

      it("skips a top-level exclusion constraint with no roles", () => {
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Empty",
          roleSequences: [[], []],
        };
        const model = mapNormaToOrm(makeSpanningDoc([exc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "exclusion")).toBe(false);
      });

      it("skips a top-level exclusion constraint whose roles are unknown", () => {
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Unknown",
          roleSequences: [["_missing_r1"], ["_missing_r2"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([exc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "exclusion")).toBe(false);
      });

      it("adds a top-level equality constraint spanning fact types", () => {
        const eq: NormaConstraint = {
          type: "equality",
          id: "_eq1",
          name: "Eq1",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([eq]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const equality = ft.constraints.find((c) => c.type === "equality");
        expect(equality).toBeDefined();
        if (equality?.type === "equality") {
          expect(equality.roleIds1).toEqual(["_ft1_r1"]);
          expect(equality.roleIds2).toEqual(["_ft2_r1"]);
        }
      });

      it("does not duplicate a top-level equality constraint listed twice", () => {
        const eq1: NormaConstraint = {
          type: "equality",
          id: "_eq1",
          name: "Eq1",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
        };
        const eq2: NormaConstraint = {
          type: "equality",
          id: "_eq2",
          name: "Eq2",
          roleSequences: [["_ft1_r1"], ["_ft2_r1"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([eq1, eq2]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const equalities = ft.constraints.filter((c) => c.type === "equality");
        expect(equalities).toHaveLength(1);
      });

      it("skips a top-level equality constraint with fewer than two role sequences", () => {
        const eq: NormaConstraint = {
          type: "equality",
          id: "_eq1",
          name: "OneSeq",
          roleSequences: [["_ft1_r1"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([eq]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "equality")).toBe(false);
      });

      it("skips a top-level equality constraint whose roles are unknown", () => {
        const eq: NormaConstraint = {
          type: "equality",
          id: "_eq1",
          name: "Unknown",
          roleSequences: [["_missing_r1"], ["_missing_r2"]],
        };
        const model = mapNormaToOrm(makeSpanningDoc([eq]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "equality")).toBe(false);
      });

      it("adds a top-level value comparison constraint", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "Vcmp1",
          operator: "LessThan",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([vcmp]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const vc = ft.constraints.find((c) => c.type === "value_comparison");
        expect(vc).toBeDefined();
        if (vc?.type === "value_comparison") {
          expect(vc.operator).toBe("<");
        }
      });

      it("does not duplicate a top-level value comparison constraint listed twice", () => {
        const vcmp1: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "Vcmp1",
          operator: "LessThan",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const vcmp2: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp2",
          name: "Vcmp2",
          operator: "LessThan",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([vcmp1, vcmp2]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const vcs = ft.constraints.filter((c) => c.type === "value_comparison");
        expect(vcs).toHaveLength(1);
      });

      it("skips a top-level value comparison constraint with the wrong role count", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "OneRole",
          operator: "LessThan",
          roleRefs: ["_ft1_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([vcmp]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "value_comparison")).toBe(false);
      });

      it("skips a top-level value comparison constraint with an undefined operator", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "Undef",
          operator: "Undefined",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([vcmp]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "value_comparison")).toBe(false);
      });

      it("skips a top-level value comparison constraint whose roles span fact types", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "Spanning",
          operator: "LessThan",
          roleRefs: ["_ft1_r1", "_ft2_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([vcmp]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "value_comparison")).toBe(false);
      });

      it("adds a top-level ring constraint not referenced by internalConstraintRefs", () => {
        const rc: NormaConstraint = {
          type: "ring",
          id: "_rc1",
          name: "RC1",
          ringType: "irreflexive",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([rc]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const ring = ft.constraints.find((c) => c.type === "ring");
        expect(ring).toBeDefined();
      });

      it("does not duplicate a top-level ring constraint listed twice", () => {
        const rc1: NormaConstraint = {
          type: "ring",
          id: "_rc1",
          name: "RC1",
          ringType: "irreflexive",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const rc2: NormaConstraint = {
          type: "ring",
          id: "_rc2",
          name: "RC2",
          ringType: "irreflexive",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([rc1, rc2]));
        const ft = model.factTypes.find((f) => f.name === "CustomerRatesProduct")!;
        const rings = ft.constraints.filter((c) => c.type === "ring");
        expect(rings).toHaveLength(1);
      });

      it("skips a top-level ring constraint with fewer than two roles", () => {
        const rc: NormaConstraint = {
          type: "ring",
          id: "_rc1",
          name: "OneRole",
          ringType: "irreflexive",
          roleRefs: ["_ft1_r1"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([rc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "ring")).toBe(false);
      });

      it("skips a top-level ring constraint whose roles are unknown", () => {
        const rc: NormaConstraint = {
          type: "ring",
          id: "_rc1",
          name: "Unknown",
          ringType: "irreflexive",
          roleRefs: ["_missing_r1", "_missing_r2"],
        };
        const model = mapNormaToOrm(makeSpanningDoc([rc]));
        const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
        expect(allConstraints.some((c) => c.type === "ring")).toBe(false);
      });
    });

    describe("exclusion, equality, and value comparison via internalConstraintRefs", () => {
      it("maps an exclusion constraint referenced from internalConstraintRefs", () => {
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Exc1",
          roleSequences: [["_ft1_r1"], ["_ft1_r2"]],
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: ["_exc1"],
            }),
          ],
          constraints: [exc],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        const exclusion = ft.constraints.find((c) => c.type === "exclusion");
        expect(exclusion).toBeDefined();
        if (exclusion?.type === "exclusion") {
          expect(exclusion.roleIds).toEqual(["_ft1_r1", "_ft1_r2"]);
        }
      });

      it("maps an equality constraint referenced from internalConstraintRefs", () => {
        const eq: NormaConstraint = {
          type: "equality",
          id: "_eq1",
          name: "Eq1",
          roleSequences: [["_ft1_r1"], ["_ft1_r2"]],
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: ["_eq1"],
            }),
          ],
          constraints: [eq],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        const equality = ft.constraints.find((c) => c.type === "equality");
        expect(equality).toBeDefined();
      });

      it("maps a value comparison constraint referenced from internalConstraintRefs", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "Vcmp1",
          operator: "GreaterThanOrEqual",
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: ["_vcmp1"],
            }),
          ],
          constraints: [vcmp],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        const vc = ft.constraints.find((c) => c.type === "value_comparison");
        expect(vc).toBeDefined();
        if (vc?.type === "value_comparison") {
          expect(vc.operator).toBe(">=");
        }
      });

      it("maps a disjunctive mandatory constraint referenced from internalConstraintRefs", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "DisjMC",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft1_r2"],
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: ["_mc1"],
            }),
          ],
          constraints: [mc],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        const disj = ft.constraints.find((c) => c.type === "disjunctive_mandatory");
        expect(disj).toBeDefined();
      });

      it("maps an exclusive-or constraint referenced from internalConstraintRefs on both roles", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "XorMC",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft1_r2"],
          exclusiveOrExclusionRef: "_exc1",
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: ["_mc1"],
            }),
          ],
          constraints: [mc],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        const xor = ft.constraints.find((c) => c.type === "exclusive_or");
        expect(xor).toBeDefined();
      });

      it("keeps a single exclusive-or when both halves of the pair are listed in internalConstraintRefs", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "XorMC",
          isSimple: false,
          isImplied: false,
          roleRefs: ["_ft1_r1", "_ft1_r2"],
          exclusiveOrExclusionRef: "_exc1",
        };
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "XorExc",
          roleSequences: [["_ft1_r1"], ["_ft1_r2"]],
          exclusiveOrMandatoryRef: "_mc1",
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              // Both halves of the exclusive-or coupler listed: the mapper
              // must collapse them to a single exclusive_or constraint.
              internalConstraintRefs: ["_mc1", "_exc1"],
            }),
          ],
          constraints: [mc, exc],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        const xor = ft.constraints.filter((c) => c.type === "exclusive_or");
        expect(xor).toHaveLength(1);
      });

      it("skips an internal uniqueness constraint whose role is outside the fact type", () => {
        const uc: NormaConstraint = {
          type: "uniqueness",
          id: "_uc1",
          name: "OutsideUC",
          isInternal: true,
          isPreferred: false,
          roleRefs: ["_unrelated_role"],
        };
        const doc = makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: ["_uc1"],
            }),
          ],
          constraints: [uc],
        });
        const model = mapNormaToOrm(doc);
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "internal_uniqueness")).toBe(false);
      });
    });

    describe("constraints referenced from internalConstraintRefs whose roles fall outside the fact type", () => {
      function makeDocWithRef(nc: NormaConstraint): NormaDocument {
        return makeDoc({
          entityTypes: [
            makeEntity("_et1", "Customer", "Id"),
            makeEntity("_et2", "Product", "Code"),
          ],
          factTypes: [
            makeBinaryFactType("_ft1", "CustomerRatesProduct", "_et1", "_et2", {
              internalConstraintRefs: [nc.id],
            }),
          ],
          constraints: [nc],
        });
      }

      it("drops a simple mandatory constraint whose role is outside the fact type", () => {
        const mc: NormaConstraint = {
          type: "mandatory",
          id: "_mc1",
          name: "Outside",
          isSimple: true,
          isImplied: false,
          roleRefs: ["_unrelated_role"],
        };
        const model = mapNormaToOrm(makeDocWithRef(mc));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "mandatory")).toBe(false);
      });

      it("drops a frequency constraint whose role is outside the fact type", () => {
        const fc: NormaConstraint = {
          type: "frequency",
          id: "_fc1",
          name: "Outside",
          min: 1,
          max: 1,
          roleRefs: ["_unrelated_role"],
        };
        const model = mapNormaToOrm(makeDocWithRef(fc));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "frequency")).toBe(false);
      });

      it("drops a value constraint whose role is outside the fact type", () => {
        const vc: NormaConstraint = {
          type: "value_constraint",
          id: "_vc1",
          name: "Outside",
          roleRefs: ["_unrelated_role"],
          values: ["a"],
        };
        const model = mapNormaToOrm(makeDocWithRef(vc));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "value_constraint")).toBe(false);
      });

      it("maps a value constraint with ranges via internalConstraintRefs", () => {
        const vc: NormaConstraint = {
          type: "value_constraint",
          id: "_vc1",
          name: "Ranged",
          roleRefs: ["_ft1_r1"],
          values: [],
          ranges: [{ min: "0", max: "100", minInclusive: true }],
        };
        const model = mapNormaToOrm(makeDocWithRef(vc));
        const ft = model.factTypes[0]!;
        const valConstraint = ft.constraints.find((c) => c.type === "value_constraint");
        expect(valConstraint).toBeDefined();
        if (valConstraint?.type === "value_constraint") {
          expect(valConstraint.ranges).toEqual([{ min: "0", max: "100", minInclusive: true }]);
        }
      });

      it("drops an exclusion constraint with no roles in any sequence", () => {
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Empty",
          roleSequences: [[], []],
        };
        const model = mapNormaToOrm(makeDocWithRef(exc));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "exclusion")).toBe(false);
      });

      it("maps an exclusion constraint as exclusive-or when it carries the coupler ref on its own", () => {
        const exc: NormaConstraint = {
          type: "exclusion",
          id: "_exc1",
          name: "Coupled",
          roleSequences: [["_ft1_r1"], ["_ft1_r2"]],
          exclusiveOrMandatoryRef: "_mc_not_present",
        };
        const model = mapNormaToOrm(makeDocWithRef(exc));
        const ft = model.factTypes[0]!;
        const xor = ft.constraints.find((c) => c.type === "exclusive_or");
        expect(xor).toBeDefined();
      });

      it("drops a value comparison constraint referenced with the wrong role count", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "OneRole",
          operator: "Equal",
          roleRefs: ["_ft1_r1"],
        };
        const model = mapNormaToOrm(makeDocWithRef(vcmp));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "value_comparison")).toBe(false);
      });

      it("drops a value comparison constraint whose role is outside the fact type", () => {
        const vcmp: NormaConstraint = {
          type: "value_comparison",
          id: "_vcmp1",
          name: "Outside",
          operator: "Equal",
          roleRefs: ["_ft1_r1", "_unrelated_role"],
        };
        const model = mapNormaToOrm(makeDocWithRef(vcmp));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "value_comparison")).toBe(false);
      });

      it("drops an equality constraint referenced with a single role sequence", () => {
        const eq: NormaConstraint = {
          type: "equality",
          id: "_eq1",
          name: "OneSeq",
          roleSequences: [["_ft1_r1"]],
        };
        const model = mapNormaToOrm(makeDocWithRef(eq));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "equality")).toBe(false);
      });

      it("drops a ring constraint that resolves to fewer than two roles in the fact type", () => {
        const rc: NormaConstraint = {
          type: "ring",
          id: "_rc1",
          name: "TooFewRoles",
          ringType: "irreflexive",
          roleRefs: ["_ft1_r1", "_unrelated_role"],
        };
        const model = mapNormaToOrm(makeDocWithRef(rc));
        const ft = model.factTypes[0]!;
        expect(ft.constraints.some((c) => c.type === "ring")).toBe(false);
      });
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
