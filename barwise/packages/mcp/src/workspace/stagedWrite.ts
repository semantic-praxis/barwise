/**
 * The staged multi-file write `rename_element` uses to write back. A copy
 * of `@barwise/cli`'s `workspace/stagedWrite.ts`, registered with it in
 * `parity.manifest.json`: the MCP server does not depend on the CLI, and
 * the two must write the same way.
 */

import { chmodSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

/** A file to write and its new content. */
export interface FileWrite {
  readonly path: string;
  readonly text: string;
}

/**
 * Write every file, all or nothing as far as a filesystem allows. Each
 * file is first staged beside its target (`<target><suffix>`, with the
 * target's permission bits), and only once every one is staged are the
 * staged files renamed over their targets, so a failure while staging
 * changes nothing. A rename can still fail part-way (permissions, a full
 * disk), and then the error names every file already replaced. Writes go
 * through a symlink to the file it names. A rename makes a new file: a
 * second hard link keeps the old content, and the new file belongs to
 * whoever ran the command. Returns the real paths replaced.
 */
export function writeFilesAtomically(
  files: readonly FileWrite[],
  suffix = ".barwise-staged",
): string[] {
  const staged: { target: string; temp: string; }[] = [];
  try {
    for (const file of files) {
      const target = realpathSync(file.path);
      const temp = `${target}${suffix}`;
      staged.push({ target, temp });
      writeFileSync(temp, file.text, "utf-8");
      // Set after writing: a creation mode is masked by the umask.
      chmodSync(temp, statSync(target).mode & 0o7777);
    }
  } catch (err) {
    removeQuietly(staged.map((s) => s.temp));
    throw err;
  }

  const replaced: string[] = [];
  for (const { target, temp } of staged) {
    try {
      renameSync(temp, target);
      replaced.push(target);
    } catch (err) {
      removeQuietly(staged.slice(replaced.length).map((s) => s.temp));
      const done = replaced.length === 0
        ? "no file was changed"
        : `already replaced: ${replaced.join(", ")}`;
      throw new Error(`Could not replace ${target}: ${(err as Error).message} (${done}).`, {
        cause: err,
      });
    }
  }
  return replaced;
}

/** Remove staged files; the write's own error is the one to report. */
function removeQuietly(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Nothing to add to the error already being thrown.
    }
  }
}
