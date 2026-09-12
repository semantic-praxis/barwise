/**
 * Where the Anthropic key lives: the OS keychain, never a settings string.
 *
 * `barwise.anthropicApiKey` was declared with no `scope`, which in VS Code
 * means `window` scope -- so it could be written to `.vscode/settings.json`,
 * a file people commit. The extension was inviting users to put a live
 * credential into a tracked file, and `docs/specs/credential-scanning.spec.md`
 * shipped a scanner that would find it only after that had happened, when the
 * remedy is rotation rather than deletion.
 *
 * So the setting is now `application`-scoped and deprecated, and the key
 * lives in `ExtensionContext.secrets` -- VS Code's own secret store, backed
 * by the OS keychain, which is not a file in the repository at all. That is
 * the same move `credential-scanning.spec.md` argues for one layer out:
 * remove the place the error can occur rather than detect it afterwards
 * (docs/specs/keyless-model-access.spec.md, barwise-1029).
 *
 * Nothing here is reached on the default path. `resolveLlmClient` prefers
 * `CopilotLlmClient`, which needs no key at all; this module exists for the
 * user who has deliberately chosen `llmProvider: "anthropic"`.
 */
import * as vscode from "vscode";

/** The secret-store key. Namespaced, since the store is per-extension. */
const SECRET_KEY = "barwise.anthropicApiKey";

/** The deprecated settings key, read once to migrate and then cleared. */
const DEPRECATED_SETTING = "anthropicApiKey";

/**
 * The key, from the secret store, migrating a settings value on first use.
 *
 * Returns `undefined` when no key is configured anywhere, which is the
 * normal state: the default provider is Copilot.
 */
export async function getAnthropicApiKey(
  secrets: vscode.SecretStorage,
): Promise<string | undefined> {
  const stored = await secrets.get(SECRET_KEY);
  if (stored !== undefined && stored !== "") return stored;
  return migrateFromSettings(secrets);
}

/** Store a key, or delete it when the value is empty. */
export async function setAnthropicApiKey(
  secrets: vscode.SecretStorage,
  key: string | undefined,
): Promise<void> {
  const trimmed = key?.trim() ?? "";
  if (trimmed === "") {
    await secrets.delete(SECRET_KEY);
    return;
  }
  await secrets.store(SECRET_KEY, trimmed);
}

/**
 * Move a key out of settings and into the secret store, once.
 *
 * `inspect()` rather than `get()`, and this is the load-bearing detail:
 * once the setting is declared `application`-scoped, `get()` no longer
 * returns a workspace value at all. A migration written against `get()`
 * would therefore find nothing in exactly the case that matters -- a key
 * sitting in a committable `.vscode/settings.json` -- and the user would
 * silently lose a working configuration while the credential stayed in the
 * file.
 */
async function migrateFromSettings(
  secrets: vscode.SecretStorage,
): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("barwise");
  const inspected = config.inspect<string>(DEPRECATED_SETTING);
  if (!inspected) return undefined;

  // Most specific first, matching how VS Code would have resolved it.
  const sites: ReadonlyArray<readonly [string | undefined, vscode.ConfigurationTarget]> = [
    [inspected.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder],
    [inspected.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [inspected.globalValue, vscode.ConfigurationTarget.Global],
  ];

  const found = sites.find(([value]) => (value ?? "").trim() !== "");
  if (!found) return undefined;

  const key = found[0]!.trim();
  await secrets.store(SECRET_KEY, key);

  // Clear every level that held it, not just the one that won: leaving a
  // copy behind in a lower-precedence file is leaving the credential in a
  // file, which is the whole point of moving it.
  let workspaceCopyRemained = false;
  for (const [value, target] of sites) {
    if ((value ?? "").trim() === "") continue;
    try {
      await config.update(DEPRECATED_SETTING, undefined, target);
    } catch {
      // An `application`-scoped setting cannot always be written to
      // workspace files, so the clear can fail in precisely the case the
      // scope change created. Reported rather than swallowed -- and the
      // advice is to ROTATE, because a key that lived in a workspace file
      // may already be committed, and deleting it from the file now does
      // not un-publish it.
      if (target !== vscode.ConfigurationTarget.Global) workspaceCopyRemained = true;
    }
  }

  if (workspaceCopyRemained) {
    void vscode.window.showWarningMessage(
      "barwise moved your Anthropic API key into the OS keychain, but could not "
        + "remove it from this workspace's settings file. Delete "
        + "`barwise.anthropicApiKey` from .vscode/settings.json by hand -- and "
        + "rotate the key, because a key stored in a workspace file may already "
        + "have been committed.",
    );
  }

  return key;
}
