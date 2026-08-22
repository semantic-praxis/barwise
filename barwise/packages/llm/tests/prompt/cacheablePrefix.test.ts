/**
 * The extraction prefix must stay big enough to cache.
 *
 * Prompt caching has a model-dependent minimum prefix length, and below
 * it nothing fails: `cache_creation_input_tokens` stays 0, the request
 * succeeds, and the only symptom is a bill. That silence is why this
 * file exists -- a prompt trimmed under the threshold would cost the
 * entire saving with no test failing and no error to search for.
 *
 * The minimum is not monotonic across model generations. Haiku 4.5 sits
 * at 4,096, the highest of any current model, and is the model the eval
 * suite runs against, so it sets the floor here
 * (docs/specs/prompt-caching.spec.md).
 */
import { describe, expect, it } from "vitest";
import { buildResponseSchema, buildSystemPrompt } from "../../src/ExtractionPrompt.js";

/**
 * Characters per token. A rule of thumb, not a tokenizer -- which is
 * the point: this is a tripwire against a large regression, not a
 * measurement. The real alternative, `client.messages.countTokens`,
 * needs a network call and an API key that no test here may have.
 */
const CHARS_PER_TOKEN = 4;

/** Haiku 4.5's minimum cacheable prefix, the highest currently in use. */
const HIGHEST_MINIMUM_TOKENS = 4096;

/**
 * The bytes a cache breakpoint on the last system block covers. The API
 * renders `tools` before `system`, so the schema counts: it reaches the
 * wire as the extraction tool's `input_schema`.
 */
function cacheablePrefixChars(): number {
  return buildSystemPrompt(false).length + JSON.stringify(buildResponseSchema(false)).length;
}

describe("the cacheable extraction prefix", () => {
  it("clears the highest current minimum with room to spare", () => {
    // Asserted with a margin rather than at the line, so that
    // disagreement between this estimate and the real tokenizer cannot
    // decide the outcome. At the time of writing the prefix is roughly
    // 5,700 tokens against a 4,096 floor.
    const tokens = cacheablePrefixChars() / CHARS_PER_TOKEN;
    expect(tokens).toBeGreaterThan(HIGHEST_MINIMUM_TOKENS * 1.2);
  });

  it("still clears it from the system prompt alone", () => {
    // The schema is the half most likely to shrink -- it is generated,
    // and a narrower model would shrink it. If the prompt alone carries
    // the prefix over the line, that change cannot silently disable
    // caching.
    const tokens = buildSystemPrompt(false).length / CHARS_PER_TOKEN;
    expect(tokens).toBeGreaterThan(HIGHEST_MINIMUM_TOKENS);
  });

  it("is stable across calls, which is what makes it cacheable at all", () => {
    // Caching is a prefix match on exact bytes. A date, a UUID, or a
    // non-deterministic serialization anywhere in here would produce a
    // unique prefix per request: every call would pay the write premium
    // and none would ever read. Rendering twice is the cheapest
    // possible check that nothing dynamic crept in.
    expect(buildSystemPrompt(false)).toBe(buildSystemPrompt(false));
    expect(JSON.stringify(buildResponseSchema(false)))
      .toBe(JSON.stringify(buildResponseSchema(false)));
  });
});
