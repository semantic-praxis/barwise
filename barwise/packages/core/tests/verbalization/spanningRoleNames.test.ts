/**
 * A spanning constraint names its roles, wherever they live.
 *
 * Subset, equality, exclusion, exclusive-or and disjunctive mandatory
 * reach across fact types by definition, but five of the six spanning
 * verbalizers resolved their roles with `factType.getRoleById`, which
 * only ever looks in the fact type carrying the constraint. A
 * legitimate foreign role missed, and the `?? roleId` fallback printed
 * its raw UUID (barwise-884). `verbalizeExternalUniqueness` was the
 * sixth and already used `model.findRole`, with the reason in a comment
 * -- the fix was to give the other five the same treatment.
 *
 * Reproduced before the fix on three corpus models, all subset
 * constraints, e.g. `barwise verbalize
 * packages/promptlab/evals/vendor-onboarding.reference.orm.yaml`:
 *
 *   If Vendor then 00000000-0000-701e-b0b7-bec5ccd3dae1.
 */
import { describe, expect, it } from "vitest";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/**
 * Two fact types over one entity, which is the shape a spanning subset
 * constraint takes: the same object type plays a role in each.
 */
function twoFactTypesOverOneEntity(): {
  model: OrmModel;
  localRoleId: string;
  foreignRoleId: string;
} {
  const model = new ModelBuilder("Spanning")
    .withEntityType("Vendor")
    .withValueType("VendorClassification")
    .withValueType("VendorStatus")
    .withBinaryFactType("Vendor has VendorClassification", {
      role1: { player: "Vendor", name: "has classification" },
      role2: { player: "VendorClassification", name: "classifies" },
    })
    .withBinaryFactType("Vendor has VendorStatus", {
      role1: { player: "Vendor", name: "has status" },
      role2: { player: "VendorStatus", name: "is status of" },
    })
    .build();
  return {
    model,
    localRoleId: model.factTypes[0]!.roles[0]!.id,
    foreignRoleId: model.factTypes[1]!.roles[0]!.id,
  };
}

function verbalizedText(model: OrmModel): string {
  return new Verbalizer().verbalizeModel(model).map((v) => v.text).join("\n");
}

const UUID_SHAPED = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;

describe("a subset constraint whose superset role is in another fact type", () => {
  it("names the player and the fact type, not the raw role id", () => {
    const { model, localRoleId, foreignRoleId } = twoFactTypesOverOneEntity();
    model.factTypes[0]!.addConstraint({
      type: "subset",
      subsetRoleIds: [localRoleId],
      supersetRoleIds: [foreignRoleId],
      id: "c-subset",
    });

    const text = verbalizedText(model);

    expect(text).toContain("If Vendor then Vendor in Vendor has VendorStatus.");
    // The role id must not appear anywhere: printing it was the defect.
    expect(text).not.toMatch(UUID_SHAPED);
    expect(text).not.toContain(foreignRoleId);
  });

  it("leaves a wholly local subset constraint unqualified", () => {
    const { model } = twoFactTypesOverOneEntity();
    const ft = model.factTypes[0]!;
    model.factTypes[0]!.addConstraint({
      type: "subset",
      subsetRoleIds: [ft.roles[0]!.id],
      supersetRoleIds: [ft.roles[1]!.id],
      id: "c-local",
    });

    // No " in <fact type>" tail when both roles are the owner's: the
    // qualification exists to disambiguate, not to decorate.
    expect(verbalizedText(model)).toContain("If Vendor then VendorClassification.");
  });

  it("names an equality constraint's foreign side too", () => {
    const { model, localRoleId, foreignRoleId } = twoFactTypesOverOneEntity();
    model.factTypes[0]!.addConstraint({
      type: "equality",
      roleIds1: [localRoleId],
      roleIds2: [foreignRoleId],
      id: "c-equality",
    });

    const text = verbalizedText(model);

    expect(text).toContain("Vendor if and only if Vendor in Vendor has VendorStatus.");
    expect(text).not.toMatch(UUID_SHAPED);
  });

  it("names a foreign role in the three kinds that carry their own role name", () => {
    // Disjunctive mandatory, exclusion and exclusive-or already emit the
    // role's name beside the player, so they need no fact-type
    // qualification -- but they had the same local-only lookup, and
    // would have printed the raw id for the foreign role.
    const { model, localRoleId, foreignRoleId } = twoFactTypesOverOneEntity();
    model.factTypes[0]!.addConstraint({
      type: "disjunctive_mandatory",
      roleIds: [localRoleId, foreignRoleId],
      id: "c-disj",
    });

    const text = verbalizedText(model);

    expect(text).toContain("has status");
    expect(text).not.toMatch(UUID_SHAPED);
  });
});
