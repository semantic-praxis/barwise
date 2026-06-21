/**
 * Role-path operand for join constraints (and, later, derivation rules and
 * queries). A declared, serialized path: a root object type -- the join
 * variable that correlates operand paths -- and an ordered list of single-
 * fact-type hops, each entering at one role and exiting at another role of
 * the same fact type. See docs/specs/role-path-model.spec.md.
 *
 * Unlike the query `path` (discovered at read time, name-keyed,
 * fact-type-granular), a `RolePath` is declared, role-id-keyed, and stored,
 * so it round-trips and diffs. The two share the `model/roleGraph.ts`
 * traversal (one graph-walk, two callers), not this type.
 */

/**
 * One hop of a role path: enter a fact type at `entry` (a role played by the
 * current node) and exit at `exit` (another role of the same fact type),
 * arriving at `exit`'s player. The fact type is derivable from the role ids.
 */
export interface RolePathStep {
  /** Entry role id (played by the current path node). */
  readonly entry: string;
  /** Exit role id (another role of the entry role's fact type). */
  readonly exit: string;
}

/**
 * A linear role path: a root object type (the join variable) and the ordered
 * hops traversed from it. With no steps the endpoint is the root itself;
 * otherwise the endpoint is the player of the last step's exit role.
 */
export interface RolePath {
  /** The root object type id -- the correlation / join variable's type. */
  readonly root: string;
  /** The ordered hops; empty means the path is just the root. */
  readonly steps: readonly RolePathStep[];
}

/**
 * A join-constraint operand: a role path plus the projection that selects
 * which path nodes' players form the compared tuple (Halpin's "role sequence
 * projected from a join path"). Node `0` is the root; node `k` is the player
 * reached after step `k`. The compared tuple is the players at the projected
 * nodes, in order; the projection length is the operand's arity. The common
 * (root, endpoint) case for an n-step path is `[0, n]`.
 */
export interface JoinOperand {
  /** The role path this operand projects from. */
  readonly path: RolePath;
  /** Path-node indices (0 = root, k = after step k) forming the tuple. */
  readonly projection: readonly number[];
}
