import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { splitReading } from "../model/ReadingOrder.js";
import { leadSegs } from "./constraints/sentence.js";
import {
  buildVerbalization,
  refSeg,
  textSeg,
  type Verbalization,
  type VerbalizationSegment,
} from "./Verbalization.js";

/**
 * Verbalizes fact types using their reading templates.
 *
 * For each reading, placeholders are replaced with structured
 * object-type references so that UIs can render them with formatting
 * and hyperlinks.
 */
export class FactTypeVerbalizer {
  /**
   * Verbalize all readings of a fact type.
   *
   * Returns one Verbalization per reading order.
   */
  verbalizeAll(factType: FactType, model: OrmModel): Verbalization[] {
    return factType.readings.map((reading) =>
      this.verbalizeReading(factType, reading.template, model)
    );
  }

  /**
   * Verbalize the first (primary/forward) reading of a fact type.
   */
  verbalizePrimary(factType: FactType, model: OrmModel): Verbalization {
    const template = factType.readings[0]!.template;
    return this.verbalizeReading(factType, template, model);
  }

  /**
   * Produce a structured Verbalization from a reading template by
   * parsing its segments and resolving placeholders to object type refs.
   */
  private verbalizeReading(
    factType: FactType,
    template: string,
    model: OrmModel,
  ): Verbalization {
    const segments = parseReadingTemplate(factType, template, model);
    return buildVerbalization(factType.id, "fact_type", segments);
  }
}

/**
 * Parse a reading template into structured segments.
 *
 * Text between placeholders becomes text segments; placeholders become
 * object_type_ref segments that link to the role's player, each after the
 * words hyphen-bound to it (reading-hyphen-binding.spec.md).
 */
function parseReadingTemplate(
  factType: FactType,
  template: string,
  model: OrmModel,
): VerbalizationSegment[] {
  const segments: VerbalizationSegment[] = [];
  for (const part of splitReading(template).parts) {
    if (part.kind === "text") {
      segments.push(textSeg(part.text));
      continue;
    }
    segments.push(...leadSegs(part.lead));
    const role = factType.roles[part.index];
    if (role) {
      const objectType = model.getObjectType(role.playerId);
      const name = objectType?.name ?? role.name;
      segments.push(refSeg(name, role.playerId));
    } else {
      // Fallback: leave the placeholder as text.
      segments.push(textSeg(`{${part.index}}`));
    }
  }
  return segments;
}
