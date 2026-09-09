/**
 * The shape of one hop in the model's role graph.
 *
 * The walk that produces these lives in `graph.ts`, which is its only
 * caller. This file keeps the type because `RoleHop` is part of
 * `ModelGraph`'s published interface and importing it from the module
 * that builds the graph would be circular.
 */

import type { FactType } from "./FactType.js";
import type { Role } from "./Role.js";

/**
 * One single-fact-type hop leaving an object type: enter the fact type at
 * `entryRole` (a role the object plays) and exit at `exitRole` (another role
 * of the same fact type), arriving at `exitRole`'s player.
 */
export interface RoleHop {
  readonly factType: FactType;
  readonly entryRole: Role;
  readonly exitRole: Role;
}
