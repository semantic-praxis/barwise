/**
 * Decodes NORMA join paths into Barwise `JoinOperand`s (role-path spec,
 * WS6 / PR 4).
 *
 * A NORMA join role sequence carries a role path (root object type +
 * purpose-tagged pathed roles) and a projection. Barwise stores the
 * concept -- `{ root, steps, projection }` -- so the decoder walks the
 * purpose tags to reconstruct the hops and converts projection sources
 * into path-node indices. The purpose tags themselves are never stored.
 *
 * The decoder covers the minimal linear grammar the spec signs off:
 * single-fact-type hops, one join variable (the root), projected node
 * indices. Anything outside it -- branching, calculated projections,
 * dangling entries -- returns undefined, and the caller falls back to the
 * flat constraint mapping (today's behavior for join sequences).
 */
import type { JoinOperand, RolePathStep } from "@barwise/core";
import type { NormaDocument, NormaJoinPath } from "../NormaXmlTypes.js";
import type { NormaMappingContext } from "./context.js";

/** Decodes join role sequences against one parsed document. */
export interface NormaJoinDecoder {
  /**
   * Decode one constraint role sequence into a JoinOperand.
   *
   * With a join path, the operand is reconstructed from the path and its
   * projection (defaulting to root + endpoint when no projection is
   * recorded). Without one, a two-role sequence within a single fact type
   * becomes the equivalent one-hop operand -- the flat side of a
   * mixed flat/join comparison. Returns undefined when the sequence is
   * outside the minimal grammar.
   */
  decodeOperand(
    seqRefs: readonly string[],
    joinPath: NormaJoinPath | undefined,
  ): JoinOperand | undefined;
}

/** Build a join decoder over the mapping context's document. */
export function createJoinDecoder(ctx: NormaMappingContext): NormaJoinDecoder {
  const roleIndex = buildRoleIndex(ctx.doc);
  return {
    decodeOperand(seqRefs, joinPath) {
      if (joinPath) return decodeFromPath(joinPath, ctx, roleIndex);
      return flatOperand(seqRefs, ctx, roleIndex);
    },
  };
}

interface RoleInfo {
  readonly factTypeId: string;
  readonly playerRef: string;
}

/** Index every fact role in the document by id. */
function buildRoleIndex(doc: NormaDocument): Map<string, RoleInfo> {
  const index = new Map<string, RoleInfo>();
  for (const nft of doc.factTypes) {
    for (const role of nft.roles) {
      index.set(role.id, { factTypeId: nft.id, playerRef: role.playerRef });
    }
  }
  return index;
}

/**
 * Walk the purpose-tagged pathed roles into `{ entry, exit }` steps and
 * convert the projection into node indices.
 *
 * An entry role (purpose None or PostInnerJoin) opens a hop; the
 * following SameFactType role closes it. Node `0` is the root; the entry
 * of step `i` sits at node `i` and its exit at node `i + 1`.
 */
function decodeFromPath(
  joinPath: NormaJoinPath,
  ctx: NormaMappingContext,
  roleIndex: Map<string, RoleInfo>,
): JoinOperand | undefined {
  const { rolePath, projections } = joinPath;
  const root = ctx.objectTypeIdMap.get(rolePath.rootObjectTypeRef);
  if (!root) return undefined;

  const steps: RolePathStep[] = [];
  // Node index for each pathed role id, used to resolve projections.
  const nodeOfPathedRole = new Map<string, number>();
  let pendingEntry: string | undefined;
  let currentPlayer = rolePath.rootObjectTypeRef;

  for (const pr of rolePath.pathedRoles) {
    const info = roleIndex.get(pr.roleRef);
    if (!info) return undefined;

    if (pr.purpose === "SameFactType") {
      // Exit role: closes the pending hop within the same fact type.
      if (pendingEntry === undefined) return undefined;
      const entryInfo = roleIndex.get(pendingEntry)!;
      if (entryInfo.factTypeId !== info.factTypeId) return undefined;
      steps.push({ entry: pendingEntry, exit: pr.roleRef });
      nodeOfPathedRole.set(pr.id, steps.length);
      currentPlayer = info.playerRef;
      pendingEntry = undefined;
    } else {
      // Entry role (None starts at the root, PostInnerJoin joins onward):
      // must be played by the current path node and must not stack.
      if (pendingEntry !== undefined) return undefined;
      if (info.playerRef !== currentPlayer) return undefined;
      pendingEntry = pr.roleRef;
      nodeOfPathedRole.set(pr.id, steps.length);
    }
  }

  if (pendingEntry !== undefined) return undefined; // Dangling entry.
  if (steps.length === 0) return undefined;

  if (projections.length === 0) {
    // No recorded projection: the common (root, endpoint) pair.
    return { path: { root, steps }, projection: [0, steps.length] };
  }

  const projection: number[] = [];
  for (const p of projections) {
    const node = nodeOfPathedRole.get(p.pathedRoleRef);
    if (node === undefined) return undefined;
    projection.push(node);
  }
  return { path: { root, steps }, projection };
}

/**
 * Convert a flat two-role sequence (both roles of one fact type) into the
 * equivalent one-hop operand: root = first role's player, one
 * `{ entry, exit }` step, projection `[0, 1]`.
 */
function flatOperand(
  seqRefs: readonly string[],
  ctx: NormaMappingContext,
  roleIndex: Map<string, RoleInfo>,
): JoinOperand | undefined {
  if (seqRefs.length !== 2) return undefined;
  const first = roleIndex.get(seqRefs[0]!);
  const second = roleIndex.get(seqRefs[1]!);
  if (!first || !second) return undefined;
  if (first.factTypeId !== second.factTypeId) return undefined;

  const root = ctx.objectTypeIdMap.get(first.playerRef);
  if (!root) return undefined;

  return {
    path: { root, steps: [{ entry: seqRefs[0]!, exit: seqRefs[1]! }] },
    projection: [0, 1],
  };
}
