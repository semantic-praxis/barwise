/**
 * Tests for the WS-C surfacing helper: rendering candidate framings (with
 * their diff against the primary) as a trailing section.
 */
import { OrmModel } from "@barwise/core";
import { diffModels } from "@barwise/core/diff";
import type { CandidateFraming } from "@barwise/llm";
import { describe, expect, it } from "vitest";
import { formatAlternativeFramings } from "../../src/tools/import.js";

function sampleFraming(): CandidateFraming {
  const primary = new OrmModel({ name: "Primary" });
  primary.addObjectType({ name: "Customer", kind: "entity", referenceMode: "customer_id" });

  const alt = new OrmModel({ name: "Alt" });
  alt.addObjectType({ name: "Customer", kind: "entity", referenceMode: "customer_id" });
  alt.addObjectType({ name: "Email", kind: "value" });

  return {
    rationale: "Models Email as the identifier",
    ambiguityDescription: "Email might also be unique",
    model: alt,
    diff: diffModels(primary, alt),
  };
}

describe("formatAlternativeFramings (MCP)", () => {
  it("returns empty for no alternatives", () => {
    expect(formatAlternativeFramings(undefined)).toBe("");
    expect(formatAlternativeFramings([])).toBe("");
  });

  it("renders the rationale, the fork, and a diff summary", () => {
    const out = formatAlternativeFramings([sampleFraming()]);
    expect(out).toContain("Alternative framings");
    expect(out).toContain("Models Email as the identifier");
    expect(out).toContain("Resolves: Email might also be unique");
    expect(out).toContain("added");
    expect(out).toContain("Email");
  });
});
