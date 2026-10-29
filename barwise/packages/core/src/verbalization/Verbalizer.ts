import type { ExportAnnotation } from "../annotation/ExportAnnotationCollector.js";
import type { DerivationRule, FactType } from "../model/FactType.js";
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import { verbalizeObjectCardinality } from "./constraints/phase2.js";
import { ConstraintVerbalizer } from "./ConstraintVerbalizer.js";
import { verbalizeObjectifiedFactType, verbalizeSubtypeFact } from "./elementSentences.js";
import { FactTypeVerbalizer } from "./FactTypeVerbalizer.js";
import { buildVerbalization, kwSeg, textSeg, type Verbalization } from "./Verbalization.js";

/** The taxonomy phrase for a derivation: "derived", "semiderived and stored", etc. */
function derivationPhrase(d: DerivationRule): string {
  const base = d.kind === "semiderived" ? "semiderived" : "derived";
  return d.storage === "derived_and_stored" ? `${base} and stored` : base;
}

/**
 * Main entry point for verbalizing an ORM model.
 *
 * Produces structured Verbalization objects for fact types and their
 * constraints, suitable for rendering in documentation, UIs, or
 * review documents.
 */
export class Verbalizer {
  private readonly factTypeVerbalizer = new FactTypeVerbalizer();
  private readonly constraintVerbalizer = new ConstraintVerbalizer();

  /**
   * Verbalize the entire model: all fact type readings and all
   * constraints, returned as a flat list sorted by fact type order.
   */
  verbalizeModel(model: OrmModel): Verbalization[] {
    const results: Verbalization[] = [];

    for (const ft of model.factTypes) {
      // Fact type readings.
      results.push(...this.factTypeVerbalizer.verbalizeAll(ft, model));
      // The constraints that live in the fact type. Those across fact
      // types follow in their own section, each said once.
      for (const c of ft.internalConstraints) {
        results.push(this.constraintVerbalizer.verbalize(c, ft, model));
      }
      // Derivation rule, when the fact type is derived.
      if (ft.derivation) {
        results.push(this.verbalizeDerivation(ft));
      }
    }

    // Object-type population cardinality.
    for (const ot of model.objectTypes) {
      if (ot.cardinality) {
        // A property of the object type, not a constraint in a list: the
        // row names the object type and applies to no fact type.
        results.push({
          ...verbalizeObjectCardinality(ot.id, ot.name, ot.cardinality.min, ot.cardinality.max),
          factTypeIds: [],
        });
      }
    }

    // Constraints across fact types, once each (orm-format-3, Open
    // decision 7), under a heading row.
    const across = model.constraints;
    if (across.length > 0) {
      results.push(
        buildVerbalization("constraints-across-fact-types", "section", [
          textSeg("Constraints across fact types"),
        ]),
      );
      for (const c of across) {
        results.push(this.constraintVerbalizer.verbalizeExternal(c, model));
      }
    }

    // Subtype fact verbalizations.
    for (const sf of model.subtypeFacts) {
      results.push(this.verbalizeSubtypeFact(sf, model));
    }

    // Objectified fact type verbalizations.
    for (const oft of model.objectifiedFactTypes) {
      results.push(this.verbalizeObjectifiedFactType(oft, model));
    }

    return results;
  }

  /**
   * Verbalize a model and append an "Open questions" section from
   * TODO-severity annotations.
   *
   * NOTE-severity annotations are informational and are not included
   * in the open questions section.
   *
   * @param model - The ORM model to verbalize.
   * @param annotations - Export annotations (only TODO-severity items
   *   are included as open questions).
   */
  verbalizeModelWithAnnotations(
    model: OrmModel,
    annotations: readonly ExportAnnotation[],
  ): Verbalization[] {
    const results = this.verbalizeModel(model);

    const todoAnnotations = annotations.filter((a) => a.severity === "todo");
    if (todoAnnotations.length === 0) return results;

    // Add a section header.
    results.push(
      buildVerbalization("open-questions", "open_question", [
        textSeg("== Open questions =="),
      ]),
    );

    // Add each TODO as an open question.
    for (const a of todoAnnotations) {
      const context = a.columnName
        ? `${a.tableName}.${a.columnName}`
        : a.tableName;
      results.push(
        buildVerbalization(a.tableName, "open_question", [
          textSeg(`[${context}] ${a.message}`),
        ]),
      );
    }

    return results;
  }

  /**
   * Verbalize a single fact type: its primary reading and all
   * constraints.
   */
  verbalizeFactType(
    factTypeId: string,
    model: OrmModel,
  ): Verbalization[] {
    const ft = model.getFactType(factTypeId);
    if (!ft) {
      return [];
    }

    const results: Verbalization[] = [];
    results.push(...this.factTypeVerbalizer.verbalizeAll(ft, model));
    results.push(
      ...this.constraintVerbalizer.verbalizeAll(ft.id, model),
    );
    return results;
  }

  /** Access the underlying fact type verbalizer. */
  get factTypes(): FactTypeVerbalizer {
    return this.factTypeVerbalizer;
  }

  /** Access the underlying constraint verbalizer. */
  get constraints(): ConstraintVerbalizer {
    return this.constraintVerbalizer;
  }

  /**
   * Verbalize a fact type's derivation rule: "Fact type '{name}' is
   * {derived | semiderived}[ and stored]: {expression}."
   */
  private verbalizeDerivation(ft: FactType): Verbalization {
    const d = ft.derivation!;
    return buildVerbalization(ft.id, "fact_type", [
      kwSeg("Fact type "),
      textSeg(`'${ft.name}' is `),
      kwSeg(derivationPhrase(d)),
      textSeg(`: ${d.expression}.`),
    ]);
  }

  /** A subtype fact's sentence; `elementSentences.ts` builds it. */
  verbalizeSubtypeFact(sf: SubtypeFact, model: OrmModel): Verbalization {
    return verbalizeSubtypeFact(sf, model);
  }

  /** An objectification's sentence; `elementSentences.ts` builds it. */
  verbalizeObjectifiedFactType(oft: ObjectifiedFactType, model: OrmModel): Verbalization {
    return verbalizeObjectifiedFactType(oft, model);
  }
}
