/**
 * Named placement parameters for the diagram layout.
 *
 * These are the aesthetic levers of the two-pass layout -- previously
 * inline magic numbers in `EntityPlacement.ts` and `PostAdjustments.ts`
 * (aesthetics spec, workstream 3). Tuning one is a one-line edit here,
 * made safe by two guards: the SVG golden files in
 * `@barwise/diagram-ui/tests/golden/` (exact, per-corpus-model) and the
 * layout metrics in `metrics.ts` (tolerance ranges that survive an ELK
 * version bump). Change a value only with the resulting golden diff and
 * metric deltas reviewed as intentional.
 */

/**
 * ELK stress desired edge length for the flat (single-community)
 * entity layout. Longer edges spread entities out, giving pass 2 room
 * to place fact-type boxes between them.
 */
export const FLAT_ENTITY_EDGE_LENGTH = 450;

/** Minimum entity separation in the flat entity layout. */
export const FLAT_ENTITY_NODE_SPACING = 300;

/**
 * Desired edge length between cluster bounding boxes in the macro
 * layout (clustered models lay out each community separately, then
 * place the communities). Larger than the flat length because the
 * nodes here are whole clusters.
 */
export const INTER_CLUSTER_EDGE_LENGTH = 600;

/** Minimum separation between cluster bounding boxes. */
export const INTER_CLUSTER_NODE_SPACING = 250;

/**
 * Desired edge length inside one cluster's sub-layout. Shorter than
 * the flat length so a community reads as a visually tight group.
 */
export const INTRA_CLUSTER_EDGE_LENGTH = 350;

/** Minimum entity separation inside one cluster's sub-layout. */
export const INTRA_CLUSTER_NODE_SPACING = 200;

/**
 * ELK stress iteration cap, shared by all three stress runs: enough to
 * converge on models of this size while bounding layout time.
 */
export const STRESS_ITERATION_LIMIT = 300;

/**
 * How far a boundary entity (one with edges into a neighboring
 * cluster) is nudged toward that cluster's centroid, shortening
 * inter-cluster edges without breaking up the cluster shape.
 */
export const NUDGE_DISTANCE = 40;

/** Distance from a supertype's center to its fanned subtype centers. */
export const SUBTYPE_ARC_RADIUS = 180;

/** Angular spread of the subtype fan (radians): 135 degrees. */
export const SUBTYPE_ARC_ANGLE_RANGE = Math.PI * 0.75;

/** Distance from a hub entity's center to its leaf value-type centers. */
export const LEAF_SPOKE_DISTANCE = 200;
