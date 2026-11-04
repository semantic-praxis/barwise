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
 * A write that stopped after replacing some files: `replaced` names them,
 * so a caller can report the state the files are in, not only the error.
 */
export class PartialWriteError extends Error {
  constructor(message: string, readonly replaced: readonly string[], options?: ErrorOptions) {
    super(message, options);
    this.name = "PartialWriteError";
  }
}

/**
 * Write every file, all or nothing as far as a filesystem allows. Each
 * file is first staged beside its target (`<target><suffix>`, created
 * exclusively, with the target's permission bits), and only once every one
 * is staged are the staged files renamed over their targets, so a failure
 * while staging changes nothing. A rename can still fail part-way
 * (permissions, a full disk), and then a `PartialWriteError` names every
 * file already replaced. Writes go through a symlink to the file it names.
 * A rename makes a new file: a second hard link keeps the old content, and
 * the new file belongs to whoever ran the command. Returns the paths
 * replaced, as the caller gave them (`replaced` on the error names them
 * the same way), so a report names the files the user asked about.
 *
 * @throws when two writes name one file, or a staged file already exists
 * (left by an interrupted run): neither is written over.
 */
export function writeFilesAtomically(
  files: readonly FileWrite[],
  suffix = ".barwise-staged",
): string[] {
  const targets = files.map((file) => realpathSync(file.path));
  const twice = targets.find((t, i) => targets.indexOf(t) !== i);
  if (twice !== undefined) {
    throw new Error(`Two writes name one file: ${twice}. Nothing was written.`);
  }

  const staged: { given: string; target: string; temp: string; }[] = [];
  try {
    files.forEach((file, i) => {
      const target = targets[i]!;
      const temp = `${target}${suffix}`;
      // Exclusively: a file already there is not ours to write over or remove.
      writeFileSync(temp, file.text, { encoding: "utf-8", flag: "wx" });
      staged.push({ given: file.path, target, temp });
      // Set after writing: a creation mode is masked by the umask.
      chmodSync(temp, statSync(target).mode & 0o7777);
    });
  } catch (err) {
    removeQuietly(staged.map((s) => s.temp));
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `A staged file already exists beside ${targets[staged.length]} (left by an interrupted `
          + `run?). Remove it and retry. Nothing was written.`,
        { cause: err },
      );
    }
    throw err;
  }

  const replaced: string[] = [];
  for (const { given, target, temp } of staged) {
    try {
      renameSync(temp, target);
      replaced.push(given);
    } catch (err) {
      removeQuietly(staged.slice(replaced.length).map((s) => s.temp));
      const done = replaced.length === 0
        ? "no file was changed"
        : `already replaced: ${replaced.join(", ")}`;
      throw new PartialWriteError(
        `Could not replace ${given}: ${(err as Error).message} (${done}).`,
        replaced,
        { cause: err },
      );
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
