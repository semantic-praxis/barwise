/**
 * The palette's DDL export writes what the registered `ddl` exporter
 * produces and reports what it could not express
 * (palette-ddl-export-routing.spec.md, barwise-wmm). Before, it wrote
 * `renderDdl(mapper.map(model))`: no UNIQUE or CHECK clauses, no spill
 * comments, and no report.
 *
 * `vscode` is mocked here rather than reusing `toolRegistration.test.ts`'s
 * mock, which covers only the language-model API.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  editorPath: "/work/ring.orm.yaml",
  editorText: "",
  written: undefined as string | undefined,
  channel: [] as string[],
  shown: false,
  warnings: [] as string[],
  infos: [] as string[],
  errors: [] as string[],
  warningChoice: undefined as string | undefined,
}));

vi.mock("vscode", () => ({
  window: {
    get activeTextEditor() {
      return {
        document: { uri: { fsPath: state.editorPath }, getText: () => state.editorText },
      };
    },
    showSaveDialog: async (options: { defaultUri: { fsPath: string; }; }) => options.defaultUri,
    showTextDocument: async () => undefined,
    showInformationMessage: async (message: string) => {
      state.infos.push(message);
    },
    showWarningMessage: async (message: string) => {
      state.warnings.push(message);
      return state.warningChoice;
    },
    showErrorMessage: async (message: string) => {
      state.errors.push(message);
    },
    createOutputChannel: () => ({
      appendLine: (line: string) => state.channel.push(line),
      show: () => {
        state.shown = true;
      },
    }),
  },
  workspace: {
    fs: {
      writeFile: async (_uri: unknown, bytes: Uint8Array) => {
        state.written = Buffer.from(bytes).toString("utf-8");
      },
    },
    openTextDocument: async () => ({}),
  },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));

const { ExportDdlCommand } = await import("../../src/commands/ExportDdlCommand.js");
const { buildTabPanels } = await import("../../src/diagram/tabPanels.js");

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

const uniqueEmail = [
  'orm_version: "1.0"',
  "model:",
  "  name: Shop",
  "  object_types:",
  "    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }",
  "    - { id: ot-email, name: Email, kind: value }",
  "  fact_types:",
  "    - id: ft-email",
  "      name: Customer has Email",
  "      roles:",
  "        - { id: r-c, player: ot-customer, role_name: has }",
  "        - { id: r-e, player: ot-email, role_name: is of }",
  '      readings: ["{0} has {1}"]',
  "      constraints:",
  "        - { type: internal_uniqueness, roles: [r-c] }",
  "        - { type: internal_uniqueness, roles: [r-e] }",
  "        - { type: mandatory, role: r-c }",
  "",
].join("\n");

async function run(text: string): Promise<void> {
  state.editorText = text;
  await new ExportDdlCommand().execute();
}

describe("Barwise: Export, As DDL", () => {
  beforeEach(() => {
    state.written = undefined;
    state.channel.length = 0;
    state.shown = false;
    state.warnings.length = 0;
    state.infos.length = 0;
    state.errors.length = 0;
    state.warningChoice = undefined;
  });

  it("writes the spill comment and reports the ring it could not express", async () => {
    await run(ring);
    expect(state.written).toContain("-- Constraint (not expressible in SQL DDL)");
    const report = state.channel.join("\n");
    expect(report).toContain("No Person is parent of that same Person.");
    // The warning is the report's heading, so the two state one count.
    expect(state.warnings).toEqual(["1 constraint(s) the ddl format could not express:"]);
    expect(report).toContain(state.warnings[0]);
    expect(state.infos).toEqual([]);
    expect(state.shown).toBe(false);
  });

  it("reveals the report when the user asks for it", async () => {
    state.warningChoice = "Show report";
    await run(ring);
    expect(state.shown).toBe(true);
  });

  it("writes the UNIQUE clause for a secondary unique value", async () => {
    await run(uniqueEmail);
    expect(state.written).toContain("UNIQUE (email)");
    expect(state.warnings).toEqual([]);
    expect(state.infos).toEqual(["Exported DDL to ring.sql"]);
  });

  it("writes what the diagram's DDL tab shows for the same model", async () => {
    // Both come from exportDdl; pinned against a future second copy.
    await run(ring);
    const model = new OrmYamlSerializer().deserialize(ring);
    expect(state.written).toBe(buildTabPanels(model).ddl);
  });

  it("refuses with a parse error and writes nothing", async () => {
    await run("model: [");
    expect(state.written).toBeUndefined();
    expect(state.errors[0]).toMatch(/^Failed to parse Barwise model:/);
  });
});
