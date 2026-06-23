import type { JoinOperand, RolePath } from "../../model/Constraint.js";

export interface OrmYamlRolePath {
  root: string;
  steps: { entry: string; exit: string; }[];
}

export interface OrmYamlJoinOperand {
  path: OrmYamlRolePath;
  projection: number[];
}

/** Serialize a role path (root + ordered entry/exit hops). */
export function serializeRolePath(p: RolePath): OrmYamlRolePath {
  return {
    root: p.root,
    steps: p.steps.map((s) => ({ entry: s.entry, exit: s.exit })),
  };
}

/** Parse a role path back into the model shape. */
export function deserializeRolePath(p: OrmYamlRolePath): RolePath {
  return {
    root: p.root,
    steps: p.steps.map((s) => ({ entry: s.entry, exit: s.exit })),
  };
}

/** Serialize a join operand (path + projection node indices). */
export function serializeJoinOperand(o: JoinOperand): OrmYamlJoinOperand {
  return { path: serializeRolePath(o.path), projection: [...o.projection] };
}

/** Parse a join operand back into the model shape. */
export function deserializeJoinOperand(o: OrmYamlJoinOperand): JoinOperand {
  return { path: deserializeRolePath(o.path), projection: [...o.projection] };
}
