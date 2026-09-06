/**
 * Tests for variant resolution: declared-match-only semantics, the
 * specificity order (modelPrefix outweighs provider), undefined on no
 * match, and the ambiguity error on equal-specificity ties.
 */
import { describe, expect, it } from "vitest";
import type { PromptArtifact } from "../../../src/prompt/artifacts/PromptArtifact.js";
import { resolveArtifact } from "../../../src/prompt/artifacts/resolveArtifact.js";

function artifact(
  overrides: Partial<PromptArtifact> & Pick<PromptArtifact, "version">,
): PromptArtifact {
  return {
    surface: "extraction",
    instructions: `instructions ${overrides.version}`,
    demos: [],
    ...overrides,
  };
}

const providerOnly = artifact({ version: "provider-only", match: { provider: "anthropic" } });
const prefixOnly = artifact({ version: "prefix-only", match: { modelPrefix: "claude-" } });
const both = artifact({
  version: "both",
  match: { provider: "anthropic", modelPrefix: "claude-sonnet" },
});
const reviewVariant = artifact({
  version: "review",
  surface: "review",
  match: { provider: "anthropic" },
});
const noMatchBlock = artifact({ version: "default-like" });

describe("resolveArtifact", () => {
  it("returns undefined when no variant applies", () => {
    expect(
      resolveArtifact([providerOnly], { surface: "extraction", provider: "openai" }),
    ).toBeUndefined();
    expect(resolveArtifact([], { surface: "extraction" })).toBeUndefined();
  });

  it("ignores artifacts without a match block and other surfaces", () => {
    expect(
      resolveArtifact([noMatchBlock, reviewVariant], {
        surface: "extraction",
        provider: "anthropic",
      }),
    ).toBeUndefined();
  });

  it("matches on provider", () => {
    expect(
      resolveArtifact([providerOnly], { surface: "extraction", provider: "anthropic" }),
    ).toBe(providerOnly);
  });

  it("matches on model prefix without a provider", () => {
    expect(
      resolveArtifact([prefixOnly], { surface: "extraction", model: "claude-opus-5" }),
    ).toBe(prefixOnly);
  });

  it("requires every declared match field to hold", () => {
    expect(
      resolveArtifact([both], { surface: "extraction", provider: "anthropic" }),
    ).toBeUndefined();
    expect(
      resolveArtifact([both], {
        surface: "extraction",
        provider: "anthropic",
        model: "claude-sonnet-5",
      }),
    ).toBe(both);
  });

  it("prefers the most specific applicable variant", () => {
    const resolved = resolveArtifact([providerOnly, prefixOnly, both], {
      surface: "extraction",
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(resolved).toBe(both);
  });

  it("ranks a longer modelPrefix above a shorter one that also matches (barwise-854)", () => {
    // The shape an operator hits first when testing a per-release
    // variant against the shipped per-family one. A longer prefix that
    // still matches is strictly more specific; refusing the pair as
    // ambiguous told them to narrow the match block they had just
    // narrowed.
    const family = artifact({
      version: "family",
      match: { provider: "anthropic", modelPrefix: "claude-haiku" },
    });
    const release = artifact({
      version: "release",
      match: { provider: "anthropic", modelPrefix: "claude-haiku-4-5-2026" },
    });
    const resolved = resolveArtifact([family, release], {
      surface: "extraction",
      provider: "anthropic",
      model: "claude-haiku-4-5-20261001",
    });
    expect(resolved).toBe(release);
    // Outside the release, the family variant is the only match.
    expect(
      resolveArtifact([family, release], {
        surface: "extraction",
        provider: "anthropic",
        model: "claude-haiku-4-5-20250101",
      }),
    ).toBe(family);
  });

  it("throws on an equal-specificity tie", () => {
    const rival = artifact({ version: "rival", match: { provider: "anthropic" } });
    expect(() =>
      resolveArtifact([providerOnly, rival], {
        surface: "extraction",
        provider: "anthropic",
      })
    ).toThrow(/Ambiguous prompt artifacts/);
  });
});
