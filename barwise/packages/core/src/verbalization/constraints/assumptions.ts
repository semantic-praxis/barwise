/**
 * What a constraint's sentence assumes of its constraint, beyond its
 * references resolving: that it has something to say, that roles it
 * calls one player's share that player, and that a join path chains. The
 * sentence does not check these -- it phrases around a broken shape (the
 * first role's player as the common one, the root for a node a path does
 * not reach), which is right for a reader who will also see validation's
 * report, and wrong for a name minted from it (iri-identity 6a,
 * `model/mint.ts`): the name would state something the constraint does
 * not.
 *
 * Kept beside the sentences it describes, so a change to what a sentence
 * assumes is made here in the same edit. This is not validation, which
 * reports these and more over the whole model; it answers whether this
 * one sentence is of its constraint.
 */
import {
  type Constraint,
  isOverSubtypes,
  joinOperandsOf,
  roleIdsOf,
  subtypeFactIdsOf,
} from "../../model/Constraint.js";
import type { ConstraintModel } from "../../model/constraintModel.js";
import type { JoinOperand } from "../../model/RolePath.js";

/**
 * Whether the constraint's sentence describes it. Assumes every reference
 * resolves, which the caller checks first.
 */
export function sentenceHolds(c: Constraint, model: ConstraintModel): boolean {
  const joins = joinOperandsOf(c);
  if (joins.length > 0) return joins.every((o) => operandChains(o, model));
  if (isOverSubtypes(c)) return sharesSupertype(subtypeFactIdsOf(c), model);
  const roles = roleIdsOf(c);
  if (roles.length === 0) return c.type === "value_constraint";
  // These three say "each <player> ..." of one player: the verbalizer
  // takes the first role's, so roles of different players would be
  // misstated.
  if (c.type === "disjunctive_mandatory" || c.type === "exclusion" || c.type === "exclusive_or") {
    return sharesPlayer(roles, model);
  }
  return true;
}

function sharesPlayer(roleIds: readonly string[], model: ConstraintModel): boolean {
  const players = new Set(roleIds.map((id) => model.findRole(id)?.playerId));
  return players.size === 1 && !players.has(undefined);
}

/** "Each <supertype> is at most one of ..." names one supertype. */
function sharesSupertype(subtypeFactIds: readonly string[], model: ConstraintModel): boolean {
  const supertypes = new Set(subtypeFactIds.map((id) => model.getSubtypeFact(id)?.supertypeId));
  return supertypes.size === 1 && !supertypes.has(undefined);
}

/**
 * A join operand reads as the path it declares only when each hop enters
 * and exits one fact type, the first hop is entered by the root's player
 * and each later one by the previous hop's arrival, and every projected
 * node is one the path reaches.
 */
function operandChains(o: JoinOperand, model: ConstraintModel): boolean {
  let at = o.path.root;
  for (const step of o.path.steps) {
    if (step.entry === step.exit) return false;
    // One holder: the caller has resolved each role to exactly one.
    const ft = model.factTypesHolding([step.entry])[0]!;
    const entry = ft.getRoleById(step.entry)!;
    const exit = ft.getRoleById(step.exit);
    if (!exit || entry.playerId !== at) return false;
    at = exit.playerId;
  }
  return o.projection.length > 0
    && o.projection.every((i) => Number.isInteger(i) && i >= 0 && i <= o.path.steps.length);
}
