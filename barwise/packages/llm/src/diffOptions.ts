import type { DiffOptions } from "@barwise/core/diff";

/**
 * How to diff two models extracted independently, whose ids are unrelated
 * by construction: pair constraints by content alone, so a coincidental id
 * never pairs two different constraints (orm-format-3, Open decision 4 as
 * revised; barwise-18n). Sample agreement's fold diffs independent samples;
 * `TranscriptProcessor` diffs an alternative framing, extracted beside the
 * primary rather than from it, against that primary.
 */
export const UNRELATED_IDS_DIFF = { constraintMatching: "content" } as const satisfies DiffOptions;
