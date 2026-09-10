import { dataTypeOf, valueConstraintOf } from "../../../model/ObjectType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import { dataTypeAdmits, valueDomainPredicate } from "../../../model/valueDomain.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { report, RULE_ID } from "../../ruleId.js";

/**
 * A population instance must respect the domain its ROLE PLAYER declares.
 *
 * ORM states a value type's domain in two places, and until barwise-945
 * only one of them was ever checked against data. A role-level
 * `value_constraint` CONSTRAINT was enforced (`valueFrequency.ts`); the
 * value type's own `valueConstraint` and `dataType` FIELDS were
 * serialized, diffed, and exported to SQL as a CHECK, and no rule ever
 * compared an instance value to either. So the same enumeration was live
 * or dead depending on which spelling the modeller happened to use, with
 * nothing telling them which they had picked.
 *
 * That matters beyond tidiness: validating a model against sample data
 * with a domain expert is the check step of Halpin's CSDP, and a
 * population that cannot violate the declared domain is not performing
 * it. It also let barwise emit a schema its own example data would fail
 * to load into.
 *
 * The equivalence the fix owes is structural rather than tested into
 * place: this asks `valueDomainPredicate`, which is the same predicate
 * the role-level rule asks and the counterexample generator asks
 * (`model/valueDomain.ts`). `ValueConstraintDef` and a `ValueConstraint`
 * constraint carry the same `{ values, ranges }` shape, so there is one
 * answer to "is this value in the domain" and no second implementation
 * to drift. A test pins the equivalence anyway, because the shape
 * agreeing today is not a guarantee it will.
 *
 * SAMPLES ARE NOT EXCLUDED, and that is deliberate. This rule fails on
 * data that is PRESENT, so it belongs with uniqueness, exclusion and the
 * value and ring constraints rather than with the existence rules that
 * read `buildObjectUniverse`. A sample is positive evidence only -- it
 * never creates an obligation -- but a sample tuple holding a value the
 * model forbids is still a contradiction the modeller wrote down.
 */
export function checkValueTypeDomainViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const factType = model.getFactType(pop.factTypeId);
    if (!factType) continue; // population/dangling-fact-type reports it

    for (const role of factType.roles) {
      const player = model.getObjectType(role.playerId);
      if (!player) continue; // structural/dangling-role-reference reports it

      // `dataTypeOf` and `valueConstraintOf` return undefined for an
      // entity type, so an entity-played role needs no separate guard.
      const domain = valueConstraintOf(player);
      const dataType = dataTypeOf(player);
      if (!domain && !dataType) continue;

      const admitted = domain ? valueDomainPredicate(domain) : undefined;

      for (const inst of pop.instances) {
        const val = inst.roleValues[role.id];
        if (val === undefined) continue;

        if (admitted && !admitted(val)) {
          const rangeNote = (domain?.ranges?.length ?? 0) > 0 ? " (or any permitted range)" : "";
          diagnostics.push(
            report(
              RULE_ID.valueTypeDomainViolation,
              "default",
              pop.id,
              pop.id,
              inst.id,
              val,
              player.name,
              (domain?.values ?? []).join(", "),
              rangeNote,
            ),
          );
        }

        if (dataType && !dataTypeAdmits(dataType.name, val)) {
          diagnostics.push(
            report(
              RULE_ID.valueTypeDataTypeViolation,
              "default",
              pop.id,
              pop.id,
              inst.id,
              val,
              player.name,
              dataType.name,
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}
