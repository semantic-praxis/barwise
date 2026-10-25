/**
 * The palette's Avro and dbt exports write the files the registered
 * exporters produce (palette-file-export-routing.spec.md, barwise-b30).
 * Before, each command called its renderer itself: the Avro files had none
 * of the exporter's review notes, and the dbt layout was a fact only the
 * palette knew.
 *
 * `vscode` is mocked here as `exportDdlCommand.test.ts` does, plus the
 * folder picker and the directory calls these two commands make.
 */
import { getExporter, OrmYamlSerializer } from "@barwise/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  editorPath: "/work/school.orm.yaml",
  editorText: "",
  folder: "/out",
  hasProject: true,
  written: new Map<string, string>(),
  warnings: [] as string[],
  infos: [] as string[],
  errors: [] as string[],
}));

vi.mock("vscode", () => ({
  window: {
    get activeTextEditor() {
      return {
        document: { uri: { fsPath: state.editorPath }, getText: () => state.editorText },
      };
    },
    showOpenDialog: async () => [{ fsPath: state.folder }],
    showTextDocument: async () => undefined,
    showInformationMessage: async (message: string) => {
      state.infos.push(message);
    },
    showWarningMessage: async (message: string) => {
      state.warnings.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      state.errors.push(message);
    },
    createOutputChannel: () => ({ clear: () => {}, appendLine: () => {}, show: () => {} }),
  },
  workspace: {
    fs: {
      stat: async (uri: { fsPath: string; }) => {
        if (!state.hasProject) throw new Error(`no ${uri.fsPath}`);
        return {};
      },
      createDirectory: async () => undefined,
      writeFile: async (uri: { fsPath: string; }, bytes: Uint8Array) => {
        state.written.set(uri.fsPath, Buffer.from(bytes).toString("utf-8"));
      },
    },
    openTextDocument: async () => ({}),
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string; }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
    }),
  },
}));

const { ExportAvroCommand } = await import("../../src/commands/ExportAvroCommand.js");
const { ExportDbtCommand } = await import("../../src/commands/ExportDbtCommand.js");

// Two entities and a many-to-many fact type with a population: the
// associative table is the one a dbt seed would be written for.
const school = [
  'orm_version: "1.0"',
  "model:",
  "  name: School",
  "  object_types:",
  "    - { id: ot-student, name: Student, kind: entity, reference_mode: student_id }",
  "    - { id: ot-course, name: Course, kind: entity, reference_mode: course_id }",
  "  fact_types:",
  "    - id: ft-enrolls",
  "      name: Student enrolls in Course",
  "      roles:",
  "        - { id: r-s, player: ot-student, role_name: enrolls in }",
  "        - { id: r-c, player: ot-course, role_name: is enrolled by }",
  '      readings: ["{0} enrolls in {1}"]',
  "      constraints:",
  "        - { type: internal_uniqueness, roles: [r-s, r-c] }",
  "  populations:",
  "    - id: pop-enrolls",
  "      fact_type: ft-enrolls",
  "      instances:",
  "        - { id: i1, role_values: { r-s: S1, r-c: C1 } }",
  "",
].join("\n");

const model = () => new OrmYamlSerializer().deserialize(school);

async function run(command: { execute(): Promise<void>; }): Promise<void> {
  state.editorText = school;
  await command.execute();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function expectedFiles(format: string, options: Record<string, unknown>, root: string) {
  const files = getExporter(format)!.export(model(), options).files!;
  return new Map(files.map((f) => [`${root}/${f.name}`, f.content]));
}

beforeEach(() => {
  state.written.clear();
  state.warnings.length = 0;
  state.infos.length = 0;
  state.errors.length = 0;
  state.hasProject = true;
});

describe("Barwise: Export, As Avro Schemas", () => {
  it("makes a file name Avro rejects into a valid namespace, and says so (barwise-1c2)", async () => {
    state.editorPath = "/work/order-system.orm.yaml";
    try {
      await run(new ExportAvroCommand());
    } finally {
      state.editorPath = "/work/school.orm.yaml";
    }
    expect(state.errors).toEqual([]);
    expect(state.warnings).toEqual([
      `The file name gives the Avro namespace "com.order-system", which Avro's name rule rejects, `
      + `so the schemas use "com.order_system". A schema registry that accepted "com.order-system" `
      + "will treat these as new schemas.",
    ]);
    expect(state.written).toEqual(expectedFiles("avro", { namespace: "com.order_system" }, "/out"));
  });

  it("warns nothing for a file name that is already a valid namespace", async () => {
    await run(new ExportAvroCommand());
    expect(state.warnings).toEqual([]);
  });

  it("writes the avro exporter's files, review notes included", async () => {
    await run(new ExportAvroCommand());
    expect(state.written).toEqual(expectedFiles("avro", { namespace: "com.school" }, "/out"));
    expect([...state.written.values()].join("\n")).toMatch(/\[(TODO|NOTE)\(barwise\):/);
    // The exporter's review notes are counted in the message, as dbt's always were.
    const notes = getExporter("avro")!.export(model(), { namespace: "com.school" }).annotations!;
    const todos = notes.filter((a) => a.severity === "todo").length;
    expect(state.infos).toEqual([
      `Exported ${state.written.size} file(s) to out/ (${todos} TODO(s), ${
        notes.length - todos
      } NOTE(s) annotated)`,
    ]);
  });
});

describe("Barwise: Export, As dbt Project", () => {
  it("writes the dbt exporter's files under models/staging, and no seeds", async () => {
    await run(new ExportDbtCommand());
    expect(state.written).toEqual(
      expectedFiles("dbt", { modelsDir: "models/staging", includeExamples: false }, "/out"),
    );
    expect([...state.written.keys()].some((name) => name.includes("/seeds/"))).toBe(false);
    expect([...state.written.keys()]).toContain("/out/models/staging/schema.yml");
  });

  it("refuses a folder that is not a dbt project, writing nothing", async () => {
    state.hasProject = false;
    await run(new ExportDbtCommand());
    expect(state.written.size).toBe(0);
    expect(state.errors[0]).toMatch(/No dbt_project.yml/);
  });
});

describe("when the registered exporter refuses or reports", () => {
  // The helper is replaced, so each command's own wiring is what is checked.
  const spec = {
    verbalization: "No Person is parent of that same Person.",
    pseudocode: "",
    example: "",
  };

  async function withHelper(exportWith: () => unknown) {
    vi.resetModules();
    vi.doMock("../../src/export/registeredExport.js", async (actual) => ({
      ...(await actual<object>()),
      exportWith,
    }));
    const avro = await import("../../src/commands/ExportAvroCommand.js");
    const dbt = await import("../../src/commands/ExportDbtCommand.js");
    vi.doUnmock("../../src/export/registeredExport.js");
    return { avro: new avro.ExportAvroCommand(), dbt: new dbt.ExportDbtCommand() };
  }

  it("shows the refusal and writes no file", async () => {
    const commands = await withHelper(() => ({ ok: false, reason: "avro export failed: boom" }));
    await run(commands.avro);
    await run(commands.dbt);
    expect(state.written.size).toBe(0);
    expect(state.errors).toEqual(["avro export failed: boom", "avro export failed: boom"]);
  });

  it("warns with each format's report heading", async () => {
    const result = { text: "", files: [], constraintSpecs: [spec] };
    const commands = await withHelper(() => ({ ok: true, result }));
    await run(commands.avro);
    await run(commands.dbt);
    expect(state.warnings).toEqual([
      "Exported 0 file(s) to out/. 1 constraint(s) the avro format could not express.",
      "Exported 0 file(s) to out/. 1 constraint(s) the dbt format could not express.",
    ]);
  });
});
