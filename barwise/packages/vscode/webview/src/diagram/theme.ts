/**
 * Visual constants for the React ORM diagram renderer.
 *
 * Mirrors `@barwise/diagram`'s `render/theme.ts`. The values are
 * duplicated rather than imported because importing the diagram package
 * at runtime would pull ELK and the whole layout engine into the webview
 * bundle. Keep this file in sync with the source of truth.
 */

// Object type nodes.
export const OT_CORNER_RADIUS = 6;

// Fonts.
export const FONT_SIZE_LABEL = 13;
export const FONT_SIZE_REF_MODE = 10;
export const FONT_SIZE_ALIAS = 9;
export const FONT_SIZE_ROLE = 9;
export const FONT_SIZE_ANNOTATION = 9;

// Colors.
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
export const COLOR_SUBTYPE = "#3a86c8";
export const COLOR_SELECTION = "#0a84ff";

// Constraint markers.
export const UNIQUENESS_BAR_HEIGHT = 3;
export const UNIQUENESS_BAR_OFFSET = 4;
export const MANDATORY_DOT_RADIUS = 4;

// Subtype arrows.
export const SUBTYPE_ARROW_SIZE = 8;
export const SUBTYPE_STROKE_WIDTH = 1.5;

// External constraint symbols.
export const CONSTRAINT_RADIUS = 10;
export const COLOR_CONSTRAINT_FILL = "#ffffff";
export const COLOR_CONSTRAINT_STROKE = "#8a3ac8";
export const CONSTRAINT_STROKE_WIDTH = 1.5;
export const CONSTRAINT_EDGE_DASH = "4,3";

// Objectified fact types.
export const OBJECTIFICATION_PADDING = 6;
export const OBJECTIFICATION_CORNER_RADIUS = 8;
export const COLOR_OBJECTIFICATION_FILL = "#e8f4fd";
export const COLOR_OBJECTIFICATION_STROKE = "#3a86c8";
export const OBJECTIFICATION_STROKE_WIDTH = 1.5;

// Annotation markers.
export const COLOR_ANNOTATION = "#8a3ac8";
export const COLOR_ANNOTATION_STROKE = "#d97706";
export const ANNOTATION_DASH = "4,3";
export const ANNOTATION_MARKER_RADIUS = 5;
export const COLOR_ANNOTATION_MARKER = "#d97706";
