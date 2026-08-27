/**
 * Agreement over repeated extraction samples
 * (docs/specs/multi-sample-import.spec.md, workstream 1).
 *
 * Pure and deterministic: the same models in the same order produce a
 * byte-identical report. No LLM client, no I/O -- the sampling loop
 * lives in `sampleTranscript`, this file only folds its results.
 *
 * The fold never ranks. N samples cannot say which run is best (that
 * needs a rubric, which production does not have); what they honestly
 * yield is where the transcript underdetermines the model, so
 * disagreement is the deliverable, rendered as the pipeline's own
 * `ambiguities` vocabulary. The one selection made -- which sample to
 * emit as the model -- is the medoid: the sample whose summed
 * disagreement against the others is smallest, ties to the earliest.
 * Provenance stays an observation: the emitted model is always one
 * run's actual output, never a synthesis.
 */
import type { OrmModel } from "@barwise/core";
import { diffModels } from "@barwise/core/diff";
import type { Ambiguity } from "./ExtractionTypes.js";

/** One element the samples do not agree on. */
export interface SampleDisagreement {
  readonly elementType: "object_type" | "fact_type";
  readonly name: string;
  /**
   * "presence": the element is missing from some samples.
   * "shape": present in every sample, but differing from the medoid's
   * form in at least one (constraints, roles, readings...).
   * "naming": a removed+added pair the diff flags as a likely rename.
   */
  readonly kind: "presence" | "shape" | "naming";
  /** Samples agreeing with the majority form (for presence: containing it). */
  readonly agreeing: number;
  readonly total: number;
  /** The rename's other name, for kind "naming". */
  readonly otherName?: string;
}

export interface SampleAgreement {
  /** Index of the sample to emit as the model. */
  readonly medoidIndex: number;
  /** Elements identical across every sample. */
  readonly stable: number;
  readonly disagreements: readonly SampleDisagreement[];
  /** The disagreements, rendered in the pipeline's ambiguity vocabulary. */
  readonly ambiguities: readonly Ambiguity[];
}

interface ElementTally {
  readonly elementType: "object_type" | "fact_type";
  readonly name: string;
  count: number;
}

/** The two element namespaces cannot collide: the type prefixes differ. */
function keyOf(elementType: string, name: string): string {
  return `${elementType} ${name}`;
}

/** Deltas that represent an actual difference between two models. */
function differenceCount(a: OrmModel, b: OrmModel): number {
  return diffModels(a, b).deltas.filter((d) => d.kind !== "unchanged").length;
}

/**
 * Fold N sampled models into an agreement report. One model is a
 * degenerate but legal input: everything is stable and it is its own
 * medoid. An empty list is a caller error and throws.
 */
export function computeSampleAgreement(models: readonly OrmModel[]): SampleAgreement {
  if (models.length === 0) {
    throw new Error("computeSampleAgreement needs at least one sampled model.");
  }

  // Medoid by summed pairwise disagreement, ties to the earliest
  // sample so the result is deterministic in input order.
  let medoidIndex = 0;
  let best = Infinity;
  for (let i = 0; i < models.length; i++) {
    let sum = 0;
    for (let j = 0; j < models.length; j++) {
      if (j !== i) sum += differenceCount(models[i]!, models[j]!);
    }
    if (sum < best) {
      best = sum;
      medoidIndex = i;
    }
  }
  const medoid = models[medoidIndex]!;
  const total = models.length;

  // Presence: how many samples carry each element, keyed by kind+name
  // (name is the diff's own correspondence key).
  const presence = new Map<string, ElementTally>();
  const tally = (elementType: "object_type" | "fact_type", name: string): void => {
    const key = keyOf(elementType, name);
    const entry = presence.get(key) ?? { elementType, name, count: 0 };
    entry.count += 1;
    presence.set(key, entry);
  };
  for (const m of models) {
    for (const ot of m.objectTypes) tally("object_type", ot.name);
    for (const ft of m.factTypes) tally("fact_type", ft.name);
  }

  // Shape and naming: each sample against the medoid. A "modified"
  // delta is a shape difference; the diff's synonym candidates are the
  // naming ones.
  const shapeDisagree = new Map<string, ElementTally>();
  const naming = new Map<string, SampleDisagreement>();
  for (let i = 0; i < models.length; i++) {
    if (i === medoidIndex) continue;
    const diff = diffModels(medoid, models[i]!);
    for (const d of diff.deltas) {
      if (d.kind !== "modified" || d.elementType === "definition") continue;
      const key = keyOf(d.elementType, d.name);
      const entry = shapeDisagree.get(key)
        ?? { elementType: d.elementType, name: d.name, count: 0 };
      entry.count += 1;
      shapeDisagree.set(key, entry);
    }
    for (const s of diff.synonymCandidates) {
      const key = keyOf(s.elementType, `${s.removedName} ${s.addedName}`);
      if (!naming.has(key)) {
        naming.set(key, {
          elementType: s.elementType,
          name: s.removedName,
          kind: "naming",
          agreeing: 0, // filled below from presence
          total,
          otherName: s.addedName,
        });
      }
    }
  }

  const disagreements: SampleDisagreement[] = [];
  for (const entry of presence.values()) {
    if (entry.count === total) continue;
    disagreements.push({
      elementType: entry.elementType,
      name: entry.name,
      kind: "presence",
      agreeing: entry.count,
      total,
    });
  }
  for (const [key, entry] of shapeDisagree) {
    // Only elements every sample carries: a partially present element
    // is already reported once, as presence.
    const present = presence.get(key);
    if (!present || present.count !== total) continue;
    disagreements.push({
      elementType: entry.elementType,
      name: entry.name,
      kind: "shape",
      agreeing: total - entry.count,
      total,
    });
  }
  for (const d of naming.values()) {
    disagreements.push({
      ...d,
      agreeing: presence.get(keyOf(d.elementType, d.name))?.count ?? 0,
    });
  }

  const stable = [...presence.values()].filter((e) => e.count === total).length
    - disagreements.filter((d) => d.kind === "shape").length;

  return {
    medoidIndex,
    stable,
    disagreements,
    ambiguities: disagreements.map(renderAmbiguity),
  };
}

/**
 * A disagreement in the pipeline's own vocabulary: the transcript did
 * not settle this, or the samples would not have split on it. Source
 * references stay empty -- the evidence is the run set, not a line.
 */
function renderAmbiguity(d: SampleDisagreement): Ambiguity {
  const label = d.elementType === "object_type" ? "object type" : "fact type";
  let description: string;
  switch (d.kind) {
    case "presence":
      description = `Sampled ${d.total} extractions: ${d.agreeing} of ${d.total} `
        + `include the ${label} "${d.name}".`;
      break;
    case "shape":
      description = `Sampled ${d.total} extractions: ${d.total - d.agreeing} of ${d.total} `
        + `model the ${label} "${d.name}" differently (constraints, roles, or readings).`;
      break;
    case "naming":
      description = `Sampled ${d.total} extractions: the ${label} "${d.name}" `
        + `also appears named "${d.otherName}" -- likely one concept, two names.`;
      break;
  }
  return { description, source_references: [] };
}
