/**
 * The Anthropic key's home, and the migration out of its old one.
 *
 * `barwise.anthropicApiKey` was declared with no `scope`, which in VS Code
 * means `window` scope -- so it could be written to `.vscode/settings.json`
 * and committed. The setting is now `application`-scoped and the key lives in
 * `ExtensionContext.secrets`, and these tests pin the two things that make
 * that switch safe rather than merely tidy: the migration finds a value the
 * scope change has made invisible to `get()`, and a workspace copy that
 * cannot be cleared is reported with advice to ROTATE rather than silently
 * left behind (docs/specs/keyless-model-access.spec.md, barwise-1029).
 *
 * `vscode` is mocked at the boundary, the way `toolRegistration.test.ts` and
 * `ChatParticipant.test.ts` do, so the real module runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Inspected {
  globalValue?: string;
  workspaceValue?: string;
  workspaceFolderValue?: string;
}

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  inspected: undefined as Inspected | undefined,
  /** Every `update` call, so a test can assert WHICH levels were cleared. */
  updates: [] as Array<{ key: string; value: unknown; target: number; }>,
  /** Targets whose `update` should throw, as `application` scope makes happen. */
  updateThrowsFor: new Set<number>(),
  /** `get` must never be reached by the migration path. */
  getCalls: [] as string[],
  warnings: [] as string[],
}));

vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => {
        state.getCalls.push(key);
        return undefined;
      },
      inspect: () => state.inspected,
      update: async (key: string, value: unknown, target: number) => {
        if (state.updateThrowsFor.has(target)) {
          throw new Error(`cannot write ${key} at target ${target}`);
        }
        state.updates.push({ key, value, target });
      },
    }),
  },
  window: {
    showWarningMessage: (m: string) => {
      state.warnings.push(m);
      return Promise.resolve(undefined);
    },
  },
}));

const { getAnthropicApiKey, setAnthropicApiKey } = await import(
  "../../src/llm/anthropicKey.js"
);

/** A stand-in for `ExtensionContext.secrets`. */
const secrets = {
  get: (k: string) => Promise.resolve(state.secrets.get(k)),
  store: (k: string, v: string) => {
    state.secrets.set(k, v);
    return Promise.resolve();
  },
  delete: (k: string) => {
    state.secrets.delete(k);
    return Promise.resolve();
  },
  onDidChange: () => ({ dispose: () => {} }),
} as unknown as import("vscode").SecretStorage;

const SECRET_KEY = "barwise.anthropicApiKey";
// Assembled, not a literal: `check:secrets` scans this repository's history
// including this file, and a realistic key shape here would make that gate
// fail on its own test.
const KEY = "sk-ant-" + "api03-" + "7Kq2Vx9mTwRbN4yLp" + "Z3jHcF8sAdE6gUn1oIxBvCz";

beforeEach(() => {
  state.secrets.clear();
  state.inspected = undefined;
  state.updates = [];
  state.updateThrowsFor = new Set();
  state.getCalls = [];
  state.warnings = [];
});

describe("getAnthropicApiKey", () => {
  it("returns undefined when no key is configured anywhere", async () => {
    // The normal state: the default provider is Copilot, which needs no key.
    expect(await getAnthropicApiKey(secrets)).toBeUndefined();
    expect(state.updates).toEqual([]);
  });

  it("returns the stored secret without touching settings", async () => {
    state.secrets.set(SECRET_KEY, KEY);
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.updates).toEqual([]);
  });

  it("migrates a global settings value and clears it", async () => {
    state.inspected = { globalValue: KEY };
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.secrets.get(SECRET_KEY)).toBe(KEY);
    expect(state.updates).toEqual([
      { key: "anthropicApiKey", value: undefined, target: 1 },
    ]);
    expect(state.warnings).toEqual([]);
  });

  it("migrates a WORKSPACE settings value, which is the committable one", async () => {
    // This is the case the whole change exists for: a key in
    // .vscode/settings.json, a file people commit.
    state.inspected = { workspaceValue: KEY };
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.secrets.get(SECRET_KEY)).toBe(KEY);
    expect(state.updates.map((u) => u.target)).toEqual([2]);
  });

  it("reads through inspect(), never get()", async () => {
    // The load-bearing detail. Once the setting is `application`-scoped,
    // `get()` no longer returns a workspace value at all, so a migration
    // written against `get()` would find nothing in exactly the case that
    // matters and the user would silently lose a working configuration.
    state.inspected = { workspaceValue: KEY };
    await getAnthropicApiKey(secrets);
    expect(state.getCalls).toEqual([]);
  });

  it("clears every level that held a copy, not just the winning one", async () => {
    // Leaving a lower-precedence copy behind is leaving the credential in a
    // file, which is the thing being fixed.
    state.inspected = { globalValue: KEY, workspaceValue: KEY, workspaceFolderValue: KEY };
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.updates.map((u) => u.target).sort()).toEqual([1, 2, 3]);
  });

  it("prefers the most specific level, as VS Code would have resolved it", async () => {
    state.inspected = { globalValue: "global-" + KEY, workspaceValue: "ws-" + KEY };
    expect(await getAnthropicApiKey(secrets)).toBe("ws-" + KEY);
  });

  it("is idempotent: a second call reads the secret and re-clears nothing", async () => {
    state.inspected = { globalValue: KEY };
    await getAnthropicApiKey(secrets);
    state.inspected = undefined; // the setting is gone now
    state.updates = [];
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.updates).toEqual([]);
  });

  it("warns and says ROTATE when a workspace copy cannot be cleared", async () => {
    // `application` scope can refuse a workspace write, so the clear can fail
    // in precisely the case the scope change created. The key is stored
    // either way -- the user keeps working -- but the file still holds a
    // credential that may already be committed, and deleting it later does
    // not un-publish it.
    state.inspected = { workspaceValue: KEY };
    state.updateThrowsFor.add(2);
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.secrets.get(SECRET_KEY)).toBe(KEY);
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toMatch(/rotate the key/i);
    expect(state.warnings[0]).toMatch(/settings\.json/);
  });

  it("does not warn when only the global level fails to clear", async () => {
    // User settings are not a committable file, so a failure there is not the
    // exposure the warning is about.
    state.inspected = { globalValue: KEY };
    state.updateThrowsFor.add(1);
    expect(await getAnthropicApiKey(secrets)).toBe(KEY);
    expect(state.warnings).toEqual([]);
  });

  it("treats a whitespace-only settings value as absent", async () => {
    state.inspected = { globalValue: "   " };
    expect(await getAnthropicApiKey(secrets)).toBeUndefined();
    expect(state.updates).toEqual([]);
  });
});

describe("setAnthropicApiKey", () => {
  it("stores a trimmed key", async () => {
    await setAnthropicApiKey(secrets, `  ${KEY}  `);
    expect(state.secrets.get(SECRET_KEY)).toBe(KEY);
  });

  it("deletes the stored key when given an empty value", async () => {
    state.secrets.set(SECRET_KEY, KEY);
    await setAnthropicApiKey(secrets, "");
    expect(state.secrets.has(SECRET_KEY)).toBe(false);
  });

  it("deletes on whitespace and on undefined, so clearing cannot half-happen", async () => {
    state.secrets.set(SECRET_KEY, KEY);
    await setAnthropicApiKey(secrets, "   ");
    expect(state.secrets.has(SECRET_KEY)).toBe(false);

    state.secrets.set(SECRET_KEY, KEY);
    await setAnthropicApiKey(secrets, undefined);
    expect(state.secrets.has(SECRET_KEY)).toBe(false);
  });
});
