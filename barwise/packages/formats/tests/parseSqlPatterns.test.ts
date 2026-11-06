/**
 * parseSqlPatterns is the one SQL path both importers take (the SQL
 * importer and @barwise/dbt), so its cascade is pinned here directly:
 * the sidecar's answer when it gives one, else the regex tier, and the
 * regex tier's source text normalized either way. The subprocess is
 * mocked, as in SqlglotBridge.mocked.test.ts, so every branch runs
 * whatever is installed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSqlFile } from "../src/sql/SqlCascadeParser.js";

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

/** Fresh modules, so the bridge's availability cache starts empty. */
async function freshCascade() {
  vi.resetModules();
  return import("../src/sql/parseSqlPatterns.js");
}

function codeArgOf(args: readonly string[]): string {
  const idx = args.indexOf("-c");
  return idx === -1 ? "" : (args[idx + 1] ?? "");
}

const SQL = "SELECT a FROM t WHERE status   IN ('x',  'y')";

describe("parseSqlPatterns", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("is the regex tier, unchanged, when the sidecar is absent", async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("uv: command not found");
    });
    const { parseSqlPatterns } = await freshCascade();

    const result = parseSqlPatterns(SQL, "q.sql", "ansi");

    expect(result).toEqual(parseSqlFile(SQL, "q.sql", "ansi"));
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.patterns.every((p) => p.parseLevel === "regex")).toBe(true);
  });

  it("is the sidecar's answer when the sidecar parses the file", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const code = codeArgOf(args);
      if (code === "import sqlglot") return "";
      if (code.includes("def mine(tree)")) {
        return JSON.stringify({
          statements: [{
            sql: SQL,
            startLine: 1,
            endLine: 1,
            patterns: [{
              kind: "where",
              sourceText: "status IN ('x', 'y')",
              tables: ["t"],
              columns: ["status"],
            }],
            errors: [],
          }],
        });
      }
      throw new Error(`unexpected invocation: ${code.slice(0, 40)}`);
    });
    const { parseSqlPatterns } = await freshCascade();

    const result = parseSqlPatterns(SQL, "q.sql", "postgres");

    expect(result.dialect).toBe("postgres");
    expect(result.patterns).toEqual([
      expect.objectContaining({ kind: "where", filePath: "q.sql", parseLevel: "sqlglot" }),
    ]);
  });

  it("normalizes the regex tier's text through the sidecar when the sidecar cannot parse the file", async () => {
    execFileSyncMock.mockImplementation(
      (_cmd: string, args: string[], opts?: { input?: string; }) => {
        const code = codeArgOf(args);
        if (code === "import sqlglot") return "";
        if (code.includes("texts = json.load(sys.stdin)")) {
          const texts = JSON.parse(opts!.input as string) as string[];
          return JSON.stringify(texts.map((t) => `normalized:${t}`));
        }
        return "not json";
      },
    );
    const { parseSqlPatterns } = await freshCascade();

    const result = parseSqlPatterns(SQL, "q.sql", "ansi");
    const raw = parseSqlFile(SQL, "q.sql", "ansi");

    expect(result.patterns.length).toBe(raw.patterns.length);
    expect(result.patterns.every((p) => p.parseLevel === "regex")).toBe(true);
    expect(result.patterns.every((p) => p.sourceText.startsWith("normalized:"))).toBe(true);
  });
});
