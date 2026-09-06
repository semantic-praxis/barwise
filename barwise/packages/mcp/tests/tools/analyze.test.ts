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

  it("extracts a full model from a local directory (buildSystem undetected)", async () => {
    // No package.json/build file in this directory: profile.buildSystem
    // stays null, exercising the `?? null` fallback alongside the
    // full (non-profileOnly) extractModel path.
    const tsDir = mkdtempSync(join(tmpdir(), "barwise-analyze-full-"));
    try {
      mkdirSync(join(tsDir, "src"), { recursive: true });
      writeFileSync(
        join(tsDir, "src", "order.ts"),
        "export interface Order { id: string; total: number; }\n",
      );

      const result = await executeAnalyzeRepository(tsDir, { domain: "Orders" });
      const parsed = JSON.parse(result.content[0]!.text) as {
        profile: { buildSystem: string | null; language: string; };
        objectTypes: number;
        model: string;
      };
      expect(parsed.profile.buildSystem).toBeNull();
      expect(parsed.profile.language).toBe("typescript");
      expect(parsed.model).toContain("name: Orders");
    } finally {
      rmSync(tsDir, { recursive: true, force: true });
    }
  });

  it("throws when no deterministic import format is detected for the repository", async () => {
    // An empty directory has no detectable language, so profile.importFormat
    // is null and extractModel refuses rather than guessing.
    const emptyDir = mkdtempSync(join(tmpdir(), "barwise-analyze-empty-"));
    try {
      await expect(executeAnalyzeRepository(emptyDir)).rejects.toThrow(
        /no deterministic import format detected/,
      );
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("attempts to clone when confirm=true for a repo not yet cloned locally", async () => {
    // No `gh` CLI in this environment: checkAuth() rejects before any
    // network call, which still exercises the confirmed-clone branch
    // (RepoManager's REPOS_ROOT is a module-level constant resolved from
    // homedir() at import time, so it cannot be redirected per-test to
    // also cover the manager.exists(repo)-is-true branch without writing
    // into the real $HOME/.barwise/repos).
    await expect(
      executeAnalyzeRepository("no-such-org-xyz/no-such-repo-xyz", {
        profileOnly: true,
        confirm: true,
      }),
    ).rejects.toThrow();
  });
});
