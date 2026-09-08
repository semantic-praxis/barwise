/**
 * A seeded fast-check arbitrary over structurally valid `OrmModel`s.
 *
 * Split in two halves on purpose (docs/specs/core-model-laws.spec.md, WS1):
 *
 *  1. **Generation** produces plain element *configs* -- the same
 *     `ObjectTypeConfig`, `FactTypeConfig`, `SubtypeFactConfig`,
 *     `ObjectifiedFactTypeConfig`, `PopulationConfig`, `Definition` and
 *     `DiagramLayout` values a caller would hand to the model.
 *  2. **Construction** (`buildModel`) feeds those configs into an
 *     `OrmModel` through its `add*` methods and nothing else.
 *
 * The seam is what makes the sealed-record builder in
 * `core-branching-load.spec.md` a one-function change here: retarget
 * `buildModel`, leave generation alone.
 *
 * Generation goes through a raw parameter record which a pure function
 * (`toPlan`) turns into a consistent plan. fast-check shrinks the raw
 * record, so a failing model shrinks toward fewer, smaller elements
 * without ever passing through an inconsistent intermediate: ids and
 * names are derived from positions, never generated, so a role can only
 * reference a player that exists and two object types can never collide
 * on a name.
 *
 * **Structural validity is by construction, not by filter.** Every
 * choice that `structuralRules` would report is made unreachable here:
 * every identification edge runs from a higher-indexed entity to a lower
 * one -- a subtype to its supertype, and an objectifying type to each
 * entity player of the fact type it objectifies -- so the identification
 * graph cannot cycle; an objectification target is used at most once;
 * and a binary fact type always carries two readings. The
 * laws assert the result rather than trusting this comment.
 *
 * **Serializer conflations are avoided, not normalised away**, except
 * the four the spec names (see `normalise.ts`). The generator never
 * emits `isPreferred: false`, `modality: "alethic"`, `isFormal: false`,
 * an empty `ranges` array or an inclusive `minInclusive: true`, because
 * each of those reads back as absent and would make the round-trip law
 * fail on a conflation nobody decided to allow. Adding one to the
 * generator is how you find out whether it should be normalised or
 * fixed in the serializer.
 */

import fc from "fast-check";
import {
  type Constraint,
  CONSTRAINT_TYPES,
  type RingType,
  type ValueComparisonOperator,
} from "../../src/model/Constraint.js";
import type { Definition } from "../../src/model/Definition.js";
import type { DiagramLayout } from "../../src/model/DiagramLayout.js";
import type {
  DerivationKind,
  DerivationRule,
  FactTypeConfig,
  RoleConfig,
} from "../../src/model/FactType.js";
import type { ObjectifiedFactTypeConfig } from "../../src/model/ObjectifiedFactType.js";
import type {
  CardinalityRange,
  ConceptualDataTypeName,
  DataTypeDef,
  ObjectTypeConfig,
  ValueConstraintDef,
  ValueRange,
} from "../../src/model/ObjectType.js";
import { OrmModel, type OrmModelConfig } from "../../src/model/OrmModel.js";
import type { FactInstanceConfig, PopulationConfig } from "../../src/model/Population.js";
import type { SubtypeFactConfig } from "../../src/model/SubtypeFact.js";

/**
 * The seed every law runs at, and the number of models each generates.
 *
 * Fixed so the verdict is the same on every machine and every run: a
 * property that passes here passes in CI, and a failure reproduces from
 * this one number. Lower `RUNS` only on a measured CI regression
 * (docs/specs/core-model-laws.spec.md, Open decisions).
 */
export const SEED = 20260907;
export const RUNS = 250;

// ---------------------------------------------------------------------------
// Bounded vocabularies
// ---------------------------------------------------------------------------

/**
 * Free text comes from a fixed word list rather than `fc.string()`. The
 * laws are about structure, and a shrunk counterexample printed with
 * readable words is one a human can act on; random printable ASCII in
 * twenty fields is not. The empty string is a member of the *note*
 * alphabet only, because an empty note is one of the four conflations
 * the round-trip normaliser covers -- omit it and that rule goes dead.
 */
const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

const arbWord = fc.constantFrom(...WORDS);
const arbOptionalWord = fc.option(arbWord, { nil: null });
const arbNote = fc.option(fc.constantFrom("", ...WORDS), { nil: null });
const arbValue = fc.constantFrom("v1", "v2", "v3");
const arbBound = fc.constantFrom("1", "5", "10");

const DATA_TYPE_NAMES: readonly ConceptualDataTypeName[] = [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
];

const RING_TYPE_PICKS: readonly RingType[] = [
  "irreflexive",
  "asymmetric",
  "antisymmetric",
  "acyclic",
  "symmetric",
  "transitive",
  "intransitive",
  "purely_reflexive",
];

const COMPARISON_OPERATORS: readonly ValueComparisonOperator[] = [
  "<",
  "<=",
  "=",
  "<>",
  ">=",
  ">",
];

/**
 * Constraint kinds are drawn uniformly from the union's own runtime
 * list, not from a copy: a kind added to `Constraint` starts appearing
 * here immediately, and the coverage law fails until this module knows
 * how to build one.
 */
type ConstraintKind = Constraint["type"];

// ---------------------------------------------------------------------------
// The raw parameter record (what fast-check generates and shrinks)
// ---------------------------------------------------------------------------

interface RawRange {
  readonly min: string | null;
  readonly max: string | null;
  readonly minExclusive: boolean;
  readonly maxExclusive: boolean;
}

interface RawObjectType {
  readonly entity: boolean;
  readonly independent: boolean;
  readonly definition: string | null;
  readonly sourceContext: string | null;
  readonly note: string | null;
  readonly values: readonly string[] | null;
  readonly range: RawRange | null;
  readonly dataType: {
    readonly name: ConceptualDataTypeName;
    readonly length: number | null;
    readonly scale: number | null;
  } | null;
  readonly aliases: readonly string[];
  readonly defaultValue: string | null;
  readonly cardinality: { readonly min: number; readonly span: number | null; } | null;
}

interface RawDerivation {
  readonly kind: DerivationKind;
  /** `null` omits storage; "default" writes the value the serializer drops. */
  readonly storage: "default" | "stored" | null;
  readonly isFormal: boolean;
}

interface RawFactType {
  readonly arity: number;
  readonly playerPicks: readonly number[];
  /** Force roles 0 and 1 to share a player, so a ring constraint is legal. */
  readonly reflexive: boolean;
  readonly extraReading: boolean;
  readonly definition: string | null;
  readonly note: string | null;
  readonly derivation: RawDerivation | null;
}

interface RawConstraint {
  readonly kind: ConstraintKind;
  readonly ownerPick: number;
  readonly rolePicks: readonly number[];
  readonly factTypePick: number;
  readonly flag: boolean;
  readonly deontic: boolean;
  readonly min: number;
  readonly maxSpan: number | null;
  readonly ringType: RingType;
  readonly operator: ValueComparisonOperator;
  readonly values: readonly string[];
  readonly range: RawRange | null;
}

interface RawSubtypeFact {
  readonly pickA: number;
  readonly pickB: number;
  readonly providesIdentification: boolean;
  readonly isExclusive: boolean;
  readonly isExhaustive: boolean;
  readonly definingRule: RawDerivation | null;
}

interface RawObjectified {
  readonly factTypePick: number;
  readonly objectTypePick: number;
}

interface RawPopulation {
  readonly factTypePick: number;
  readonly sample: boolean;
  readonly description: string | null;
  readonly instances: readonly (readonly string[])[];
}

interface RawDiagram {
  readonly withElements: boolean;
  readonly positionPicks: readonly (readonly [number, number])[];
  readonly orientationPicks: readonly boolean[];
}

interface RawModel {
  readonly domainContext: string | null;
  readonly note: string | null;
  readonly objectTypes: readonly RawObjectType[];
  readonly factTypes: readonly RawFactType[];
  readonly constraints: readonly RawConstraint[];
  readonly subtypeFacts: readonly RawSubtypeFact[];
  readonly objectified: readonly RawObjectified[];
  readonly populations: readonly RawPopulation[];
  readonly definitions: readonly { readonly word: string; readonly context: string | null; }[];
  readonly diagrams: readonly RawDiagram[];
}

const arbRange: fc.Arbitrary<RawRange> = fc
  .record({
    min: fc.option(arbBound, { nil: null }),
    max: fc.option(arbBound, { nil: null }),
    minExclusive: fc.boolean(),
    maxExclusive: fc.boolean(),
  })
  // The schema requires at least one bound; an unbounded range is not a
  // range. Defaulting the lower bound keeps the shrinker from producing
  // a value the model would reject.
  .map((r) => (r.min === null && r.max === null ? { ...r, min: "1" } : r));

const arbDerivation: fc.Arbitrary<RawDerivation> = fc.record({
  kind: fc.constantFrom<DerivationKind>("derived", "semiderived"),
  storage: fc.constantFrom<"default" | "stored" | null>("default", "stored", null),
  // Never false: the serializer omits a false `is_formal`, which is a
  // conflation the spec did not name and the law must not absorb.
  isFormal: fc.constant(true),
});

const arbRawObjectType: fc.Arbitrary<RawObjectType> = fc.record({
  entity: fc.boolean(),
  independent: fc.boolean(),
  definition: arbOptionalWord,
  sourceContext: arbOptionalWord,
  note: arbNote,
  values: fc.option(fc.uniqueArray(arbValue, { minLength: 1, maxLength: 3 }), { nil: null }),
  range: fc.option(arbRange, { nil: null }),
  dataType: fc.option(
    fc.record({
      name: fc.constantFrom(...DATA_TYPE_NAMES),
      length: fc.option(fc.integer({ min: 1, max: 64 }), { nil: null }),
      scale: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
    }),
    { nil: null },
  ),
  aliases: fc.uniqueArray(arbWord, { maxLength: 2 }),
  defaultValue: fc.option(arbValue, { nil: null }),
  cardinality: fc.option(
    fc.record({
      min: fc.integer({ min: 0, max: 3 }),
      span: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
    }),
    { nil: null },
  ),
});

const arbRawFactType: fc.Arbitrary<RawFactType> = fc.record({
  arity: fc.constantFrom(1, 2, 3),
  playerPicks: fc.array(fc.nat({ max: 20 }), { minLength: 3, maxLength: 3 }),
  reflexive: fc.boolean(),
  extraReading: fc.boolean(),
  definition: arbOptionalWord,
  note: arbNote,
  derivation: fc.option(arbDerivation, { nil: null }),
});

const arbRawConstraint: fc.Arbitrary<RawConstraint> = fc.record({
  kind: fc.constantFrom(...CONSTRAINT_TYPES),
  ownerPick: fc.nat({ max: 20 }),
  rolePicks: fc.array(fc.nat({ max: 20 }), { minLength: 4, maxLength: 4 }),
  factTypePick: fc.nat({ max: 20 }),
  flag: fc.boolean(),
  deontic: fc.boolean(),
  min: fc.integer({ min: 0, max: 3 }),
  maxSpan: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  ringType: fc.constantFrom(...RING_TYPE_PICKS),
  operator: fc.constantFrom(...COMPARISON_OPERATORS),
  values: fc.uniqueArray(arbValue, { minLength: 1, maxLength: 3 }),
  range: fc.option(arbRange, { nil: null }),
});

const arbRawModel: fc.Arbitrary<RawModel> = fc.record({
  domainContext: arbOptionalWord,
  note: arbNote,
  objectTypes: fc.array(arbRawObjectType, { minLength: 2, maxLength: 5 }),
  factTypes: fc.array(arbRawFactType, { minLength: 1, maxLength: 4 }),
  constraints: fc.array(arbRawConstraint, { maxLength: 5 }),
  subtypeFacts: fc.array(
    fc.record({
      pickA: fc.nat({ max: 20 }),
      pickB: fc.nat({ max: 20 }),
      providesIdentification: fc.boolean(),
      isExclusive: fc.boolean(),
      isExhaustive: fc.boolean(),
      definingRule: fc.option(arbDerivation, { nil: null }),
    }),
    { maxLength: 3 },
  ),
  objectified: fc.array(
    fc.record({ factTypePick: fc.nat({ max: 20 }), objectTypePick: fc.nat({ max: 20 }) }),
    { maxLength: 2 },
  ),
  populations: fc.array(
    fc.record({
      factTypePick: fc.nat({ max: 20 }),
      sample: fc.boolean(),
      description: arbOptionalWord,
      instances: fc.array(fc.array(arbValue, { minLength: 3, maxLength: 3 }), { maxLength: 3 }),
    }),
    { maxLength: 2 },
  ),
  definitions: fc.array(fc.record({ word: arbWord, context: arbOptionalWord }), { maxLength: 3 }),
  diagrams: fc.array(
    fc.record({
      withElements: fc.boolean(),
      positionPicks: fc.array(
        fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 })),
        { maxLength: 4 },
      ),
      orientationPicks: fc.array(fc.boolean(), { maxLength: 3 }),
    }),
    { maxLength: 2 },
  ),
});

// ---------------------------------------------------------------------------
// The plan: element configs, ready for the model's add* methods
// ---------------------------------------------------------------------------

/**
 * Every element of a model as the config that constructs it. This is the
 * generation half's output and the construction half's input; nothing
 * else passes between them.
 */
export interface ModelPlan {
  readonly model: OrmModelConfig;
  readonly objectTypes: readonly ObjectTypeConfig[];
  readonly factTypes: readonly FactTypeConfig[];
  readonly subtypeFacts: readonly SubtypeFactConfig[];
  readonly objectifiedFactTypes: readonly ObjectifiedFactTypeConfig[];
  readonly populations: readonly PopulationConfig[];
  readonly definitions: readonly Definition[];
  readonly diagramLayouts: readonly DiagramLayout[];
}

/** Pick an element of a non-empty array by an unbounded raw index. */
function pick<T>(items: readonly T[], at: number): T {
  return items[at % items.length]!;
}

function toValueRange(raw: RawRange): ValueRange {
  // Only the non-default half of each flag is emitted: the serializer
  // writes `min_inclusive` only when it is false, so a generated `true`
  // would read back as absent and fail the round trip on a conflation
  // the spec does not name.
  return {
    ...(raw.min !== null ? { min: raw.min } : {}),
    ...(raw.max !== null ? { max: raw.max } : {}),
    ...(raw.minExclusive ? { minInclusive: false } : {}),
    ...(raw.maxExclusive ? { maxInclusive: false } : {}),
  };
}

function toValueConstraint(
  values: readonly string[] | null,
  range: RawRange | null,
): ValueConstraintDef | undefined {
  if (values === null && range === null) return undefined;
  return {
    values: values ?? [],
    // An empty `ranges` array is another unnamed conflation, so ranges is
    // either absent or non-empty.
    ...(range !== null ? { ranges: [toValueRange(range)] } : {}),
  };
}

function toDataType(raw: RawObjectType["dataType"]): DataTypeDef | undefined {
  if (raw === null) return undefined;
  return {
    name: raw.name,
    ...(raw.length !== null ? { length: raw.length } : {}),
    ...(raw.scale !== null ? { scale: raw.scale } : {}),
  };
}

function toCardinality(raw: RawObjectType["cardinality"]): CardinalityRange | undefined {
  if (raw === null) return undefined;
  return { min: raw.min, max: raw.span === null ? "unbounded" : raw.min + raw.span };
}

function toDerivation(raw: RawDerivation | null, expression: string): DerivationRule | undefined {
  if (raw === null) return undefined;
  return {
    kind: raw.kind,
    ...(raw.storage === null
      ? {}
      : { storage: raw.storage === "stored" ? "derived_and_stored" : "derive_on_request" }),
    expression,
    ...(raw.isFormal ? { isFormal: true } : {}),
  };
}

function toObjectTypes(raws: readonly RawObjectType[]): ObjectTypeConfig[] {
  return raws.map((raw, i) => {
    const kind = raw.entity ? "entity" : "value";
    return {
      id: `ot${i}`,
      name: `T${i}`,
      kind,
      // A value type must not carry a reference mode, and an entity type
      // must; both are constructor invariants, not generator choices.
      ...(raw.entity ? { referenceMode: `t${i}_id` } : {}),
      ...(raw.definition !== null ? { definition: raw.definition } : {}),
      ...(raw.sourceContext !== null ? { sourceContext: raw.sourceContext } : {}),
      ...(raw.note !== null ? { note: raw.note } : {}),
      ...(toValueConstraint(raw.values, raw.range) !== undefined
        ? { valueConstraint: toValueConstraint(raw.values, raw.range) }
        : {}),
      ...(toDataType(raw.dataType) !== undefined ? { dataType: toDataType(raw.dataType) } : {}),
      ...(raw.aliases.length > 0 ? { aliases: [...raw.aliases] } : {}),
      independent: raw.independent,
      ...(raw.defaultValue !== null ? { defaultValue: raw.defaultValue } : {}),
      ...(toCardinality(raw.cardinality) !== undefined
        ? { cardinality: toCardinality(raw.cardinality) }
        : {}),
    } satisfies ObjectTypeConfig;
  });
}

/** Roles and readings for one fact type; constraints are attached later. */
interface FactTypeSkeleton {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly RoleConfig[];
  readonly readings: readonly string[];
  readonly definition?: string;
  readonly note?: string;
  readonly derivation?: DerivationRule;
}

function toFactTypeSkeletons(
  raws: readonly RawFactType[],
  objectTypes: readonly ObjectTypeConfig[],
): FactTypeSkeleton[] {
  return raws.map((raw, j) => {
    const roles: RoleConfig[] = [];
    for (let k = 0; k < raw.arity; k++) {
      const player = raw.reflexive && k === 1
        ? pick(objectTypes, raw.playerPicks[0]!)
        : pick(objectTypes, raw.playerPicks[k]!);
      roles.push({ id: `ft${j}r${k}`, name: `plays${k}`, playerId: player.id! });
    }

    // A binary fact type with one reading is a structural warning, so
    // arity two always gets its inverse.
    const readings: string[] = [readingTemplate(raw.arity, j, false)];
    if (raw.arity === 2 || raw.extraReading) {
      readings.push(readingTemplate(raw.arity, j, true));
    }

    const derivation = toDerivation(raw.derivation, `every F${j} ${pick(WORDS, j)}`);
    return {
      id: `ft${j}`,
      name: `F${j}`,
      roles,
      readings,
      ...(raw.definition !== null ? { definition: raw.definition } : {}),
      ...(raw.note !== null ? { note: raw.note } : {}),
      ...(derivation !== undefined ? { derivation } : {}),
    };
  });
}

/** A reading whose placeholders cover every role exactly once. */
function readingTemplate(arity: number, index: number, inverse: boolean): string {
  const verb = pick(WORDS, index + (inverse ? 1 : 0));
  if (arity === 1) return inverse ? `{0} is ${verb}` : `{0} ${verb}`;
  if (arity === 2) return inverse ? `{1} is ${verb} by {0}` : `{0} ${verb} {1}`;
  return inverse ? `{2} is ${verb} of {0} and {1}` : `{0} ${verb} {1} with {2}`;
}

/**
 * Turn a raw constraint into a well-formed one, or drop it.
 *
 * Dropping is the whole strategy: a raw draw names a kind, and the kinds
 * with preconditions (a ring needs two roles sharing a player, a
 * cardinality needs a unary fact type, the spanning kinds need two fact
 * types) return null when the drawn model cannot host them. The
 * alternative -- repairing the draw -- silently converts one kind into
 * another and makes the coverage assertions meaningless.
 */
function toConstraint(
  raw: RawConstraint,
  skeletons: readonly FactTypeSkeleton[],
  index: number,
): { ownerIndex: number; constraint: Constraint; } | null {
  const ownerIndex = raw.ownerPick % skeletons.length;
  const owner = skeletons[ownerIndex]!;
  const roles = owner.roles;
  const id = `c${index}`;
  const modality = raw.deontic ? ({ modality: "deontic" } as const) : {};
  const roleAt = (n: number): string => pick(roles, raw.rolePicks[n]!).id!;

  /** A role from a fact type other than the owner, for spanning kinds. */
  const otherFactType = skeletons.length > 1
    ? skeletons[(ownerIndex + 1 + (raw.factTypePick % (skeletons.length - 1))) % skeletons.length]!
    : null;

  switch (raw.kind) {
    case "internal_uniqueness": {
      const ids = [...new Set([roleAt(0), roleAt(1)])];
      return {
        ownerIndex,
        constraint: {
          type: "internal_uniqueness",
          id,
          roleIds: ids,
          // Never `false`: the serializer omits it, so a generated false
          // would read back as absent.
          ...(raw.flag ? { isPreferred: true } : {}),
          ...modality,
        },
      };
    }
    case "mandatory":
      return { ownerIndex, constraint: { type: "mandatory", id, roleId: roleAt(0), ...modality } };
    case "value_constraint":
      return {
        ownerIndex,
        constraint: {
          type: "value_constraint",
          id,
          ...(raw.flag ? { roleId: roleAt(0) } : {}),
          values: [...raw.values],
          ...(raw.range !== null ? { ranges: [toValueRange(raw.range)] } : {}),
          ...modality,
        },
      };
    case "frequency": {
      const ids = [...new Set([roleAt(0), roleAt(1)])];
      // A frequency of zero occurrences is not a frequency: the schema
      // requires min >= 1, so the raw draw is lifted rather than dropped.
      const min = Math.max(1, raw.min);
      return {
        ownerIndex,
        constraint: {
          type: "frequency",
          id,
          roleIds: ids,
          min,
          max: raw.maxSpan === null ? "unbounded" : min + raw.maxSpan,
          ...modality,
        },
      };
    }
    case "ring": {
      // A ring constraint relates two roles of one fact type played by
      // the same object type; only a reflexive draw can supply that.
      const pair = reflexivePair(owner);
      if (!pair) return null;
      return {
        ownerIndex,
        constraint: {
          type: "ring",
          id,
          roleId1: pair[0],
          roleId2: pair[1],
          ringType: raw.ringType,
          ...modality,
        },
      };
    }
    case "value_comparison": {
      if (roles.length < 2) return null;
      return {
        ownerIndex,
        constraint: {
          type: "value_comparison",
          id,
          roleId1: roles[0]!.id!,
          roleId2: roles[1]!.id!,
          operator: raw.operator,
          ...modality,
        },
      };
    }
    case "cardinality": {
      if (roles.length !== 1) return null;
      return {
        ownerIndex,
        constraint: {
          type: "cardinality",
          id,
          roleId: roles[0]!.id!,
          min: raw.min,
          max: raw.maxSpan === null ? "unbounded" : raw.min + raw.maxSpan,
          ...modality,
        },
      };
    }
    case "external_uniqueness":
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or": {
      // Spanning kinds: two roles from two different fact types, which
      // is what keeps external uniqueness off the all-local diagnostic
      // and the other three above their two-role minimum.
      if (!otherFactType) return null;
      const roleIds = [roles[0]!.id!, otherFactType.roles[0]!.id!];
      return { ownerIndex, constraint: { type: raw.kind, id, roleIds, ...modality } };
    }
    case "subset":
    case "equality": {
      if (!otherFactType) return null;
      const left = [roles[0]!.id!];
      const right = [otherFactType.roles[0]!.id!];
      return {
        ownerIndex,
        constraint: raw.kind === "subset"
          ? { type: "subset", id, subsetRoleIds: left, supersetRoleIds: right, ...modality }
          : { type: "equality", id, roleIds1: left, roleIds2: right, ...modality },
      };
    }
    case "join_subset":
    case "join_equality":
    case "join_exclusion": {
      // A join operand is a declared path, so it needs a real hop: two
      // distinct roles of one fact type, rooted at the entry role's
      // player. Both operands take the same hop, which is the only shape
      // guaranteed to project comparable tuples on an arbitrary model --
      // the constraint is degenerate in meaning and well-formed in
      // structure, which is what these laws exercise.
      const hop = firstHop(skeletons);
      if (!hop) return null;
      const operand = { path: { root: hop.root, steps: [hop.step] }, projection: [0, 1] };
      if (raw.kind === "join_subset") {
        return {
          ownerIndex,
          constraint: { type: "join_subset", id, subset: operand, superset: operand, ...modality },
        };
      }
      return {
        ownerIndex,
        constraint: { type: raw.kind, id, operands: [operand, operand], ...modality },
      };
    }
  }
}

/** Two roles of one fact type sharing a player, if the skeleton has them. */
function reflexivePair(skeleton: FactTypeSkeleton): [string, string] | null {
  for (let a = 0; a < skeleton.roles.length; a++) {
    for (let b = a + 1; b < skeleton.roles.length; b++) {
      if (skeleton.roles[a]!.playerId === skeleton.roles[b]!.playerId) {
        return [skeleton.roles[a]!.id!, skeleton.roles[b]!.id!];
      }
    }
  }
  return null;
}

/** The first legal one-step hop in the model: entry, exit, and its root. */
function firstHop(
  skeletons: readonly FactTypeSkeleton[],
): { root: string; step: { entry: string; exit: string; }; } | null {
  for (const skeleton of skeletons) {
    if (skeleton.roles.length < 2) continue;
    const [entry, exit] = [skeleton.roles[0]!, skeleton.roles[1]!];
    return { root: entry.playerId, step: { entry: entry.id!, exit: exit.id! } };
  }
  return null;
}

function toSubtypeFacts(
  raws: readonly RawSubtypeFact[],
  objectTypes: readonly ObjectTypeConfig[],
): SubtypeFactConfig[] {
  const entities = objectTypes.filter((ot) => ot.kind === "entity");
  if (entities.length < 2) return [];

  const out: SubtypeFactConfig[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of raws.entries()) {
    const a = raw.pickA % entities.length;
    const b = raw.pickB % entities.length;
    if (a === b) continue;
    // The edge always runs from the higher index to the lower one, so
    // the hierarchy is a DAG by construction and never trips the cycle
    // rule; the pair set deduplicates what addSubtypeFact would reject.
    const sub = entities[Math.max(a, b)]!;
    const sup = entities[Math.min(a, b)]!;
    const key = `${sub.id}->${sup.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const definingRule = toDerivation(raw.definingRule, `each ${sub.name} ${pick(WORDS, i)}`);
    out.push({
      id: `sf${i}`,
      subtypeId: sub.id!,
      supertypeId: sup.id!,
      providesIdentification: raw.providesIdentification,
      isExclusive: raw.isExclusive,
      isExhaustive: raw.isExhaustive,
      ...(definingRule !== undefined ? { definingRule } : {}),
    });
  }
  return out;
}

function toObjectified(
  raws: readonly RawObjectified[],
  objectTypes: readonly ObjectTypeConfig[],
  skeletons: readonly FactTypeSkeleton[],
  subtypeFacts: readonly SubtypeFactConfig[],
): ObjectifiedFactTypeConfig[] {
  const entities = objectTypes.filter((ot) => ot.kind === "entity");
  if (entities.length === 0) return [];

  const entityIds = new Set(entities.map((ot) => ot.id!));

  // An objectifying entity is identified by the fact type it objectifies,
  // so it depends on every entity player of that fact type -- the same
  // kind of edge an identifying subtype fact makes to its supertype, and
  // together they are what `structural/identification-cycle` forbids.
  // Subtype edges are a DAG already (higher index to lower, above), but
  // adding objectification edges to them is not: picking any entity for
  // any fact type produced a cycle in 57 of 250 sampled models, 55 of
  // them an entity objectifying a fact type it plays a role in.
  //
  // The check is incremental rather than a rule about indices. An index
  // rule -- objectifier above every player -- is also acyclic, and it
  // cost the mapper law's composite-foreign-key coverage: a composite
  // key needs a fact type with two entity players, and few entities sit
  // above two others. Rejecting only the edges that actually close a
  // cycle keeps every shape the rule permits.
  const edges = new Map<string, string[]>();
  for (const sf of subtypeFacts) {
    if (!sf.providesIdentification) continue;
    edges.set(sf.subtypeId, [...(edges.get(sf.subtypeId) ?? []), sf.supertypeId]);
  }
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (edges.get(from) ?? []).some((next) => reaches(next, target, seen));
  };

  const out: ObjectifiedFactTypeConfig[] = [];
  const usedFactTypes = new Set<string>();
  const usedObjectTypes = new Set<string>();
  for (const [i, raw] of raws.entries()) {
    const ft = pick(skeletons, raw.factTypePick);
    const ot = pick(entities, raw.objectTypePick);
    if (usedFactTypes.has(ft.id) || usedObjectTypes.has(ot.id!)) continue;

    const players = ft.roles
      .map((role) => role.playerId)
      .filter((id) => entityIds.has(id));
    // A new edge ot -> player closes a cycle exactly when the player
    // already reaches ot.
    if (players.some((player) => reaches(player, ot.id!))) continue;

    edges.set(ot.id!, [...(edges.get(ot.id!) ?? []), ...players]);
    usedFactTypes.add(ft.id);
    usedObjectTypes.add(ot.id!);
    out.push({ id: `oft${i}`, factTypeId: ft.id, objectTypeId: ot.id! });
  }
  return out;
}

function toPopulations(
  raws: readonly RawPopulation[],
  skeletons: readonly FactTypeSkeleton[],
): PopulationConfig[] {
  return raws.map((raw, i) => {
    const ft = pick(skeletons, raw.factTypePick);
    const instances: FactInstanceConfig[] = raw.instances.map((values, k) => {
      const roleValues: Record<string, string> = {};
      for (const [r, role] of ft.roles.entries()) {
        roleValues[role.id!] = values[r] ?? "v1";
      }
      return { id: `p${i}i${k}`, roleValues };
    });
    return {
      id: `pop${i}`,
      factTypeId: ft.id,
      ...(raw.description !== null ? { description: raw.description } : {}),
      sample: raw.sample,
      instances,
    };
  });
}

function toDiagramLayouts(
  raws: readonly RawDiagram[],
  objectTypes: readonly ObjectTypeConfig[],
  skeletons: readonly FactTypeSkeleton[],
): DiagramLayout[] {
  return raws.map((raw, i) => {
    const positions: Record<string, { x: number; y: number; }> = {};
    for (const [k, [x, y]] of raw.positionPicks.entries()) {
      positions[pick(objectTypes, k).name] = { x, y };
    }
    const orientations: Record<string, "horizontal" | "vertical"> = {};
    for (const [k, horizontal] of raw.orientationPicks.entries()) {
      orientations[pick(skeletons, k).name] = horizontal ? "horizontal" : "vertical";
    }
    return {
      name: `View${i}`,
      ...(raw.withElements ? { elements: objectTypes.map((ot) => ot.name) } : {}),
      positions,
      orientations,
    };
  });
}

/** The generation half: raw draws in, element configs out. */
function toPlan(raw: RawModel): ModelPlan {
  const objectTypes = toObjectTypes(raw.objectTypes);
  const skeletons = toFactTypeSkeletons(raw.factTypes, objectTypes);

  const constraintsByOwner = new Map<number, Constraint[]>();
  for (const [i, rawConstraint] of raw.constraints.entries()) {
    const materialised = toConstraint(rawConstraint, skeletons, i);
    if (!materialised) continue;
    const bucket = constraintsByOwner.get(materialised.ownerIndex) ?? [];
    bucket.push(materialised.constraint);
    constraintsByOwner.set(materialised.ownerIndex, bucket);
  }

  const factTypes: FactTypeConfig[] = skeletons.map((skeleton, j) => ({
    ...skeleton,
    constraints: constraintsByOwner.get(j) ?? [],
  }));

  const subtypeFacts = toSubtypeFacts(raw.subtypeFacts, objectTypes);

  return {
    model: {
      name: "Generated",
      ...(raw.domainContext !== null ? { domainContext: raw.domainContext } : {}),
      ...(raw.note !== null ? { note: raw.note } : {}),
    },
    objectTypes,
    factTypes,
    subtypeFacts,
    objectifiedFactTypes: toObjectified(raw.objectified, objectTypes, skeletons, subtypeFacts),
    populations: toPopulations(raw.populations, skeletons),
    // Terms are index-suffixed because the merge keys definitions by
    // term: two definitions sharing one would collapse, and the law
    // would be reporting that rather than what it is about.
    definitions: raw.definitions.map((d, i) => ({
      term: `${d.word}${i}`,
      definition: `${d.word} means something`,
      ...(d.context !== null ? { context: d.context } : {}),
    })),
    diagramLayouts: toDiagramLayouts(raw.diagrams, objectTypes, skeletons),
  };
}

// ---------------------------------------------------------------------------
// The construction half
// ---------------------------------------------------------------------------

/**
 * Build the model from a plan through `OrmModel`'s own `add*` methods.
 *
 * The one place that knows how a model is assembled. When the sealed
 * record builder lands (`core-branching-load.spec.md`), this function is
 * what changes; nothing above it moves.
 */
export function buildModel(plan: ModelPlan): OrmModel {
  const model = new OrmModel(plan.model);
  for (const config of plan.objectTypes) model.addObjectType(config);
  for (const config of plan.factTypes) model.addFactType(config);
  for (const config of plan.subtypeFacts) model.addSubtypeFact(config);
  for (const config of plan.objectifiedFactTypes) model.addObjectifiedFactType(config);
  for (const config of plan.populations) model.addPopulation(config);
  for (const definition of plan.definitions) model.addDefinition(definition);
  for (const layout of plan.diagramLayouts) model.addDiagramLayout(layout);
  return model;
}

/** Element configs for a structurally valid model, before construction. */
export function arbModelPlan(): fc.Arbitrary<ModelPlan> {
  return arbRawModel.map(toPlan);
}

/** A structurally valid `OrmModel`: the two halves composed. */
export function arbOrmModel(): fc.Arbitrary<OrmModel> {
  return arbModelPlan().map(buildModel);
}
