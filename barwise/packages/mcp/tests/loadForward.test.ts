/**
 * Load-forward across the MCP server (docs/adr/schema-versioning.md,
 * decision 4; docs/specs/adr-batch9-enforcers.spec.md, WS6).
 *
 * Decision 4 says an older file loads at the current version and a surface
 * writes it back only when it writes an edit. Each tool's own tests use
 * their own fixtures, so nothing held the tools as a set to it: a read-only
 * tool that began saving the model back would rewrite users' files with no
 * test failing.
 *
 * The tool list is what the server answers to `listTools`, not a copy. Every
 * registered tool must have a row in `ROWS`, a call on a copied 3.0 fixture
 * or a skip with its reason, so a tool added later fails `the table covers
 * exactly the registered tools` until someone declares what it does to a
 * 3.0 file.
 *
 * A call must succeed (no `isError`) and return text, then leave the file's
 * bytes alone. Success is judged first and is the point of the self-checks
 * below: a tool that refused the file would leave it untouched too, and
 * pass a bytes-only test.
 *
 * Reads only `src/` of this package, so turbo's cache for this test is
 * invalidated by any package it can import.
 *
 * Not covered: VS Code's open/save path (barwise-ym8.yfi stays open for
 * it), and 1.0 and 2.0 inputs, which core's tests and the tool tests hold.
 */
import { CURRENT_ORM_VERSION } from "@barwise/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/pets-3x.orm.yaml",
);

/** A second, non-conflicting 3.0 model, for the tools that take two. */
const SECOND_MODEL = `orm_version: "3.0"
model:
  name: Pets
  object_types:
    - { id: ot2, name: Fish, kind: entity, reference_mode: id }
`;

interface Files {
  /** The copied 3.0 fixture the tool is called on. */
  readonly file: string;
  /** A second 3.0 model in the same directory. */
  readonly other: string;
  /** An empty directory, for a tool that writes elsewhere. */
  readonly out: string;
}

type Row =
  | {
    readonly args: (f: Files) => Record<string, unknown>;
    /** Present only for a declared editing tool: why it rewrites its input. */
    readonly edits?: string;
    /**
     * Bring the fixture to the current version first, by calling
     * `merge_models` on it (the server has no `migrate`). `rename_element`
     * refuses a 3.0 file, so its edit can only be seen on a current one;
     * its refusal is tested separately.
     */
    readonly current?: boolean;
  }
  | { readonly skip: string; };

/**
 * What each tool does to a 3.0 file. `edits` is the declared editing set:
 * these rewrite the file they are given, by design, and the test requires
 * that they still do. Every other tool must leave the file alone.
 */
const ROWS: Record<string, Row> = {
  validate_model: { args: (f) => ({ source: f.file }) },
  verbalize_model: { args: (f) => ({ source: f.file }) },
  generate_schema: { args: (f) => ({ source: f.file }) },
  generate_diagram: { args: (f) => ({ source: f.file }) },
  diff_models: { args: (f) => ({ base: f.file, incoming: f.other }) },
  export_model: { args: (f) => ({ source: f.file, format: "ddl" }) },
  describe_domain: { args: (f) => ({ source: f.file }) },
  query_model: { args: (f) => ({ source: f.file, query: "stats" }) },
  lineage_status: { args: (f) => ({ source: f.file }) },
  impact_analysis: { args: (f) => ({ source: f.file, elementId: "ot0" }) },
  merge_models: {
    args: (f) => ({ base: f.file, incoming: f.other }),
    edits: "its purpose: writes the merged model back to the base file",
  },
  rename_element: {
    args: (f) => ({ source: f.file, objectType: "Dog", to: "Hound" }),
    edits: "its purpose: writes the renamed model back to the file",
    current: true,
  },
  // Listed in the spec as an editing tool, but it writes a new project
  // into outDir and never touches its source: the declared exception does
  // not apply, and the test holds the source's bytes like any other.
  split_model: {
    args: (f) => ({
      source: f.file,
      projectName: "Pets",
      domains: { dogs: ["Dog"], cats: ["Cat"] },
      outDir: f.out,
    }),
  },

  import_transcript: { skip: "calls an LLM provider and needs a model API key" },
  review_model: { skip: "calls an LLM provider and needs a model API key" },
  analyze_repository: {
    skip: "takes a repository path or GitHub slug and may clone over the network",
  },
  import_model: { skip: "reads a foreign format (DDL, OpenAPI, Ossie, ...), not an .orm.yaml" },
  gym_list: { skip: "reads the packaged exercise catalog; takes no model" },
  gym_check: {
    skip: "its result is the verdict on the candidate, and the only passing answer to an "
      + "exercise is a 4.0 reference file, so a 3.0 fixture would fail the check for the right reason",
  },
};

function reportsError(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && "error" in parsed;
  } catch {
    return false;
  }
}

/** What is wrong with one call on the fixture, as sentences. */
export function problemsWith(
  call: { isError: boolean; text: string; },
  before: string,
  after: string,
  edits: boolean,
): string[] {
  const out: string[] = [];
  // Some tools report a refusal as JSON with an `error` key and no
  // `isError` (rename_element does), so the flag alone would pass them.
  if (call.isError || reportsError(call.text)) {
    out.push(`returned an error: ${call.text.trim().slice(0, 160)}`);
  }
  if (call.text.trim() === "") out.push("returned no text");
  if (edits) {
    if (after === before) out.push("is declared as editing but left the file unchanged");
    else if (!after.startsWith(`orm_version: "${CURRENT_ORM_VERSION}"`)) {
      out.push(`wrote the file but not at version ${CURRENT_ORM_VERSION}`);
    }
  } else if (after !== before) out.push("rewrote the file but is not a declared editing tool");
  return out;
}

const dirs: string[] = [];
let client: Client;
let tools: string[];

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: "load-forward", version: "0" });
  await client.connect(clientSide);
  tools = (await client.listTools()).tools.map((t) => t.name);
});

afterAll(async () => {
  await client?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function stage(): Files {
  const dir = mkdtempSync(join(tmpdir(), "barwise-mcp-load-forward-"));
  dirs.push(dir);
  const file = join(dir, "pets.orm.yaml");
  const other = join(dir, "second.orm.yaml");
  copyFileSync(fixture, file);
  writeFileSync(other, SECOND_MODEL);
  return { file, other, out: join(dir, "out") };
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content ?? []) as Array<{ type: string; text?: string; }>;
  return {
    isError: result.isError === true,
    text: content.map((c) => c.text ?? "").join("\n"),
  };
}

describe("load-forward across the MCP server", () => {
  it("the fixture is a 3.0 file, older than the current version [adr:schema-versioning#load-forward]", () => {
    // Otherwise the rows below would test a current-version file, which
    // decision 4 says nothing about.
    expect(readFileSync(fixture, "utf8").startsWith('orm_version: "3.0"')).toBe(true);
    expect(CURRENT_ORM_VERSION).not.toBe("3.0");
  });

  it("the table covers exactly the registered tools [adr:schema-versioning#load-forward]", () => {
    expect(tools.length).toBeGreaterThan(15);
    const declared = Object.keys(ROWS);
    expect(tools.filter((t) => !declared.includes(t)), "tools with no row").toEqual([]);
    expect(declared.filter((t) => !tools.includes(t)), "rows for no tool").toEqual([]);
  });

  it(
    "every declared call succeeds on a 3.0 file and writes it only if declared as editing [adr:schema-versioning#load-forward]",
    async () => {
      const problems: string[] = [];
      let ran = 0;
      for (const name of tools) {
        const row = ROWS[name];
        if (row === undefined || "skip" in row) continue;
        const files = stage();
        if (row.current) {
          const made = await call("merge_models", { base: files.file, incoming: files.other });
          expect(made.isError).toBe(false);
          expect(readFileSync(files.file, "utf8")).toContain(
            `orm_version: "${CURRENT_ORM_VERSION}"`,
          );
        }
        const before = readFileSync(files.file, "utf8");
        const result = await call(name, row.args(files));
        ran++;
        const found = problemsWith(
          result,
          before,
          readFileSync(files.file, "utf8"),
          row.edits !== undefined,
        );
        problems.push(...found.map((p) => `${name} ${p}`));
      }
      expect(ran).toBeGreaterThan(10);
      expect(problems).toEqual([]);
    },
    120_000,
  );

  it("split_model writes its project to outDir and nowhere else [adr:schema-versioning#load-forward]", async () => {
    // The row above holds the source's bytes; this holds that the call
    // wrote something, so the row is not a preview that passes trivially.
    const files = stage();
    const row = ROWS["split_model"];
    if (row === undefined || "skip" in row) throw new Error("split_model has no call row");
    const result = await call("split_model", row.args(files));
    expect(problemsWith(result, "", "", false)).toEqual([]);
    expect(existsSync(join(files.out, "project.orm-project.yaml"))).toBe(true);
  });

  it("rename_element reports a refusal of the 3.0 file as an error, not a success [adr:schema-versioning#load-forward]", async () => {
    const files = stage();
    const before = readFileSync(files.file, "utf8");
    const result = await call("rename_element", {
      source: files.file,
      objectType: "Dog",
      to: "Hound",
    });
    expect(problemsWith(result, before, readFileSync(files.file, "utf8"), false)).toEqual([
      expect.stringContaining("returned an error"),
    ]);
    expect(result.text).toContain("migrate");
  });

  it("the checker refuses a tool that errors without touching the file [adr:schema-versioning#load-forward]", () => {
    // The stub stands for a tool that rejected the 3.0 file: bytes intact,
    // so only the success check can fail it.
    const refusing = { isError: true, text: "unsupported version" };
    expect(problemsWith(refusing, "same", "same", false)).not.toEqual([]);
  });

  it("the checker refuses a read-only tool that rewrites the file, and an editing one that does not [adr:schema-versioning#load-forward]", () => {
    const ok = { isError: false, text: "done" };
    expect(problemsWith(ok, "a", "b", false)).toEqual([
      "rewrote the file but is not a declared editing tool",
    ]);
    expect(problemsWith(ok, "a", "a", true)).toEqual([
      "is declared as editing but left the file unchanged",
    ]);
    expect(problemsWith(ok, "a", "a", false)).toEqual([]);
  });
});

describe("load-forward tools not called on a fixture", () => {
  // Listed as skipped, with the reason in the name, so a report shows
  // what was not exercised instead of passing it.
  for (const [name, row] of Object.entries(ROWS)) {
    if ("skip" in row) it.skip(`${name}: ${row.skip}`, () => {});
  }
});
