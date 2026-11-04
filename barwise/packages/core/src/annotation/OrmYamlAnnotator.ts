/**
 * ORM YAML annotator for transcript import.
 *
 * Injects TODO and NOTE comments into .orm.yaml files based on the
 * provenance metadata from LLM transcript extraction. Comments are
 * placed after the `- name:` line of the relevant object type or
 * fact type, making ambiguities and low-confidence inferences visible
 * where the modeler works.
 *
 * Annotation sources (from extraction provenance):
 *   - Ambiguities -> TODO with "Ask: ..." phrasing
 *   - Skipped constraints (applied=false) -> TODO
 *   - Low-confidence constraints -> TODO (verify)
 *   - Medium-confidence constraints -> NOTE
 *   - Warnings -> NOTE (model-level)
 *
 * Structural gap detection (from the model itself):
 *   - Entity types without a preferred identifier -> TODO
 *   - Object types without a definition -> NOTE
 *
 * This operates at the text level to preserve YAML formatting and is
 * idempotent via stripBarwiseComments().
 */

import { isIdentified, preferredIdentifiers } from "../model/identification.js";
import type { OrmModel } from "../model/OrmModel.js";
import {
  type AnnotationSeverity,
  formatBarwiseComment,
  stripBarwiseComments,
  truncate,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Input types (structural, no dependency on @barwise/llm)
// ---------------------------------------------------------------------------

/**
 * A reference to a transcript location. Mirrors SourceReference from
 * @barwise/llm but defined here to avoid a package dependency.
 */
export interface TranscriptReference {
  readonly lines: readonly [number, number];
  readonly excerpt: string;
}

export interface ProvenanceAmbiguity {
  readonly description: string;
  readonly source_references: readonly TranscriptReference[];
}

export interface ProvenanceConstraint {
  readonly description: string;
  readonly confidence: "high" | "medium" | "low";
  readonly sourceReferences: readonly TranscriptReference[];
  readonly applied: boolean;
  readonly skipReason?: string;
}

export interface ProvenanceSubtype {
  readonly subtype: string;
  readonly supertype: string;
  readonly sourceReferences: readonly TranscriptReference[];
  readonly applied: boolean;
  readonly skipReason?: string;
}

/**
 * The provenance metadata needed for annotation. This is a structural
 * subset of DraftModelResult from @barwise/llm -- any object that has
 * these fields will satisfy the interface.
 */
export interface TranscriptProvenance {
  readonly model: OrmModel;
  readonly ambiguities: readonly ProvenanceAmbiguity[];
  readonly constraintProvenance: readonly ProvenanceConstraint[];
  readonly subtypeProvenance: readonly ProvenanceSubtype[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Internal annotation type
// ---------------------------------------------------------------------------

export interface OrmAnnotation {
  /** What kind of element this annotation targets. */
  readonly elementType: "object_type" | "fact_type" | "model";
  /** Name of the element (for matching to YAML position). Undefined for model-level. */
  readonly elementName?: string;
  readonly severity: AnnotationSeverity;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OrmAnnotationOptions {
  /** Include structural gap annotations (missing identifiers, definitions). Default: true. */
  readonly includeStructuralGaps?: boolean;
  /** Include medium-confidence constraint notes. Default: true. */
  readonly includeMediumConfidence?: boolean;
}

export interface OrmAnnotationResult {
  /** The annotated YAML string. */
  readonly yaml: string;
  /** Count of TODO annotations injected. */
  readonly todoCount: number;
  /** Count of NOTE annotations injected. */
  readonly noteCount: number;
}

/**
 * Annotate an ORM YAML string with TODO/NOTE comments based on
 * transcript extraction provenance and structural gap analysis.
 *
 * @param yamlContent - The serialized .orm.yaml content.
 * @param provenance - Extraction provenance (DraftModelResult or compatible).
 * @param options - Optional configuration.
 */
export function annotateOrmYaml(
  yamlContent: string,
  provenance: TranscriptProvenance,
  options: OrmAnnotationOptions = {},
): OrmAnnotationResult {
  const annotations = collectAnnotations(provenance, options);

  if (annotations.length === 0) {
    return {
      yaml: stripBarwiseComments(yamlContent),
      todoCount: 0,
      noteCount: 0,
    };
  }

  const cleanContent = stripBarwiseComments(yamlContent);

  // Index annotations by element type and name.
  const objectTypeAnnotations = new Map<string, OrmAnnotation[]>();
  const factTypeAnnotations = new Map<string, OrmAnnotation[]>();
  const modelAnnotations: OrmAnnotation[] = [];

  for (const a of annotations) {
    if (a.elementType === "model" || !a.elementName) {
      modelAnnotations.push(a);
    } else if (a.elementType === "object_type") {
      const existing = objectTypeAnnotations.get(a.elementName) ?? [];
      existing.push(a);
      objectTypeAnnotations.set(a.elementName, existing);
    } else {
      const existing = factTypeAnnotations.get(a.elementName) ?? [];
      existing.push(a);
      factTypeAnnotations.set(a.elementName, existing);
    }
  }

  const lines = cleanContent.split("\n");
  const result: string[] = [];

  // Track which section we're in (object_types or fact_types).
  let currentSection: "object_types" | "fact_types" | "other" = "other";
  let modelNameLineInjected = false;

  for (const line of lines) {
    result.push(line);

    // Detect the `model:` line or `  name:` directly under model for
    // injecting model-level annotations.
    if (!modelNameLineInjected && line.match(/^ {2}name:\s/)) {
      modelNameLineInjected = true;
      if (modelAnnotations.length > 0) {
        for (const a of modelAnnotations) {
          result.push(`  ${formatBarwiseComment(a.severity, a.message)}`);
        }
      }
      continue;
    }

    // Detect section headers.
    if (line.match(/^\s{2}object_types:/)) {
      currentSection = "object_types";
      continue;
    }
    if (line.match(/^\s{2}fact_types:/)) {
      currentSection = "fact_types";
      continue;
    }
    if (
      line.match(
        /^\s{2}(?:constraints|subtype_facts|definitions|objectified_fact_types|populations|diagrams):/,
      )
    ) {
      currentSection = "other";
      continue;
    }

    // Detect element-level `- name:` within object_types or fact_types.
    // ORM YAML uses 4-space indent for list items under these sections:
    //   object_types:
    //     - id: ...
    //       name: Foo     <-- this is what we match
    // The `- name:` line or bare `name:` line after `- id:`.
    if (currentSection === "object_types" || currentSection === "fact_types") {
      // Match `name:` at 6-space indent (continuation of a list item started with `- id:`).
      const nameMatch = line.match(/^(\s{6})name:\s*(.+)/);
      if (nameMatch) {
        const indent = nameMatch[1]!;
        const elementName = nameMatch[2]!.trim().replace(/^["']|["']$/g, "");
        const lookup = currentSection === "object_types"
          ? objectTypeAnnotations
          : factTypeAnnotations;
        const elementAnnotations = lookup.get(elementName);
        if (elementAnnotations) {
          for (const a of elementAnnotations) {
            result.push(`${indent}${formatBarwiseComment(a.severity, a.message)}`);
          }
        }
        continue;
      }

      // Also match `- name:` (combined id/name on same list item).
      const dashNameMatch = line.match(/^(\s{4})- name:\s*(.+)/);
      if (dashNameMatch) {
        const indent = dashNameMatch[1]! + "  ";
        const elementName = dashNameMatch[2]!.trim().replace(/^["']|["']$/g, "");
        const lookup = currentSection === "object_types"
          ? objectTypeAnnotations
          : factTypeAnnotations;
        const elementAnnotations = lookup.get(elementName);
        if (elementAnnotations) {
          for (const a of elementAnnotations) {
            result.push(`${indent}${formatBarwiseComment(a.severity, a.message)}`);
          }
        }
      }
    }
  }

  const todoCount = annotations.filter((a) => a.severity === "todo").length;
  const noteCount = annotations.filter((a) => a.severity === "note").length;

  return {
    yaml: result.join("\n"),
    todoCount,
    noteCount,
  };
}

// ---------------------------------------------------------------------------
// Annotation collection
// ---------------------------------------------------------------------------

/**
 * Walk the provenance metadata and model to produce a flat list of
 * annotations. Exported for testing.
 */
export function collectAnnotations(
  provenance: TranscriptProvenance,
  options: OrmAnnotationOptions = {},
): OrmAnnotation[] {
  const includeStructural = options.includeStructuralGaps ?? true;
  const includeMedium = options.includeMediumConfidence ?? true;
  const annotations: OrmAnnotation[] = [];
  const model = provenance.model;

  // --- Ambiguities ---
  for (const ambiguity of provenance.ambiguities) {
    const elementMatch = matchAmbiguityToElement(ambiguity, model);
    const lineRef = formatLineRef(ambiguity.source_references);
    annotations.push({
      elementType: elementMatch?.type ?? "model",
      elementName: elementMatch?.name,
      severity: "todo",
      message: `Ask: ${ambiguity.description}${lineRef}`,
    });
  }

  // --- Constraint provenance ---
  for (const cp of provenance.constraintProvenance) {
    const factTypeName = matchConstraintToFactType(cp.description, model);

    if (!cp.applied) {
      // Skipped constraint.
      const reason = cp.skipReason ? ` -- ${cp.skipReason}` : "";
      const lineRef = formatLineRef(cp.sourceReferences);
      annotations.push({
        elementType: factTypeName ? "fact_type" : "model",
        elementName: factTypeName,
        severity: "todo",
        message: `Skipped constraint: "${truncate(cp.description, 80)}"${reason}${lineRef}`,
      });
    } else if (cp.confidence === "low") {
      // Low confidence -- needs verification.
      const lineRef = formatLineRef(cp.sourceReferences);
      annotations.push({
        elementType: factTypeName ? "fact_type" : "model",
        elementName: factTypeName,
        severity: "todo",
        message: `Verify constraint: "${truncate(cp.description, 80)}" -- low confidence${lineRef}`,
      });
    } else if (cp.confidence === "medium" && includeMedium) {
      // Medium confidence -- informational note.
      const lineRef = formatLineRef(cp.sourceReferences);
      annotations.push({
        elementType: factTypeName ? "fact_type" : "model",
        elementName: factTypeName,
        severity: "note",
        message: `Applied with medium confidence: "${truncate(cp.description, 80)}"${lineRef}`,
      });
    }
    // High confidence + applied -> no annotation needed.
  }

  // --- Skipped subtypes ---
  for (const sp of provenance.subtypeProvenance) {
    if (!sp.applied) {
      const reason = sp.skipReason ? ` -- ${sp.skipReason}` : "";
      const lineRef = formatLineRef(sp.sourceReferences);
      annotations.push({
        elementType: "object_type",
        elementName: sp.subtype,
        severity: "todo",
        message: `Skipped subtype: ${sp.subtype} is a ${sp.supertype}${reason}${lineRef}`,
      });
    }
  }

  // --- Warnings ---
  for (const warning of provenance.warnings) {
    annotations.push({
      elementType: "model",
      severity: "note",
      message: warning,
    });
  }

  // --- Structural gaps ---
  if (includeStructural) {
    collectStructuralGaps(model, annotations);
  }

  return annotations;
}

// ---------------------------------------------------------------------------
// Structural gap detection
// ---------------------------------------------------------------------------

function collectStructuralGaps(
  model: OrmModel,
  annotations: OrmAnnotation[],
): void {
  const identifiers = preferredIdentifiers(model);
  for (const ot of model.objectTypes) {
    // Entity types with no identifier: a reference mode is only a naming
    // hint; a preferred uniqueness that identifies the entity, an
    // objectification or an identifying subtype formalizes one.
    if (ot.kind === "entity" && !isIdentified(model, ot.id, identifiers)) {
      annotations.push({
        elementType: "object_type",
        elementName: ot.name,
        severity: "todo",
        message: `Ask: How do you uniquely identify a ${ot.name}?`,
      });
    }

    // Object types missing a definition.
    if (!ot.definition) {
      annotations.push({
        elementType: "object_type",
        elementName: ot.name,
        severity: "note",
        message: `No definition captured for ${ot.name} -- consider adding one.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/**
 * Try to match an ambiguity to a specific model element by scanning
 * the description for object type or fact type names.
 */
function matchAmbiguityToElement(
  ambiguity: ProvenanceAmbiguity,
  model: OrmModel,
): { type: "object_type" | "fact_type"; name: string; } | undefined {
  const desc = ambiguity.description.toLowerCase();

  // Try fact types first (more specific names).
  for (const ft of model.factTypes) {
    if (desc.includes(ft.name.toLowerCase())) {
      return { type: "fact_type", name: ft.name };
    }
  }

  // Then object types.
  for (const ot of model.objectTypes) {
    if (desc.includes(ot.name.toLowerCase())) {
      return { type: "object_type", name: ot.name };
    }
  }

  return undefined;
}

/**
 * Try to match a constraint description to a fact type name.
 */
function matchConstraintToFactType(
  description: string,
  model: OrmModel,
): string | undefined {
  const desc = description.toLowerCase();
  for (const ft of model.factTypes) {
    if (desc.includes(ft.name.toLowerCase())) {
      return ft.name;
    }
  }
  return undefined;
}

/**
 * Format a transcript line reference for appending to an annotation message.
 */
function formatLineRef(refs: readonly TranscriptReference[]): string {
  if (refs.length === 0) return "";
  const first = refs[0]!;
  if (first.lines[0] === first.lines[1]) {
    return ` (line ${first.lines[0]})`;
  }
  return ` (lines ${first.lines[0]}-${first.lines[1]})`;
}
