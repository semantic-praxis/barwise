/**
 * Mapping a provider's stop reason to the one question callers ask.
 *
 * The risk worth testing hardest is the false positive: `truncated`
 * firing on a healthy response would make the eval runner exclude every
 * sample, and a suite that excludes everything reports a mean of 0 with
 * no obvious cause. Each provider's normal stop reasons are pinned by
 * name for that reason.
 */
import { describe, expect, it } from "vitest";
import { describeAnthropicStop, describeOpenAiStop } from "../../src/providers/stopReason.js";

describe("describeAnthropicStop", () => {
  it("marks the output ceiling as truncated", () => {
    expect(describeAnthropicStop("max_tokens")).toEqual({
      stopReason: "max_tokens",
      truncated: true,
    });
  });

  it("does not mark any healthy stop as truncated", () => {
    for (const reason of ["end_turn", "stop_sequence", "tool_use", "pause_turn"]) {
      expect(describeAnthropicStop(reason)).toEqual({ stopReason: reason, truncated: false });
    }
  });

  it("keeps a reason it has never seen, without judging it", () => {
    // Passed through rather than mapped: an unrecognized reason is
    // still the string the provider's own docs are written against.
    expect(describeAnthropicStop("refusal")).toEqual({
      stopReason: "refusal",
      truncated: false,
    });
  });
});

describe("describeOpenAiStop", () => {
  it("marks the output ceiling as truncated", () => {
    expect(describeOpenAiStop("length")).toEqual({ stopReason: "length", truncated: true });
  });

  it("does not mark any healthy stop as truncated", () => {
    for (const reason of ["stop", "tool_calls", "function_call", "content_filter"]) {
      expect(describeOpenAiStop(reason)).toEqual({ stopReason: reason, truncated: false });
    }
  });

  it("does not confuse the two providers' spellings", () => {
    // Anthropic's ceiling word is a normal stop for OpenAI's vocabulary
    // and vice versa; crossing them would silently invert the flag.
    expect(describeOpenAiStop("max_tokens").truncated).toBe(false);
    expect(describeAnthropicStop("length").truncated).toBe(false);
  });
});

describe("a provider that reported nothing", () => {
  it("says nothing, rather than claiming the response was whole", () => {
    // Absent must not become `truncated: false`. A caller excluding
    // truncated samples has to be able to tell "not truncated" from
    // "never said" -- Ollama backends differ in what they report.
    for (const describe_ of [describeAnthropicStop, describeOpenAiStop]) {
      expect(describe_(null)).toEqual({});
      expect(describe_(undefined)).toEqual({});
    }
  });
});
