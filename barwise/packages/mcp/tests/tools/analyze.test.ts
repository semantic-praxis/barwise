/**
 * Tests for the analyze_repository tool: local-path profiling and the
 * clone-confirmation gate (no network, no clone side effects).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { executeAnalyzeRepository } from "../../src/tools/analyze.js";

const dir = mkdtempSync(join(tmpdir(), "barwise-analyze-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("analyze_repository tool", () => {
  it("profiles a local TypeScript directory without confirmation", async () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sample" }));
    writeFileSync(
      join(dir, "src", "order.ts"),
      "export interface Order { id: string; total: number; }\n",
    );

    const result = await executeAnalyzeRepository(dir, { profileOnly: true });
    const parsed = JSON.parse(result.content[0]!.text) as {
      profile: { language: string; sourceFileCount: number; };
      requiresConfirmation?: boolean;
    };
    expect(parsed.requiresConfirmation).toBeUndefined();
    expect(parsed.profile.language).toBe("typescript");
    expect(parsed.profile.sourceFileCount).toBeGreaterThan(0);
  });

  it("gates cloning a not-yet-cloned remote repo behind confirmation", async () => {
    const result = await executeAnalyzeRepository(
      "no-such-org-xyz/no-such-repo-xyz",
      { profileOnly: true },
    );
    const parsed = JSON.parse(result.content[0]!.text) as {
      requiresConfirmation?: boolean;
      message?: string;
    };
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.message).toContain("confirm=true");
  });
});
