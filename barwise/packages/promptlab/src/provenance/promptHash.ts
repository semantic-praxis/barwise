/**
 * A fingerprint of the prompt that actually ran
 * (docs/specs/eval-run-resolution-and-provenance.spec.md, workstream 2).
 *
 * `artifactVersion` is an authored string a human maintains by hand.
 * Edit a variant's instructions without bumping its `version:` field and
 * two history rows claim the same artifact while having run different
 * prompts -- silently, since nothing checks. This hash is derived from
 * the bytes themselves, so it cannot make that mistake.
 *
 * Pure and deterministic, so it belongs here rather than in a caller:
 * same prompt, same hash, no clock and no I/O.
 */
import { createHash } from "node:crypto";

/**
 * Hex characters kept. Twelve is git's own comfortable abbreviation
 * length: short enough to sit in a JSONL row and a terminal line
 * without wrapping, far past the collision risk of a history file that
 * will hold hundreds of rows rather than billions.
 */
const HASH_LENGTH = 12;

/**
 * Fingerprint a rendered system prompt.
 *
 * Deliberately covers the system prompt alone, not the response schema
 * or the user message. The schema is derived from code and moves only
 * when the source does, which the recorded git commit already tracks;
 * the user message is per case and would give every case a different
 * hash, which is the opposite of what a run-level identifier is for.
 */
export function hashPrompt(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt, "utf8").digest("hex").slice(0, HASH_LENGTH);
}
