/**
 * What a constraint's sentence assumes of its constraint, beyond its
 * references resolving: that it has something to say, that roles it
 * calls one player's share that player, and that a join path chains and
 * its operands project comparable columns. The sentence does not check
 * these -- it phrases around a broken shape (the first role's player as
 * the common one, the first operand's columns as every operand's), which
 * is right for a reader who will also see validation's report, and wrong
 * for a name minted from it (iri-identity 6a, `model/mint.ts`): the name
 * would state something the constraint does not.
 *
 * This restates part of what validation's constraint rules check, so the
 * two are held together by a test, not by this comment:
 * `tests/model/mintAgreesWithValidation.test.ts` classifies every
 * `constraint/*` rule as one this refuses (with a model that rule reports
 * and this refuses) or one whose report the sentence still states (with
 * the reason), and fails on a rule it has not classified.
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
 * resolves, each role to exactly one fact type, which the caller checks
 * first.
 */
export function sentenceHolds(c: Constraint, model: ConstraintModel): boolean {
  // A list naming one role twice reads as two of its player ("each
  // combination of Person and Person"), or as a ring over positions the
  // constraint does not name. Nothing reports it (barwise-ik3).
  if (!roleListsDistinct(c)) return false;
  switch (c.type) {
    case "join_subset":
      return comparable([c.subset, c.superset], model);
    case "join_equality":
    case "join_exclusion":
      return c.operands.length >= 2 && comparable(c.operands, model);
    case "join_ring": {
      // "No <type> is related to that same <type>" reads the first
      // projected column's type for both ends.
      const columns = projected(c.operand, model);
      const [from, to] = c.operand.projection;
      return columns !== undefined && columns.length === 2 && from !== to
        && columns[0] === columns[1];
    }
    case "ring":
      // The sentence names the first role's player for both ends.
      return sharesPlayer([c.roleId1, c.roleId2], model);
    case "cardinality":
      // "The '<predicate>' role is played by ..." reads a unary's predicate.
      return model.factTypesHolding([c.roleId])[0]!.arity === 1;
    default:
      break;
  }
  if (isOverSubtypes(c)) return sharesSupertype(subtypeFactIdsOf(c), model);
  const roles = roleIdsOf(c);
  if (roles.length === 0) return c.type === "value_constraint";
  // "No Person both works for ..." over one role forbids what an
  // exclusion of one constrains not at all.
  if (c.type === "exclusion" && roles.length < 2) return false;
  // These three say "each <player> ..." of one player: the verbalizer
  // takes the first role's, so roles of different players would be
  // misstated.
  if (c.type === "disjunctive_mandatory" || c.type === "exclusion" || c.type === "exclusive_or") {
    return sharesPlayer(roles, model);
  }
  return true;
}

/**
 * Each list of roles a sentence reads names each role once. Two lists
 * (a subset's sides, an equality's) are read separately: the same role on
 * both sides states a tautology, which is what is stored. A join path may
 * pass through one role twice, and its operands are checked as paths.
 */
function roleListsDistinct(c: Constraint): boolean {
  const lists: readonly (readonly string[])[] = c.type === "subset"
    ? [c.subsetRoleIds, c.supersetRoleIds]
    : c.type === "equality"
    ? [c.roleIds1, c.roleIds2]
    : joinOperandsOf(c).length > 0
    ? []
    : [roleIdsOf(c)];
  return lists.every((ids) => new Set(ids).size === ids.length);
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
 * The sentences over two operands or more read the root ("For each
 * <root>") and the column types from the first operand alone, so every
 * operand must start at the same type and project the same number of
 * columns of the same types.
 */
function comparable(operands: readonly JoinOperand[], model: ConstraintModel): boolean {
  if (new Set(operands.map((o) => o.path.root)).size !== 1) return false;
  const columns = operands.map((o) => projected(o, model));
  const first = columns[0];
  return first !== undefined
    && columns.every((cols) =>
      cols !== undefined && cols.length === first.length && cols.every((t, i) => t === first[i])
    );
}

/**
 * The object type of each projected node, or undefined when the operand
 * does not read as the path it declares: each hop enters and exits one
 * fact type by two roles, the first hop is entered by the root's player
 * and each later one by the previous hop's arrival, and the projection
 * names at least one node the path reaches.
 */
function projected(o: JoinOperand, model: ConstraintModel): readonly string[] | undefined {
  const nodes = [o.path.root];
  for (const step of o.path.steps) {
    if (step.entry === step.exit) return undefined;
    // One holder: the caller has resolved each role to exactly one.
    const ft = model.factTypesHolding([step.entry])[0]!;
    const entry = ft.getRoleById(step.entry)!;
    const exit = ft.getRoleById(step.exit);
    if (!exit || entry.playerId !== nodes[nodes.length - 1]) return undefined;
    nodes.push(exit.playerId);
  }
  if (o.projection.length === 0) return undefined;
  const columns: string[] = [];
  for (const i of o.projection) {
    if (!Number.isInteger(i) || i < 0 || i >= nodes.length) return undefined;
    columns.push(nodes[i]!);
  }
  return columns;
}
