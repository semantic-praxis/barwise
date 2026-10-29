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

import { ELEMENT_MATCHINGS } from "@barwise/core/diff";
import { DIFF_RENAME_KINDS } from "@barwise/mcp";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const state = vi.hoisted(() => ({
  registered: [] as string[],
  tools: new Map<string, { invoke: (options: { input: unknown; }, token: unknown) => unknown; }>(),
  mcpEnabled: true,
  documents: [] as { uri: { fsPath: string; }; isDirty: boolean; }[],
}));

vi.mock("vscode", () => ({
  lm: {
    registerTool: (
      name: string,
      tool: { invoke: (options: { input: unknown; }, token: unknown) => unknown; },
    ) => {
      state.registered.push(name);
      state.tools.set(name, tool);
      return { dispose: () => {} };
    },
  },
  // What `toToolResult` builds, so a registered tool can be invoked here.
  LanguageModelToolResult: class {
    constructor(readonly content: { value: string; }[]) {}
  },
  LanguageModelTextPart: class {
    constructor(readonly value: string) {}
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, _fallback?: unknown) => state.mcpEnabled }),
    get textDocuments() {
      return state.documents;
    },
  },
}));

const { registerLanguageModelTools } = await import("../../src/mcp/ToolRegistration.js");

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, "../../package.json"), "utf-8"),
) as { contributes?: { languageModelTools?: { name: string; modelDescription?: string; }[]; }; };

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
      "barwise_rename_element",
      "barwise_review_model",
      "barwise_split_model",
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

  it("tells the model that the merge tool writes a file-path base back", () => {
    // Deliberate on this surface (an editing tool) and absent from the CLI's
    // `barwise merge`; the declaration is the only place a model learns it
    // (barwise-xjf).
    const merge = (manifest.contributes?.languageModelTools ?? []).find(
      (t) => t.name === "barwise_merge_models",
    );
    expect(merge?.modelDescription).toMatch(/written back to disk/);
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

describe("barwise_diff_models passes matching through", () => {
  // From the retroactive review of #735: dropping `matching` at the
  // registration survived the whole vscode suite, and the manifest's enum
  // was an unchecked copy of the modes core defines.
  const a =
    'orm_version: "3.0"\nmodel:\n  name: S\n  object_types:\n    - { id: ot0, name: Dog, kind: value }\n    - { id: ot1, name: Cat, kind: value }\n';
  const b =
    'orm_version: "3.0"\nmodel:\n  name: S\n  object_types:\n    - { id: ot0, name: Cat, kind: value }\n    - { id: ot1, name: Dog, kind: value }\n';
  const changed = async (matching?: string) => {
    registerAll();
    const tool = state.tools.get("barwise_diff_models")!;
    const result = (await tool.invoke({ input: { base: a, incoming: b, matching } }, {})) as {
      content: { value: string; }[];
    };
    return JSON.parse(result.content[0]!.value).deltas.length as number;
  };

  it("reads a swap of coinciding ids as renames by default, and as nothing under content", async () => {
    expect(await changed()).toBe(2);
    expect(await changed("content")).toBe(0);
  });

  it("declares exactly the modes core defines", () => {
    const tool = (manifest.contributes?.languageModelTools ?? []).find(
      (t) => t.name === "barwise_diff_models",
    ) as { inputSchema?: { properties?: { matching?: { enum?: string[]; }; }; }; } | undefined;
    expect(tool?.inputSchema?.properties?.matching?.enum).toEqual([...ELEMENT_MATCHINGS]);
  });

  it("declares the renames shape the MCP tool takes", () => {
    // The manifest's JSON schema is a second copy of the MCP tool's zod
    // schema; this keeps the two agreeing (iri-identity 6a).
    const tool = (manifest.contributes?.languageModelTools ?? []).find(
      (t) => t.name === "barwise_diff_models",
    ) as { inputSchema?: { properties?: Record<string, unknown>; }; } | undefined;
    const renames = tool?.inputSchema?.properties?.renames as {
      items: {
        properties: Record<string, { enum?: string[]; minLength?: number; }>;
        required: string[];
      };
    };
    expect(renames.items.properties.kind!.enum).toEqual([...DIFF_RENAME_KINDS]);
    expect(renames.items.properties.from!.minLength).toBe(1);
    expect(renames.items.properties.to!.minLength).toBe(1);
    expect(renames.items.required.sort()).toEqual(["from", "kind", "to"]);
  });
});

describe("barwise_export_model carries the constraint report", () => {
  // The editor tool joins the MCP blocks into one text part, so the report
  // reaches the model only if that join keeps the second block (barwise-wc0).
  const ring = [
    'orm_version: "1.0"',
    "model:",
    "  name: Ring",
    "  object_types:",
    "    - { id: ot-person, name: Person, kind: entity, reference_mode: person_id }",
    "  fact_types:",
    "    - id: ft-parent",
    "      name: Person is parent of Person",
    "      roles:",
    "        - { id: r-parent, player: ot-person, role_name: is parent of }",
    "        - { id: r-child, player: ot-person, role_name: is child of }",
    '      readings: ["{0} is parent of {1}"]',
    "      constraints:",
    "        - { type: internal_uniqueness, roles: [r-parent, r-child] }",
    "        - { type: ring, role_1: r-parent, role_2: r-child, ring_type: irreflexive }",
    "",
  ].join("\n");

  it("barwise_generate_schema carries the same report (barwise-zk4)", async () => {
    registerAll();
    const tool = state.tools.get("barwise_generate_schema")!;
    const result = (await tool.invoke({ input: { source: ring, format: "ddl" } }, {})) as {
      content: { value: string; }[];
    };
    const text = result.content[0]!.value;
    const report = text.indexOf("1 constraint(s) the ddl format could not express:");
    expect(report).toBeGreaterThan(text.indexOf("CREATE TABLE person_is_parent_of_person"));
    expect(text.slice(report)).toContain("- No Person is parent of that same Person.");
  });

  it("puts the report after the artifact", async () => {
    registerAll();
    const tool = state.tools.get("barwise_export_model")!;
    const result = (await tool.invoke({ input: { source: ring, format: "ddl" } }, {})) as {
      content: { value: string; }[];
    };
    const text = result.content[0]!.value;
    const report = text.indexOf("1 constraint(s) the ddl format could not express:");
    expect(report).toBeGreaterThan(text.indexOf("CREATE TABLE person_is_parent_of_person"));
    expect(text.slice(report)).toContain("- No Person is parent of that same Person.");
  });
});

describe("barwise_rename_element", () => {
  const MODEL = 'orm_version: "3.0"\nmodel:\n  name: Shop\n  object_types:\n'
    + "    - { id: o, name: Order, kind: entity, reference_mode: order_nr }\n";

  async function rename(path: string, extra: Record<string, unknown> = {}) {
    registerAll();
    const result = await state.tools.get("barwise_rename_element")!.invoke(
      { input: { source: path, objectType: "Order", to: "Purchase", ...extra } },
      undefined,
    ) as { content: { value: string; }[]; };
    return JSON.parse(result.content[0]!.value);
  }

  it("refuses a model whose editor has unsaved changes, and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-vscode-rename-"));
    try {
      const path = join(dir, "shop.orm.yaml");
      writeFileSync(path, MODEL, "utf-8");
      state.documents = [{ uri: { fsPath: path }, isDirty: true }];
      expect((await rename(path)).error).toContain("has unsaved changes");
      expect(readFileSync(path, "utf-8")).toBe(MODEL);

      state.documents = [{ uri: { fsPath: path }, isDirty: false }];
      expect((await rename(path)).written).toBe(true);
      expect(readFileSync(path, "utf-8")).toContain("name: Purchase");
    } finally {
      state.documents = [];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses when the dirty editor names the file through a symlink", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-vscode-rename-"));
    try {
      const path = join(dir, "shop.orm.yaml");
      writeFileSync(path, MODEL, "utf-8");
      symlinkSync(path, join(dir, "link.orm.yaml"));
      state.documents = [{ uri: { fsPath: join(dir, "link.orm.yaml") }, isDirty: true }];
      expect((await rename(path)).error).toContain("has unsaved changes");
      expect(readFileSync(path, "utf-8")).toBe(MODEL);
    } finally {
      state.documents = [];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a project rename when a domain it would write is dirty, not only the manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-vscode-rename-"));
    try {
      mkdirSync(join(dir, "domains"));
      const domain = join(dir, "domains", "shop.orm.yaml");
      writeFileSync(domain, MODEL, "utf-8");
      const manifest = join(dir, "p.orm-project.yaml");
      writeFileSync(
        manifest,
        'format_version: "1.0"\nproject:\n  name: P\n  domains:\n'
          + '    - { path: "./domains/shop.orm.yaml", context: "shop" }\n',
        "utf-8",
      );
      state.documents = [{ uri: { fsPath: domain }, isDirty: true }];
      const refused = await rename(manifest, { domain: "shop" });
      expect(refused.error).toContain(`${domain} has unsaved changes`);
      expect(readFileSync(domain, "utf-8")).toBe(MODEL);

      // Under check nothing is written, so a dirty buffer is no reason to refuse.
      expect((await rename(manifest, { domain: "shop", check: true })).files).toEqual([domain]);
    } finally {
      state.documents = [];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
