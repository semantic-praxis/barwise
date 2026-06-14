/**
 * Visual constants for ORM diagram rendering.
 *
 * All measurements are in SVG user units (effectively pixels at 1:1 zoom).
 */

// -- Role boxes (within fact type bars) --
export const ROLE_BOX_WIDTH = 36;
export const ROLE_BOX_HEIGHT = 28;

// -- Object type nodes --
export const OT_MIN_WIDTH = 90;
export const OT_HEIGHT = 40;
export const OT_CORNER_RADIUS = 6;
/** Extra height added to an object type node when aliases are present. */
export const OT_ALIAS_LINE_HEIGHT = 14;

// -- Fonts --
export const FONT_FAMILY = "'Segoe UI', system-ui, sans-serif";
export const FONT_SIZE_LABEL = 13;
export const FONT_SIZE_REF_MODE = 10;
export const FONT_SIZE_ALIAS = 9;
export const FONT_SIZE_ROLE = 9;

// -- Colors --
export const COLOR_ENTITY_FILL = "#e8f4fd";
export const COLOR_ENTITY_STROKE = "#3a86c8";
export const COLOR_VALUE_FILL = "#f3e8fd";
export const COLOR_VALUE_STROKE = "#8a3ac8";
export const COLOR_ROLE_FILL = "#ffffff";
export const COLOR_ROLE_STROKE = "#333333";
export const COLOR_UNIQUENESS = "#3a86c8";
export const COLOR_MANDATORY = "#333333";
export const COLOR_EDGE = "#666666";
export const COLOR_TEXT = "#1a1a1a";
export const COLOR_REF_MODE = "#666666";
export const COLOR_ALIAS = "#666666";
export const COLOR_SPANNING = "#e8703a";

// -- Constraint markers --
export const UNIQUENESS_BAR_HEIGHT = 3;
export const UNIQUENESS_BAR_OFFSET = 4;
export const MANDATORY_DOT_RADIUS = 4;

// -- Subtype arrows --
export const COLOR_SUBTYPE = "#3a86c8";
export const SUBTYPE_ARROW_SIZE = 8;
export const SUBTYPE_STROKE_WIDTH = 1.5;

// -- External constraint symbols --
export const CONSTRAINT_RADIUS = 10;
export const COLOR_CONSTRAINT_FILL = "#ffffff";
export const COLOR_CONSTRAINT_STROKE = "#8a3ac8";
export const CONSTRAINT_STROKE_WIDTH = 1.5;
export const CONSTRAINT_EDGE_DASH = "4,3";

// -- Objectified fact types --
export const OBJECTIFICATION_PADDING = 6;
export const OBJECTIFICATION_CORNER_RADIUS = 8;
export const COLOR_OBJECTIFICATION_FILL = "#e8f4fd";
export const COLOR_OBJECTIFICATION_STROKE = "#3a86c8";
export const OBJECTIFICATION_STROKE_WIDTH = 1.5;

// -- Frequency and ring labels --
export const FONT_SIZE_ANNOTATION = 9;
export const COLOR_ANNOTATION = "#8a3ac8";

// -- Layout spacing --
/** Gap between stacked fact types between the same entity pair. */
export const FACT_TYPE_STACK_GAP = 8;
/** Gap between entity border and adjacent unary fact type. */
export const UNARY_STUB_LENGTH = 20;
/** Padding around fact type bounding box for collision detection. */
export const FACT_TYPE_COLLISION_PADDING = 4;

// -- Annotation markers --
export const COLOR_ANNOTATION_STROKE = "#d97706";
export const ANNOTATION_DASH = "4,3";
export const ANNOTATION_MARKER_RADIUS = 5;
export const COLOR_ANNOTATION_MARKER = "#d97706";

// -- Interactive selection (used by the @barwise/diagram-ui renderer) --
export const COLOR_SELECTION = "#0a84ff";
