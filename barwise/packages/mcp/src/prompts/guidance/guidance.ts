/**
 * Canonical modeling-workflow and context-hygiene guidance.
 *
 * This is the single source of truth. It is surfaced through every
 * channel that can carry it: the MCP prompts (analyze-domain,
 * review-model), the barwise-modeling Claude skill, and the @barwise
 * GitHub Copilot chat participant. Edit the guidance here only.
 */

/** How to drive the barwise ORM 2 modeling lifecycle. */
export const MODELING_WORKFLOW_GUIDANCE = `The barwise ORM 2 modeling workflow:
1. Capture: start from a business-domain transcript or an existing model.
2. Extract: use import_transcript to draft a model from a transcript, or
   import_model to convert DDL / OpenAPI / code into a draft model.
3. Validate: run validate_model and resolve structural errors.
4. Verbalize: run verbalize_model to check that fact-type readings and
   constraints sound natural to a domain expert.
5. Review: run review_model for semantic-quality suggestions (distinct
   from validation, which only checks structural rules).
6. Export: run export_model (ddl, openapi, ...) to produce downstream
   artifacts once the model is sound.

When analyzing a domain, identify entity types (things with identity),
value types (attributes), fact types (relationships between objects),
and constraints (uniqueness, mandatory, exclusion, ring, frequency,
subset, equality, and so on).`;

/** How to use the barwise tools without flooding the context window. */
export const CONTEXT_HYGIENE_GUIDANCE = `Context-efficient use of the barwise tools:
- For specific structural questions (what entities exist, which roles are
  mandatory, how two entities connect, model statistics), use query_model.
  It returns a precise, deterministic answer -- do not re-derive answers
  from a large describe_domain dump or guess from prior context.
- For an overview, use describe_domain. Its arrays are length-capped; if
  the result reports truncation, follow up with query_model for the full
  enumeration.
- verbalize_model defaults to full output; call it with mode='summary'
  first, or pass factType=<name> to focus on a single fact type.
- export_model and generate_diagram write large artifacts to a file and
  return the file path. Reference the path -- do not paste raw DDL,
  OpenAPI, or SVG into your reply. Pass outputPath to choose where
  export_model writes.
- When a tool result says output was written to a file, open that file
  with your Read tool only if you genuinely need the full content; the
  inline preview is usually enough.
- Avoid reading the orm-model:// resource for a non-trivial model -- it
  returns the entire model JSON, unbounded.`;
