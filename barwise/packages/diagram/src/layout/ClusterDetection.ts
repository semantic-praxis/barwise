// ---------------------------------------------------------------------------
// Cluster detection (Louvain-based community detection)
// ---------------------------------------------------------------------------

/**
 * Partition entities into communities using Louvain modularity
 * optimization, so the two-level layout can place each cluster
 * independently.
 *
 * Pure: a function of the entity ids and the pairwise edge weights, with
 * no ELK or model dependency. Graphs of four or fewer entities, or with
 * no edge weight, collapse to a single community.
 *
 * @internal Exported for testing.
 */
export function detectClusters(
  entityIds: string[],
  edgeWeights: Map<string, number>,
): Map<string, number> {
  // Too few entities for meaningful clustering.
  if (entityIds.length <= 4) {
    const result = new Map<string, number>();
    for (const id of entityIds) result.set(id, 0);
    return result;
  }

  // Build adjacency list.
  const adj = new Map<string, Map<string, number>>();
  for (const id of entityIds) adj.set(id, new Map());

  for (const [key, weight] of edgeWeights) {
    const parts = key.split("--");
    const a = parts[0]!;
    const b = parts[1]!;
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.set(b, weight);
    adj.get(b)!.set(a, weight);
  }

  // Total weight.
  let m = 0;
  for (const w of edgeWeights.values()) m += w;
  if (m === 0) {
    const result = new Map<string, number>();
    for (const id of entityIds) result.set(id, 0);
    return result;
  }

  // Degree of each node.
  const degree = new Map<string, number>();
  for (const id of entityIds) {
    let d = 0;
    for (const w of adj.get(id)!.values()) d += w;
    degree.set(id, d);
  }

  // Initialize: each entity in its own community.
  const community = new Map<string, number>();
  for (let i = 0; i < entityIds.length; i++) {
    community.set(entityIds[i]!, i);
  }

  // Louvain phase 1: iteratively move nodes to improve modularity.
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;

    for (const nodeId of entityIds) {
      const currentComm = community.get(nodeId)!;
      const ki = degree.get(nodeId)!;
      const nodeAdj = adj.get(nodeId)!;

      // Edges from this node to each community.
      const commEdges = new Map<number, number>();
      for (const [neighborId, weight] of nodeAdj) {
        const nc = community.get(neighborId)!;
        commEdges.set(nc, (commEdges.get(nc) ?? 0) + weight);
      }

      // Sum of degrees for relevant communities.
      const commDegrees = new Map<number, number>();
      for (const [id, comm] of community) {
        if (commEdges.has(comm) || comm === currentComm) {
          commDegrees.set(comm, (commDegrees.get(comm) ?? 0) + degree.get(id)!);
        }
      }

      const ki_in = commEdges.get(currentComm) ?? 0;
      const sigmaOwn = commDegrees.get(currentComm) ?? ki;

      let bestGain = 0;
      let bestComm = currentComm;

      for (const [candidateComm, ki_c] of commEdges) {
        if (candidateComm === currentComm) continue;
        const sigmaC = commDegrees.get(candidateComm) ?? 0;
        const gain = (ki_c - ki_in) / m - (ki * (sigmaC - (sigmaOwn - ki))) / (2 * m * m);
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = candidateComm;
        }
      }

      if (bestComm !== currentComm) {
        community.set(nodeId, bestComm);
        improved = true;
      }
    }

    if (!improved) break;
  }

  // Find the largest cluster (for fallback merging).
  const clusterSizes = new Map<number, number>();
  for (const comm of community.values()) {
    clusterSizes.set(comm, (clusterSizes.get(comm) ?? 0) + 1);
  }
  let largestClusterId = 0;
  let largestSize = 0;
  for (const [cid, size] of clusterSizes) {
    if (size > largestSize) {
      largestSize = size;
      largestClusterId = cid;
    }
  }

  // Merge small clusters (< 3 members) into most-connected neighbor.
  const clusterMembers = new Map<number, string[]>();
  for (const [id, comm] of community) {
    let arr = clusterMembers.get(comm);
    if (!arr) {
      arr = [];
      clusterMembers.set(comm, arr);
    }
    arr.push(id);
  }

  for (const [clusterId, members] of clusterMembers) {
    if (members.length >= 3 || clusterId === largestClusterId) continue;

    const neighborWeights = new Map<number, number>();
    for (const memberId of members) {
      for (const [neighborId, weight] of adj.get(memberId)!) {
        const nc = community.get(neighborId)!;
        if (nc !== clusterId) {
          neighborWeights.set(nc, (neighborWeights.get(nc) ?? 0) + weight);
        }
      }
    }

    let targetCluster = largestClusterId;
    if (neighborWeights.size > 0) {
      let bestWeight = 0;
      for (const [nc, w] of neighborWeights) {
        if (w > bestWeight) {
          bestWeight = w;
          targetCluster = nc;
        }
      }
    }

    for (const memberId of members) {
      community.set(memberId, targetCluster);
    }
  }

  // Renumber to contiguous 0-based.
  const finalComms = [...new Set(community.values())];
  const renumber = new Map<number, number>();
  finalComms.forEach((c, i) => renumber.set(c, i));
  for (const [id, comm] of community) {
    community.set(id, renumber.get(comm)!);
  }

  return community;
}
