/**
 * Deterministic tests for the sqlglot sidecar's subprocess boundary.
 *
 * SqlglotBridge.test.ts exercises the real `uv` + sqlglot on PATH when
 * present (it.runIf(available)) and is a legitimate skip otherwise --
 * the sidecar is optional by design. But that leaves every success-path
 * branch (a clean availability probe, a parsed sidecar response, a
 * normalized response) covered only when the ambient environment
 * happens to have uv+sqlglot ready within the probe's timeout, which is
 * exactly what produced a real, reproducible gap: `sqlglotAvailable()`
 * caches its result for the life of the process behind a single
 * `execFileSync` call with a fixed 10s timeout (SqlglotBridge.ts), and
 * a full monorepo `turbo run test:coverage` competes for CPU with 11
 * other packages' builds/tests -- enough contention pushes that probe
 * past 10s, `sqlglotAvailable()` caches `false`, and seven functions in
 * this file (the sidecar's parse/normalize/rewrite paths) go uncovered
 * for the rest of the process. That is precisely the 89.39% (warm,
 * idle machine) vs. 84.09% (contended, full-monorepo run) function
 * coverage split this file exists to close: every branch here runs the
 * same way regardless of machine load or what is installed on PATH.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

/** Re-import the module fresh so its `availability` cache starts empty. */
async function freshBridge() {
  vi.resetModules();
  return import("../../src/sql/SqlglotBridge.js");
}

/** The `-c <code>` argument of an execFileSync(uv, argv, ...) invocation. */
function codeArgOf(args: readonly string[]): string {
  const idx = args.indexOf("-c");
  return idx === -1 ? "" : (args[idx + 1] ?? "");
}

describe("SqlglotBridge subprocess boundary (mocked)", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("reports unavailable and short-circuits parse/normalize when the probe fails (timeout or missing uv)", async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("uv: command not found");
    });
    const { sqlglotAvailable, parseSqlWithSqlglot, normalizeSqlTexts } = await freshBridge();

    expect(sqlglotAvailable()).toBe(false);
    expect(parseSqlWithSqlglot("SELECT 1", "a.sql")).toBeUndefined();
    expect(normalizeSqlTexts(["SELECT 1"])).toBeUndefined();
    // The probe ran once; parse/normalize short-circuited on the cached
    // result instead of shelling out again.
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("parses sidecar output into patterns when the probe and sidecar both succeed", async () => {
    const sidecarOutput = JSON.stringify({
      statements: [
        {
          sql: "SELECT 1 WHERE a = 1",
          startLine: 1,
          endLine: 1,
          patterns: [
            { kind: "where", sourceText: "a = 1", tables: [], columns: ["a"] },
          ],
          errors: [],
        },
      ],
    });
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const code = codeArgOf(args);
      if (code === "import sqlglot") return "";
      if (code.includes("def mine(tree)")) return sidecarOutput;
      throw new Error(`unexpected invocation: ${code.slice(0, 40)}`);
    });

    const { parseSqlWithSqlglot } = await freshBridge();
    const result = parseSqlWithSqlglot("SELECT 1 WHERE a = 1", "models/x.sql", "postgres");

    expect(result).toBeDefined();
    expect(result!.dialect).toBe("postgres");
    expect(result!.statements).toHaveLength(1);
    expect(result!.patterns).toEqual([
      expect.objectContaining({
        kind: "where",
        filePath: "models/x.sql",
        columns: ["a"],
        parseLevel: "sqlglot",
      }),
    ]);
  });

  it("returns undefined when the sidecar output is not valid JSON", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const code = codeArgOf(args);
      if (code === "import sqlglot") return "";
      return "not json";
    });
    const { parseSqlWithSqlglot } = await freshBridge();

    expect(parseSqlWithSqlglot("SELECT 1", "a.sql")).toBeUndefined();
  });

  it("returns undefined when the sidecar reports a parse error with no statements", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const code = codeArgOf(args);
      if (code === "import sqlglot") return "";
      return JSON.stringify({ error: "syntax error" });
    });
    const { parseSqlWithSqlglot } = await freshBridge();

    expect(parseSqlWithSqlglot("NOT (((SQL", "a.sql")).toBeUndefined();
  });

  it("normalizes texts through the sidecar generator, falling back per-entry on an empty result", async () => {
    execFileSyncMock.mockImplementation(
      (_cmd: string, args: string[], opts?: { input?: string; }) => {
        const code = codeArgOf(args);
        if (code === "import sqlglot") return "";
        if (code.includes("texts = json.load(sys.stdin)")) {
          const texts = JSON.parse(opts!.input as string) as string[];
          // Simulate sqlglot canonicalizing the first snippet and failing
          // to render the second (e.g. a bare clause fragment).
          return JSON.stringify([texts[0]!.trim().toUpperCase(), ""]);
        }
        throw new Error(`unexpected invocation: ${code.slice(0, 40)}`);
      },
    );

    const { normalizeSqlTexts } = await freshBridge();
    const result = normalizeSqlTexts(["select 1", "FOREIGN KEY (a) REFERENCES b (c)"]);

    expect(result).toEqual(["SELECT 1", "FOREIGN KEY (a) REFERENCES b (c)"]);
  });

  it("returns undefined when the normalize sidecar's output length mismatches the input", async () => {
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const code = codeArgOf(args);
      if (code === "import sqlglot") return "";
      return JSON.stringify(["only one"]);
    });
    const { normalizeSqlTexts } = await freshBridge();

    expect(normalizeSqlTexts(["a", "b"])).toBeUndefined();
  });

  it("normalizeCascadeResult rewrites every pattern's sourceText via the sidecar", async () => {
    execFileSyncMock.mockImplementation(
      (_cmd: string, args: string[], opts?: { input?: string; }) => {
        const code = codeArgOf(args);
        if (code === "import sqlglot") return "";
        if (code.includes("texts = json.load(sys.stdin)")) {
          const texts = JSON.parse(opts!.input as string) as string[];
          return JSON.stringify(texts.map((t) => t.toUpperCase()));
        }
        throw new Error(`unexpected invocation: ${code.slice(0, 40)}`);
      },
    );

    const { normalizeCascadeResult } = await freshBridge();
    const raw = {
      filePath: "models/t.sql",
      dialect: "ansi" as const,
      statements: [
        {
          sql: "select * from t where status in ('a','b')",
          parseLevel: "regex" as const,
          patterns: [
            {
              kind: "where" as const,
              filePath: "models/t.sql",
              startLine: 1,
              endLine: 1,
              sourceText: "status in ('a','b')",
              tables: [],
              columns: ["status"],
              parseLevel: "regex" as const,
            },
          ],
          errors: [],
        },
      ],
      patterns: [] as unknown[],
    };
    raw.patterns = raw.statements.flatMap((s) => s.patterns);

    const normalized = normalizeCascadeResult(
      raw as Parameters<typeof normalizeCascadeResult>[0],
    );

    expect(normalized.statements[0]!.patterns[0]!.sourceText).toBe("STATUS IN ('A','B')");
    expect(normalized.patterns[0]!.sourceText).toBe("STATUS IN ('A','B')");
    expect(normalized.patterns).toHaveLength(raw.patterns.length);
  });

  it("normalizeCascadeResult returns the input unchanged when the sidecar is unavailable", async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("uv: command not found");
    });
    const { normalizeCascadeResult } = await freshBridge();
    const raw = {
      filePath: "models/t.sql",
      dialect: "ansi" as const,
      statements: [
        {
          sql: "select 1 where a = 1",
          parseLevel: "regex" as const,
          patterns: [
            {
              kind: "where" as const,
              filePath: "models/t.sql",
              startLine: 1,
              endLine: 1,
              sourceText: "a = 1",
              tables: [],
              columns: ["a"],
              parseLevel: "regex" as const,
            },
          ],
          errors: [],
        },
      ],
      patterns: [] as unknown[],
    };
    raw.patterns = raw.statements.flatMap((s) => s.patterns);

    expect(normalizeCascadeResult(raw as Parameters<typeof normalizeCascadeResult>[0])).toBe(raw);
  });
});
