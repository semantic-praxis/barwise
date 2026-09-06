/**
 * Tests for the output-bounding helper.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundedTextResult, INLINE_BYTE_LIMIT } from "../../src/workspace/response.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "barwise-response-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function spillPathFrom(text: string): string {
  const m = text.match(/Full content written to: (.+)/);
  if (!m) throw new Error(`no spill path in result:\n${text}`);
  return m[1]!.trim();
}

describe("boundedTextResult", () => {
  it("exposes a sane default inline limit", () => {
    expect(INLINE_BYTE_LIMIT).toBeGreaterThan(0);
  });

  it("returns text inline and verbatim when under the limit", () => {
    const result = boundedTextResult("a small payload", { kind: "test" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toBe("a small payload");
  });

  it("returns text inline when exactly at the limit", () => {
    const text = "x".repeat(100);
    const result = boundedTextResult(text, { kind: "test", limit: 100 });
    expect(result.content[0]!.text).toBe(text);
  });

  it("spills to a file when over the limit", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const result = boundedTextResult(text, {
      kind: "verbalization",
      source: join(tmp, "model.orm.yaml"),
      limit: 100,
    });

    const out = result.content[0]!.text;
    expect(out).toContain("too large to return inline");
    expect(out).toContain("line 0");
    expect(out).not.toContain("line 199");

    const spill = spillPathFrom(out);
    expect(existsSync(spill)).toBe(true);
    expect(readFileSync(spill, "utf8")).toBe(text);
    expect(spill).toContain(".barwise");
  });

  it("honors an explicit outputPath", () => {
    const text = "y".repeat(500);
    const dest = join(tmp, "export.sql");
    const result = boundedTextResult(text, {
      kind: "export-ddl",
      outputPath: dest,
      limit: 100,
    });

    expect(spillPathFrom(result.content[0]!.text)).toBe(dest);
    expect(readFileSync(dest, "utf8")).toBe(text);
  });

  it("uses a content-addressed name stable across calls", () => {
    const model = join(tmp, "model.orm.yaml");
    writeFileSync(model, 'orm_version: "1.0"\n', "utf8");
    const text = Array.from({ length: 300 }, (_, i) => `row ${i}`).join("\n");

    const first = spillPathFrom(
      boundedTextResult(text, { kind: "diagram", source: model, limit: 100 })
        .content[0]!.text,
    );
    const second = spillPathFrom(
      boundedTextResult(text, { kind: "diagram", source: model, limit: 100 })
        .content[0]!.text,
    );

    expect(first).toBe(second);
  });

  it("falls back to the default limit when the env override is not a positive number", () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "not-a-number";
    try {
      // 100 bytes exceeds the (invalid-override -> default) inline limit
      // only if the default itself is large enough to swallow it, so
      // assert the opposite: this text is small enough to stay inline
      // under the real default, proving the invalid override was ignored
      // rather than parsed as 0 or NaN (which would force every call to spill).
      const text = "x".repeat(100);
      const result = boundedTextResult(text, { kind: "test" });
      expect(result.content[0]!.text).toBe(text);
    } finally {
      delete process.env.BARWISE_MCP_INLINE_LIMIT;
    }
  });

  it("falls back to the cwd for a spill source that is not a file path", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const result = boundedTextResult(text, {
      kind: "test",
      source: 'orm_version: "1.0"\nmodel:\n  name: Inline\n',
      limit: 50,
    });
    const spill = spillPathFrom(result.content[0]!.text);
    expect(spill.startsWith(process.cwd())).toBe(true);
    rmSync(join(process.cwd(), ".barwise", "mcp-cache"), { recursive: true, force: true });
  });

  it("formats a multi-megabyte payload size in MB", () => {
    const text = "x".repeat(1_100_000);
    const result = boundedTextResult(text, { kind: "test", source: join(tmp, "big.orm.yaml") });
    const out = result.content[0]!.text;
    expect(out).toMatch(/\d+\.\d MB/);
  });

  it("reports how many lines were elided", () => {
    const text = Array.from({ length: 120 }, (_, i) => `n${i}`).join("\n");
    const result = boundedTextResult(text, {
      kind: "test",
      outputPath: join(tmp, "big.txt"),
      previewLines: 40,
      limit: 50,
    });

    const out = result.content[0]!.text;
    expect(out).toContain("80 more line(s)");
    expect(out).toContain("----- end of preview");
  });
});
