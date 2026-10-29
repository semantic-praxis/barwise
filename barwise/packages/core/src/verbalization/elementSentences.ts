/**
 * The sentences for a subtype fact and an objectification, over
 * `ConstraintModel` rather than `OrmModel`, so the model can mint an
 * element's name from its sentence (iri-identity 6a, `model/mint.ts`)
 * without an import cycle. `Verbalizer` delegates its two methods here, so
 * the whole-model verbalization and a minted name read one sentence.
 */
import type { ConstraintModel } from "../model/constraintModel.js";
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import { expandReading } from "../model/ReadingOrder.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import {
  buildVerbalization,
  refSeg,
  textSeg,
  type Verbalization,
  type VerbalizationSegment,
} from "./Verbalization.js";

/**
 * Verbalize a subtype fact: "{Subtype} is a subtype of {Supertype}." When
 * the subtype is defined by a rule, the rule is appended: "..., defined as:
 * {expression}."
 */
export function verbalizeSubtypeFact(
  sf: SubtypeFact,
  model: ConstraintModel,
): Verbalization {
  const subtype = model.getObjectType(sf.subtypeId);
  const supertype = model.getObjectType(sf.supertypeId);
  const subtypeName = subtype?.name ?? sf.subtypeId;
  const supertypeName = supertype?.name ?? sf.supertypeId;

  const segments: VerbalizationSegment[] = [
    refSeg(subtypeName, sf.subtypeId),
    textSeg(" is a subtype of "),
    refSeg(supertypeName, sf.supertypeId),
  ];
  if (sf.definingRule) {
    segments.push(textSeg(`, defined as: ${sf.definingRule.expression}`));
  }
  segments.push(textSeg("."));

  return buildVerbalization(sf.id, "subtype", segments);
}

/**
 * Verbalize an objectified fact type:
 * "{EntityType} is where {primary reading of fact type}."
 *
 * For example: "Marriage is where Person marries Person."
 */
export function verbalizeObjectifiedFactType(
  oft: ObjectifiedFactType,
  model: ConstraintModel,
): Verbalization {
  const objectType = model.getObjectType(oft.objectTypeId);
  const factType = model.getFactType(oft.factTypeId);
  const entityName = objectType?.name ?? oft.objectTypeId;

  const segments: VerbalizationSegment[] = [
    refSeg(entityName, oft.objectTypeId),
    textSeg(" is where "),
  ];

  if (factType && factType.readings.length > 0) {
    const reading = factType.readings[0]!;
    const roleNames = factType.roles.map((r) => {
      const player = model.getObjectType(r.playerId);
      return player?.name ?? r.name;
    });
    const expanded = expandReading(reading.template, roleNames);
    segments.push(textSeg(expanded));
  } else {
    segments.push(textSeg(factType?.name ?? oft.factTypeId));
  }

  segments.push(textSeg("."));

  return buildVerbalization(oft.id, "objectification", segments);
}
