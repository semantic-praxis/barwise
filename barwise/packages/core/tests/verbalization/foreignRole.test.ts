/**
 * A constraint naming a role of ANOTHER fact type must not crash.
 *
 * The graph does not prevent this. A foreign role id resolves -- it names
 * a real role -- so `graphOf` succeeds and every reference-based guard
 * passes. What fails is locality: the binary verbalization paths find the
 * role's index with `findIndex`, get -1, and index `roles[-1]`, which the
 * non-null assertion hides until `undefined.playerId` throws.
 *
 * Reachable on a shipped path, measured on 61df141: `barwise verbalize`
 * on a schema-valid file whose ft1 mandatory constraint names a real role
 * of ft2 died with "Cannot read properties of undefined (reading
 * 'playerId')" and exited 1, while `barwise validate` on the same file
 * correctly reported constraint/mandatory-invalid-role.
 *
 * These tests pin only that it does not crash and that the output names
 * the offending id. What verbalization SHOULD say about a constraint
 * validation rejects is an open decision (barwise-979) -- deliberately
 * not pinned here, so taking it does not have to fight a test.
 */
import { describe, expect, it } from "vitest";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/** A model with two binary fact types, the second's role id in hand. */
function twoFactTypes(): { model: OrmModel; foreignRoleId: string; } {
  const model = new ModelBuilder("Foreign")
    .withEntityType("Customer")
    .withValueType("Name")
    .withValueType("Code")
    .withBinaryFactType("Customer has Name", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "Name", name: "is of" },
    })
    .withBinaryFactType("Customer has Code", {
      role1: { player: "Customer", name: "has code" },
      role2: { player: "Code", name: "is code of" },
    })
    .build();
  return { model, foreignRoleId: model.factTypes[1]!.roles[0]!.id };
}

function verbalizedText(model: OrmModel): string {
  return new Verbalizer().verbalizeModel(model).map((v) => v.text).join("\n");
}

describe("verbalizing a constraint that names a role of another fact type", () => {
  it("does not crash on a mandatory constraint", () => {
    const { model, foreignRoleId } = twoFactTypes();
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: foreignRoleId, id: "c1" });

    expect(() => verbalizedText(model)).not.toThrow();
    expect(verbalizedText(model)).toContain(foreignRoleId);
  });

  it("does not crash on a single-role internal uniqueness constraint", () => {
    const { model, foreignRoleId } = twoFactTypes();
    model.factTypes[0]!.addConstraint({
      type: "internal_uniqueness",
      roleIds: [foreignRoleId],
      id: "c2",
    });

    expect(() => verbalizedText(model)).not.toThrow();
  });

  it("does not crash on a single-role frequency constraint", () => {
    const { model, foreignRoleId } = twoFactTypes();
    model.factTypes[0]!.addConstraint({
      type: "frequency",
      roleIds: [foreignRoleId],
      min: 1,
      max: 3,
      id: "c3",
    });

    expect(() => verbalizedText(model)).not.toThrow();
  });

  it("does not wrap a malformed constraint in the deontic obligation", () => {
    const { model, foreignRoleId } = twoFactTypes();
    model.factTypes[0]!.addConstraint({
      type: "mandatory",
      roleId: foreignRoleId,
      id: "c5",
      modality: "deontic",
    });

    // The guard returns before `toDeontic`, deliberately: "It is
    // obligatory that malformed: ..." would assert an obligation about a
    // constraint that states nothing.
    const text = verbalizedText(model);
    expect(text).toContain("Malformed: the mandatory constraint");
    expect(text).not.toContain("It is obligatory that malformed");
    expect(text).not.toContain("It is obligatory that Malformed");
  });

  it("leaves the spanning kinds alone, where a non-local role is correct", () => {
    const { model, foreignRoleId } = twoFactTypes();
    const localRoleId = model.factTypes[0]!.roles[0]!.id;
    // External uniqueness spanning two fact types is the normal case for
    // that kind -- validation reports the ALL-local one as the anomaly.
    // A guard that flagged this would be a false finding on a correct
    // model.
    model.factTypes[0]!.addConstraint({
      type: "external_uniqueness",
      roleIds: [localRoleId, foreignRoleId],
      id: "c6",
    });

    expect(verbalizedText(model)).not.toContain("Malformed");
  });

  it("still takes the binary path for a role that IS local", () => {
    const { model } = twoFactTypes();
    const localRoleId = model.factTypes[0]!.roles[1]!.id;
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: localRoleId, id: "c4" });

    // The binary reading, not the generic "Each X must: ..." fallback --
    // the guard must not divert a well-formed constraint.
    expect(verbalizedText(model)).toContain("at least one");
  });
});
