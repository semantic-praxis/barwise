/**
 * The executable form of the capability matrix's VS Code column.
 *
 * `mcp/tests/serverSpawn.test.ts` pins the MCP tool list with `toEqual`
 * and says why in its own comment: with four names sampled, the suite
 * stayed green while `review_model` and `merge_models` were
 * unregistered. VS Code had no such pin -- the `assertion-audit` skill
 * records it as a known gap -- and the consequence arrived on schedule.
 * CLAUDE.md's capability matrix marked seven capabilities absent from
 * VS Code, each labelled "deliberate", while the extension registered
 * all seven (barwise-988). A reader deciding whether to wire `merge`
 * into the editor read "no -- deliberate: an editor wants a diff view"
 * and did not learn it already shipped.
 *
 * Two assertions, because there are two must-agree copies and neither
 * was checked:
 *
 *   1. The names registered here, complete and sorted. This is the
 *      matrix's column, and adding or removing a tool means updating
 *      both in one commit (assertion-audit rule 4).
 *   2. Those names against `contributes.languageModelTools` in
 *      package.json. `ToolRegistration.ts`'s own header says they "must
 *      match" -- and a comment is never the guard for a copy that must
 *      agree (CLAUDE.md, and `docs/specs/duplication-drift-guards.spec.md`).
 *
 * `vscode` is mocked at the boundary, as `ChatParticipant.test.ts` does,
 * so this exercises the real `registerLanguageModelTools` rather than
 * parsing the source for string literals. What a source scan cannot
 * tell you is whether a `register` call is reached at all -- and this
 * repo has form for built-but-never-called code (barwise-811).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording state, hoisted with the mock factory.
 *
 * `vi.mock` is hoisted above the imports, so its factory cannot close
 * over an ordinary `let` -- that is a temporal-dead-zone throw, not a
 * failing assertion. `vi.hoisted` is the seam: one object both the
 * factory and the tests hold, so `mcpEnabled` is a knob rather than a
 * second `vi.doMock` that the already-imported binding would ignore.
 */
const state = vi.hoisted(() => ({ registered: [] as string[], mcpEnabled: true }));

vi.mock("vscode", () => ({
  lm: {
    registerTool: (name: string) => {
      state.registered.push(name);
      return { dispose: () => {} };
    },
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, _fallback?: unknown) => state.mcpEnabled }),
  },
}));

const { registerLanguageModelTools } = await import("../../src/mcp/ToolRegistration.js");

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, "../../package.json"), "utf-8"),
) as { contributes?: { languageModelTools?: { name: string; }[]; }; };

function registerAll(): string[] {
  state.registered.length = 0;
  const context = { subscriptions: [] as { dispose: () => void; }[] };
  registerLanguageModelTools(context as never);
  return [...state.registered].sort();
}

describe("VS Code language-model tool registration", () => {
  beforeEach(() => {
    state.registered.length = 0;
    state.mcpEnabled = true;
  });

  it("registers exactly these tools", () => {
    // The complete list, not a sample. Changing it means changing the
    // capability matrix in CLAUDE.md in the same commit.
    expect(registerAll()).toEqual([
      "barwise_describe_domain",
      "barwise_diff_models",
      "barwise_export_model",
      "barwise_generate_diagram",
      "barwise_generate_schema",
      "barwise_impact_analysis",
      "barwise_import_model",
      "barwise_import_transcript",
      "barwise_lineage_status",
      "barwise_merge_models",
      "barwise_query_model",
      "barwise_review_model",
      "barwise_validate_model",
      "barwise_verbalize_model",
    ]);
  });

  it("registers exactly what package.json declares", () => {
    // The copy ToolRegistration.ts's header says "must match". A tool
    // declared and never registered is invisible to the editor; one
    // registered and never declared cannot be invoked by name.
    const declared = (manifest.contributes?.languageModelTools ?? []).map((t) => t.name).sort();
    expect(declared.length, "package.json declares no languageModelTools").toBeGreaterThan(0);
    expect(registerAll()).toEqual(declared);
  });

  it("registers nothing when the MCP server is disabled", () => {
    // The condition the other two run past: registration returns early
    // on `barwise.enableMcpServer`, so the matrix's VS Code column holds
    // at the default setting and not otherwise. Asserted so that
    // qualifier is visible in the suite rather than discovered later.
    state.mcpEnabled = false;
    expect(registerAll()).toEqual([]);
  });
});
