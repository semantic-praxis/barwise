/**
 * Tests for the WS-C surfacing helper: rendering candidate framings (with
 * their diff against the primary) for the `import transcript` command.
 */
import { OrmModel } from "@barwise/core";
import { diffModels } from "@barwise/core/diff";
import type { ModelDelta, ModelDiffResult } from "@barwise/core/diff";
import type { CandidateFraming } from "@barwise/llm";
import { describe, expect, it } from "vitest";
import { formatAlternativeFramings } from "../../src/commands/import.js";

function framingWithDiff(diff: ModelDiffResult): CandidateFraming {
  const primary = new OrmModel({ name: "Primary" });
  return {
    rationale: "Handcrafted diff for delta-kind coverage",
    ambiguityDescription: "n/a",
    model: primary,
    diff,
  };
}

function objectTypeDelta(kind: ModelDelta["kind"], name: string): ModelDelta {
  return {
    kind,
    elementType: "object_type",
    name,
    changeDescriptions: [],
    breakingLevel: "safe",
  };
}

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

describe("formatAlternativeFramings (CLI)", () => {
  it("returns empty for no alternatives", () => {
    expect(formatAlternativeFramings(undefined)).toBe("");
    expect(formatAlternativeFramings([])).toBe("");
  });

  it("renders the rationale, the fork, and a diff summary", () => {
    const out = formatAlternativeFramings([sampleFraming()]);
    expect(out).toContain("Alternative framings:");
    expect(out).toContain("Models Email as the identifier");
    expect(out).toContain("Resolves: Email might also be unique");
    expect(out).toContain("added");
    expect(out).toContain("Email");
  });

  it("counts removed and modified deltas separately from added", () => {
    const diff: ModelDiffResult = {
      hasChanges: true,
      synonymCandidates: [],
      deltas: [
        objectTypeDelta("removed", "Legacy"),
        objectTypeDelta("modified", "Customer"),
        objectTypeDelta("unchanged", "Untouched"),
      ],
    };
    const out = formatAlternativeFramings([framingWithDiff(diff)]);
    expect(out).toContain("0 added, 1 modified, 1 removed");
    expect(out).toContain("(Customer)");
  });

  it("truncates the changed-name list past six entries", () => {
    const deltas: ModelDelta[] = Array.from(
      { length: 8 },
      (_, i) => objectTypeDelta("added", `Entity${i}`),
    );
    const diff: ModelDiffResult = { hasChanges: true, synonymCandidates: [], deltas };
    const out = formatAlternativeFramings([framingWithDiff(diff)]);
    expect(out).toContain("8 added, 0 modified, 0 removed");
    expect(out).toContain("Entity0, Entity1, Entity2, Entity3, Entity4, Entity5, ...");
  });

  it("labels a definition delta by its term, not a 'name' field", () => {
    const diff: ModelDiffResult = {
      hasChanges: true,
      synonymCandidates: [],
      deltas: [
        {
          kind: "added",
          elementType: "definition",
          term: "Customer",
          changeDescriptions: [],
          breakingLevel: "safe",
        },
      ],
    };
    const out = formatAlternativeFramings([framingWithDiff(diff)]);
    expect(out).toContain("1 added, 0 modified, 0 removed (Customer)");
  });

  it("omits the parenthetical name list when nothing was added or modified", () => {
    const diff: ModelDiffResult = {
      hasChanges: true,
      synonymCandidates: [],
      deltas: [objectTypeDelta("removed", "Legacy")],
    };
    const out = formatAlternativeFramings([framingWithDiff(diff)]);
    expect(out).toContain("0 added, 0 modified, 1 removed");
    expect(out).not.toMatch(/removed\(/);
  });
});
