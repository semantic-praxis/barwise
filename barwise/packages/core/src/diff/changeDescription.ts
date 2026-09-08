/**
 * What changed between two versions of one element, as data rather than
 * prose.
 *
 * The diff used to produce only sentences -- `"cardinality changed"`,
 * `` `role 0: player Customer -> Client` `` -- and every consumer that
 * wanted to know anything about a change had to match on the sentence.
 * `breakingLevel.ts` did exactly that, by equality, prefix and regex,
 * and the two halves drifted: a standalone definition's text change was
 * classified `caution` and an object type's `safe`, for the same
 * conceptual change, because a producer spelled it one way and the
 * classifier knew another (barwise-946).
 *
 * A variant closes that class rather than guarding it. Classification
 * is a `Record<ChangeKind, BreakingLevel>`, so a variant added here
 * without a level is a missing key and does not compile, and a level
 * left behind for a variant that was deleted is an excess property and
 * does not either. That is what the source-scanning drift test used to
 * check at run time, and strictly better, because a scanner can only
 * find what its pattern matches.
 *
 * Two rules govern what a variant carries, both from the spec's
 * resolved decision (`docs/specs/closed-sets-as-unions.spec.md`):
 *
 * **Copies, not references.** A variant holding a live reference into a
 * model is corrupted by a later mutation of that model -- the aliasing
 * shape the merge's diagram layouts had. The values here are small, so
 * the producers `structuredClone` them and the delta is stable.
 *
 * **Plain data, never model instances.** A role arrives as
 * `{id, name, playerId, playerName}` rather than a `Role`, which keeps a
 * delta JSON-serializable for the MCP path and makes the copy trivially
 * correct. It carries both the id and the resolved name because the
 * prose resolved names against two _different_ models, so a consumer
 * holding only the delta could not re-derive them.
 */
import type { Constraint } from "../model/Constraint.js";
import type { DerivationRule } from "../model/FactType.js";
import type {
  CardinalityRange,
  DataTypeDef,
  ObjectTypeKind,
  ValueConstraintDef,
} from "../model/ObjectType.js";
import type { FactInstance } from "../model/Population.js";

/** One role of a fact type, flattened to plain data with its player resolved. */
export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly playerId: string;
  /** The player's name in the model this role came from. */
  readonly playerName: string;
}

/**
 * One difference between two versions of an element.
 *
 * The discriminant is `change`. Several variants render prose that
 * mentions no values (`"readings changed"`); they still carry the
 * before and after, because what the prose drops is exactly what a
 * consumer would need and could not recover.
 */
export type ChangeDescription =
  // --- Object types ---
  | { readonly change: "kind"; readonly from: ObjectTypeKind; readonly to: ObjectTypeKind; }
  | { readonly change: "referenceMode"; readonly from?: string; readonly to?: string; }
  | { readonly change: "sourceContext"; readonly from?: string; readonly to?: string; }
  | {
    readonly change: "valueConstraint";
    readonly from?: ValueConstraintDef;
    readonly to?: ValueConstraintDef;
  }
  | {
    readonly change: "cardinality";
    readonly from?: CardinalityRange;
    readonly to?: CardinalityRange;
  }
  | { readonly change: "independent"; readonly from: boolean; readonly to: boolean; }
  | { readonly change: "defaultValue"; readonly from?: string; readonly to?: string; }
  | {
    readonly change: "aliases";
    readonly from: readonly string[];
    readonly to: readonly string[];
  }
  // Three variants rather than one with optional halves: the source has
  // three branches and each words itself differently, so a single
  // variant would admit the state where neither side is present and
  // leave the renderer with a case it cannot word.
  | { readonly change: "dataTypeChanged"; readonly from: DataTypeDef; readonly to: DataTypeDef; }
  | { readonly change: "dataTypeAdded"; readonly to: DataTypeDef; }
  | { readonly change: "dataTypeRemoved"; readonly from: DataTypeDef; }
  // --- Fact types ---
  | { readonly change: "arity"; readonly from: number; readonly to: number; }
  | {
    readonly change: "rolePlayer";
    readonly index: number;
    readonly from: RoleSummary;
    readonly to: RoleSummary;
  }
  | {
    readonly change: "roleName";
    readonly index: number;
    readonly from: RoleSummary;
    readonly to: RoleSummary;
  }
  | {
    readonly change: "readings";
    readonly from: readonly string[];
    readonly to: readonly string[];
  }
  // The constraints themselves, not the deduplicated list of type names
  // the prose renders. This is the largest single recovery of
  // information in the union: `constraints added: internal_uniqueness`
  // told a consumer nothing about which roles the constraint covered.
  | { readonly change: "constraintsAdded"; readonly constraints: readonly Constraint[]; }
  | { readonly change: "constraintsRemoved"; readonly constraints: readonly Constraint[]; }
  | {
    readonly change: "derivation";
    readonly from?: DerivationRule;
    readonly to?: DerivationRule;
  }
  // --- Shared by object types and fact types ---
  | { readonly change: "definition"; readonly from?: string; readonly to?: string; }
  | { readonly change: "note"; readonly from?: string; readonly to?: string; }
  // --- Subtype facts ---
  //
  // The four fields a subtype fact carries beyond its two references.
  // An objectified fact type has no equivalent block: it carries
  // nothing beyond ITS two references, which is why its delta type
  // forbids `modified` outright.
  | {
    readonly change: "providesIdentification";
    readonly from: boolean;
    readonly to: boolean;
  }
  | { readonly change: "subtypeExclusive"; readonly from: boolean; readonly to: boolean; }
  | { readonly change: "subtypeExhaustive"; readonly from: boolean; readonly to: boolean; }
  | {
    readonly change: "definingRule";
    readonly from?: DerivationRule;
    readonly to?: DerivationRule;
  }
  // --- Populations ---
  //
  // Only two fields can differ between two populations that matched,
  // because the fact type and the sample flag are what made them match.
  | {
    readonly change: "populationDescription";
    readonly from?: string;
    readonly to?: string;
  }
  | {
    readonly change: "populationInstances";
    readonly from: readonly FactInstance[];
    readonly to: readonly FactInstance[];
    /**
     * How many tuples appeared and disappeared, counted at diff time.
     *
     * Carried rather than derived here because deriving it needs the
     * fact type's ROLE ORDER, which a delta does not have: tuples are
     * keyed by role id, and role ids churn across a re-extraction, so a
     * renderer comparing them by id sees every tuple as both added and
     * removed. Six unchanged tuples and one edited one printed
     * `instances: 6 added, 6 removed`. Positional comparison is the
     * same basis `instancesKey` uses to decide the populations differ
     * at all, so counting there keeps one answer instead of two.
     */
    readonly added: number;
    readonly removed: number;
  }
  // --- Definitions (the ubiquitous-language entries) ---
  //
  // `definitionText` and `context` are a standalone definition's
  // equivalents of an object type's `definition` and `sourceContext`
  // above, and they stay separate variants rather than being folded
  // into them. Folding would need the renderer to take the element type
  // in order to choose between two spellings, which reintroduces a
  // pairing the compiler cannot check; separate variants cost one
  // classification arm each and the compiler demands both. That the two
  // pairs agree on their breaking level is the behaviour barwise-946
  // was about, and it is asserted in `breakingLevel.test.ts`.
  | { readonly change: "definitionText"; readonly from: string; readonly to: string; }
  | { readonly change: "context"; readonly from?: string; readonly to?: string; };

/** The discriminant of `ChangeDescription`: which kind of change this is. */
export type ChangeKind = ChangeDescription["change"];

/** How an absent optional value reads in the rendered prose. */
const NONE = "(none)";

/**
 * Render one change as the sentence the diff has always emitted.
 *
 * Every string here is byte-identical to what `elementDiff.ts` used to
 * push, because `ModelDelta.changeDescriptions` is still derived from
 * this function and four packages display it. Changing what a surface
 * shows is a separate decision from making the data available, and this
 * workstream only does the second.
 */
export function describeChange(change: ChangeDescription): string {
  switch (change.change) {
    case "kind":
      return `kind: ${change.from} -> ${change.to}`;
    case "referenceMode":
      return `reference mode: "${change.from ?? NONE}" -> "${change.to ?? NONE}"`;
    case "sourceContext":
      return `source context: "${change.from ?? NONE}" -> "${change.to ?? NONE}"`;
    case "valueConstraint":
      return "value constraint changed";
    case "cardinality":
      return "cardinality changed";
    case "independent":
      return `independent: ${change.from} -> ${change.to}`;
    case "defaultValue":
      return `default value: "${change.from ?? NONE}" -> "${change.to ?? NONE}"`;
    case "aliases":
      return "aliases changed";
    case "dataTypeChanged":
      return `data type: ${formatDataType(change.from)} -> ${formatDataType(change.to)}`;
    case "dataTypeAdded":
      return `data type added: ${formatDataType(change.to)}`;
    case "dataTypeRemoved":
      return `data type removed (was ${formatDataType(change.from)})`;
    case "arity":
      return `arity: ${change.from} -> ${change.to}`;
    case "rolePlayer":
      return `role ${change.index}: player ${change.from.playerName} -> ${change.to.playerName}`;
    case "roleName":
      return `role ${change.index}: name "${change.from.name}" -> "${change.to.name}"`;
    case "readings":
      return "readings changed";
    case "constraintsAdded":
      return `constraints added: ${constraintTypes(change.constraints)}`;
    case "constraintsRemoved":
      return `constraints removed: ${constraintTypes(change.constraints)}`;
    case "derivation":
      return "derivation changed";
    case "definition":
      return "definition changed";
    case "note":
      return "note changed";
    case "definitionText":
      return "definition text changed";
    case "context":
      return `context: "${change.from ?? NONE}" -> "${change.to ?? NONE}"`;
    case "providesIdentification":
      return `provides identification: ${change.from} -> ${change.to}`;
    case "subtypeExclusive":
      return `exclusive: ${change.from} -> ${change.to}`;
    case "subtypeExhaustive":
      return `exhaustive: ${change.from} -> ${change.to}`;
    case "definingRule":
      return "defining rule changed";
    case "populationDescription":
      return `population description: "${change.from ?? NONE}" -> "${change.to ?? NONE}"`;
    case "populationInstances":
      return describeInstanceChange(change.added, change.removed);
  }
}

/**
 * How a population's tuples differ, in tuples rather than in counts.
 *
 * A count PAIR said nothing when the count did not move: editing one
 * tuple of one printed `instances: 1 -> 1`, and the reviewer saw a
 * modification with no visible content.
 */
function describeInstanceChange(added: number, removed: number): string {
  if (added > 0 && removed > 0) return `instances: ${added} added, ${removed} removed`;
  if (added > 0) return `instances: ${added} added`;
  if (removed > 0) return `instances: ${removed} removed`;
  // Same tuples, different instance ids only: the population changed in
  // a way nothing downstream can observe, which is worth saying plainly.
  return "instances reordered";
}

/** The deduplicated constraint type names, in first-seen order. */
function constraintTypes(constraints: readonly Constraint[]): string {
  return [...new Set(constraints.map((c) => c.type))].join(", ");
}

/** Format a DataTypeDef for human-readable diff output. */
function formatDataType(dt: DataTypeDef): string {
  let s = dt.name;
  if (dt.length !== undefined) s += `(${dt.length}`;
  if (dt.length !== undefined && dt.scale !== undefined) s += `,${dt.scale}`;
  if (dt.length !== undefined) s += ")";
  return s;
}
