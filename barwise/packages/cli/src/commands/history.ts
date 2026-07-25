/**
 * barwise history <file>
 *
 * Walks a model file's git revisions and renders the semantic deltas
 * between each adjacent pair via the diff engine -- change-over-time
 * traceability composed from git (who/when) and `diffModels` (what),
 * per docs/specs/model-history.spec.md. The git subprocess lives here
 * in the CLI; the diff stays pure in core.
 */

import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { diffModels, type ModelDelta } from "@barwise/core/diff";
import type { Command } from "commander";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const serializer = new OrmYamlSerializer();

interface Revision {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  /** The file's path at this revision (follows renames). */
  readonly path: string;
}

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Show a model's semantic change history from git")
    .argument("<file>", "Path to a .orm.yaml file under git")
    .option("--limit <n>", "Walk only the newest n revisions", "20")
    .action((file: string, opts: { limit: string; }) => {
      try {
        const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
        process.stdout.write(renderHistory(file, limit));
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/** Render the full history text for a model file. */
export function renderHistory(file: string, limit: number): string {
  const absolute = resolve(file);
  const cwd = dirname(absolute);

  const repoRoot = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const relPath = absolute.slice(repoRoot.length + 1).replaceAll("\\", "/");

  const revisions = listRevisions(cwd, relPath, limit);
  if (revisions.length === 0) {
    throw new Error(`No git history for ${file}.`);
  }

  // Parse each revision's content once; null marks an unreadable one.
  const models: (OrmModel | null)[] = revisions.map((rev) => {
    try {
      return serializer.deserialize(git(cwd, ["show", `${rev.hash}:${rev.path}`]));
    } catch {
      return null;
    }
  });

  const sections: string[] = [];

  // Working-tree entry: the file on disk vs HEAD, when they differ.
  const workingTree = renderWorkingTree(absolute, models[0] ?? null);
  if (workingTree) sections.push(workingTree);

  // Each revision, newest first, diffed against its parent revision.
  for (let i = 0; i < revisions.length; i++) {
    sections.push(
      renderRevision(
        revisions[i]!,
        models[i] ?? null,
        models[i + 1] ?? null,
        i === revisions.length - 1,
      ),
    );
  }

  return sections.join("\n") + "\n";
}

/** List the file's revisions, newest first, following renames. */
function listRevisions(cwd: string, relPath: string, limit: number): Revision[] {
  const raw = git(cwd, [
    "log",
    "--follow",
    `--max-count=${limit}`,
    "--format=%x01%H%x09%h%x09%an%x09%as%x09%s",
    "--name-only",
    "--",
    relPath,
  ]);

  const revisions: Revision[] = [];
  for (const block of raw.split("")) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const [hash, shortHash, author, date, subject] = lines[0]!.split("\t");
    // --name-only prints the file's path at that revision after the header.
    const path = lines[1] ?? relPath;
    if (!hash) continue;
    revisions.push({
      hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      author: author ?? "",
      date: date ?? "",
      subject: subject ?? "",
      path,
    });
  }
  return revisions;
}

/** One revision's section: header plus deltas against its parent. */
function renderRevision(
  rev: Revision,
  model: OrmModel | null,
  parent: OrmModel | null,
  isOldestWalked: boolean,
): string {
  const header = `${rev.shortHash} ${rev.date} ${rev.author}: ${rev.subject}`;

  if (model === null) {
    return `${header}\n  (unreadable at ${rev.shortHash} -- predates the current schema?)\n`;
  }
  if (parent === null) {
    if (isOldestWalked) {
      return `${header}\n  ${summarize(model)}\n`;
    }
    return `${header}\n  (parent revision unreadable -- no diff)\n`;
  }
  return `${header}\n${renderDeltas(parent, model)}`;
}

/** The working-tree section when the file differs from HEAD. */
function renderWorkingTree(absolute: string, head: OrmModel | null): string | undefined {
  if (head === null) return undefined;
  let onDisk: OrmModel;
  try {
    onDisk = serializer.deserialize(readFileSync(absolute, "utf-8"));
  } catch {
    return "working tree\n  (file on disk is unreadable)\n";
  }
  const diff = diffModels(head, onDisk);
  if (!diff.hasChanges) return undefined;
  return `working tree (uncommitted)\n${renderDeltas(head, onDisk)}`;
}

/** Semantic deltas from `older` to `newer`, indented one level. */
function renderDeltas(older: OrmModel, newer: OrmModel): string {
  const deltas = diffModels(older, newer).deltas.filter((d) => d.kind !== "unchanged");
  if (deltas.length === 0) {
    return "  no conceptual changes\n";
  }
  let out = "";
  for (const delta of deltas) {
    out += `  ${delta.kind.toUpperCase().padEnd(8)} ${deltaLabel(delta)}\n`;
    for (const change of delta.changeDescriptions) {
      out += `    ${change}\n`;
    }
  }
  return out;
}

/** First-revision summary when there is no parent to diff against. */
function summarize(model: OrmModel): string {
  return `initial: ${model.objectTypes.length} object type(s), `
    + `${model.factTypes.length} fact type(s)`;
}

function deltaLabel(delta: ModelDelta): string {
  if (delta.elementType === "definition") {
    return `Definition: ${delta.term}`;
  }
  const typeLabel = delta.elementType === "object_type" ? "Object type" : "Fact type";
  return `${typeLabel}: ${delta.name}`;
}

/** Run git in `cwd`; a missing repo or bad revision throws with git's message. */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf-8" });
  } catch (err) {
    const stderr = (err as { stderr?: string; }).stderr?.toString().trim();
    throw new Error(stderr || `git ${args[0]} failed`, { cause: err });
  }
}
