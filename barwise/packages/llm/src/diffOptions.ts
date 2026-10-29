import type { DiffOptions } from "@barwise/core/diff";

/**
 * How to diff two models extracted independently, whose ids are unrelated
 * by construction: pair nothing by id -- object types and fact types by name,
 * constraints by content -- so a coincidental id never pairs two different
 * elements (orm-format-3, Open decision 4 as revised; barwise-18n;
 * model-invariants workstream 2). Sample agreement's fold diffs independent samples;
 * `TranscriptProcessor` diffs an alternative framing, extracted beside the
 * primary rather than from it, against that primary.
 */
export const UNRELATED_IDS_DIFF = {
  matching: "content",
  // A recognized rename would pair two samples' differently named elements
  // and move the agreement metric; samples disagreeing on a name is what
  // the metric measures (iri-identity 6a).
  recognizeRenames: false,
} as const satisfies DiffOptions;
