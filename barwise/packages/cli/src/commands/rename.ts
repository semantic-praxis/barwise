/**
 * barwise rename <file> <target> --to <name>
 * barwise rename --project <manifest> --domain <context> <target> --to <name>
 *
 * Renames an object type, a fact type or a role (iri-identity WS5b), and in
 * a project follows it into the shadows, reference modes, definitions and
 * mapping files that name it. One of the two CLI commands that modify their
 * inputs, with `migrate`; the capability matrix records it. Files are
 * written from the model, so YAML comments in a rewritten file are lost,
 * as `migrate` loses them (barwise-ok6).
 */

import { OrmYamlSerializer } from "@barwise/core";
import {
  modelForRename,
  projectRenameWrites,
  renameInModel,
  renameInProject,
  type RenameTarget,
} from "@barwise/core/rename";
import type { Command } from "commander";
import { dirname, resolve } from "node:path";
import { readFile } from "../workspace/io.js";
import { loadProject } from "../workspace/projectLoader.js";
import {
  type FileWrite,
  PartialWriteError,
  writeFilesAtomically,
} from "../workspace/stagedWrite.js";

interface RenameOptions {
  objectType?: string;
  factType?: string;
  role?: string;
  rolePosition?: string;
  to?: string;
  project?: string;
  domain?: string;
  check?: boolean;
  format: string;
}

/** What the command did, or would do under --check. */
interface Outcome {
  readonly status: "renamed" | "would-rename" | "error";
  readonly files: readonly string[];
  readonly changes: readonly string[];
  readonly warnings: readonly string[];
  readonly error?: string;
}

export function registerRenameCommand(program: Command): void {
  program
    .command("rename")
    .description(
      "Rename an object type, fact type or role, in a model file or across a project "
        + "(rewrites its inputs; YAML comments in a rewritten file are lost)",
    )
    .argument("[file]", "Path to a .orm.yaml file (or use --project and --domain)")
    .option("--object-type <name>", "The object type to rename")
    .option("--fact-type <name>", "The fact type to rename, or the one holding --role")
    .option("--role <name>", "With --fact-type: the role to rename, by its name")
    .option(
      "--role-position <n>",
      "With --fact-type: the role to rename, by its position (0-based)",
    )
    // Checked in the action, not by commander: a missing --to must exit 2
    // (could not answer), never commander's 1, which --check uses.
    .option("--to <name>", "The new name (required)")
    .option("--project <manifest>", "A .orm-project.yaml; the rename follows into its other files")
    .option("--domain <context>", "With --project: the domain that holds the element")
    .option("--check", "Write nothing; exit 1 if any file would be rewritten")
    .option("--format <format>", "Output format (text or json)", "text")
    .action((file: string | undefined, opts: RenameOptions) => {
      if (opts.format !== "text" && opts.format !== "json") {
        process.stderr.write(`Error: unknown --format "${opts.format}"; use text or json.\n`);
        process.exitCode = 2;
        return;
      }
      const outcome = run(file, opts);
      process.stdout.write(
        opts.format === "json" ? `${JSON.stringify(outcome, null, 2)}\n` : describe(outcome),
      );
      // 2 when the rename could not be done, which a caller must not read
      // as "would rewrite" (the gate contract, root CLAUDE.md); 1 when
      // --check found files to rewrite, as `migrate --check` does.
      if (outcome.status === "error") process.exitCode = 2;
      else if (outcome.status === "would-rename") process.exitCode = 1;
    });
}

function run(file: string | undefined, opts: RenameOptions): Outcome {
  try {
    const target = targetOf(opts);
    if (opts.to === undefined) return failure("--to is required.");
    if (file !== undefined && opts.project !== undefined) {
      return failure("Name a model file or --project, not both.");
    }
    if ((opts.project === undefined) !== (opts.domain === undefined)) {
      return failure("--project and --domain go together.");
    }
    if (opts.project !== undefined) return renameProject(opts.project, opts.domain!, target, opts);
    if (file === undefined) return failure("Name a model file, or --project and --domain.");
    return renameFile(file, target, opts);
  } catch (err) {
    // A refusal, a usage mistake, a file that would not load, or a write
    // that failed: each is reported, never thrown past the command.
    return failure((err as Error).message);
  }
}

class UsageError extends Error {}

function targetOf(opts: RenameOptions): RenameTarget {
  const roleGiven = opts.role !== undefined || opts.rolePosition !== undefined;
  if (roleGiven) {
    if (opts.role !== undefined && opts.rolePosition !== undefined) {
      throw new UsageError("Name the role by --role or --role-position, not both.");
    }
    if (opts.factType === undefined || opts.objectType !== undefined) {
      throw new UsageError("A role is named with --fact-type and --role or --role-position.");
    }
    if (opts.rolePosition !== undefined && !/^\d+$/.test(opts.rolePosition)) {
      throw new UsageError(
        `--role-position must be a whole number from 0, not "${opts.rolePosition}".`,
      );
    }
    const role = opts.rolePosition === undefined ? opts.role! : Number(opts.rolePosition);
    return { kind: "role", factType: opts.factType, role };
  }
  if ((opts.objectType === undefined) === (opts.factType === undefined)) {
    throw new UsageError("Name exactly one of --object-type or --fact-type.");
  }
  return opts.objectType !== undefined
    ? { kind: "objectType", name: opts.objectType }
    : { kind: "factType", name: opts.factType! };
}

function renameFile(file: string, target: RenameTarget, opts: RenameOptions): Outcome {
  const model = modelForRename(readFile(file), file);
  const warnings = model.domainContext === undefined ? [] : [
    `${file} declares domain "${model.domainContext}". If it is a domain of a project, rename `
    + `it with --project and --domain instead, so its shadows and mapping files follow.`,
  ];
  const { model: renamed, changes } = renameInModel(model, target, opts.to!);
  return write(
    [{ path: file, text: new OrmYamlSerializer().serialize(renamed) }],
    changes,
    warnings,
    opts,
  );
}

function renameProject(
  manifest: string,
  domain: string,
  target: RenameTarget,
  opts: RenameOptions,
): Outcome {
  // Leniently, as `barwise validate` assembles a project, so a domain with
  // a dangling reference renames as it would on its own.
  const { project, problems } = loadProject(manifest, { lenient: true });
  if (problems.length > 0) {
    return failure(
      `The project did not load cleanly, and a rename cannot follow into a file that did not load: ${
        problems.join("; ")
      }`,
    );
  }
  const base = dirname(manifest);
  for (const d of project.domains) modelForRename(readFile(resolve(base, d.path)), d.path);
  const result = renameInProject(project, domain, target, opts.to!);
  const writes = projectRenameWrites(result).map((w) => ({
    path: resolve(base, w.path),
    text: w.text,
  }));
  return write(writes, result.changes, [], opts);
}

function write(
  writes: readonly FileWrite[],
  changes: readonly string[],
  warnings: readonly string[],
  opts: RenameOptions,
): Outcome {
  const files = writes.map((w) => w.path);
  if (opts.check) return { status: "would-rename", files, changes, warnings };
  try {
    writeFilesAtomically(writes);
  } catch (err) {
    // A write that stopped part-way names what it replaced, so `files` says
    // which files are in their new state rather than claiming none are.
    const replaced = err instanceof PartialWriteError ? err.replaced : [];
    return { ...failure((err as Error).message), files: replaced };
  }
  return { status: "renamed", files, changes, warnings };
}

function failure(error: string): Outcome {
  return { status: "error", files: [], changes: [], warnings: [], error };
}

function describe(o: Outcome): string {
  if (o.status === "error") {
    return `${o.error!.startsWith("Not renamed") ? o.error : `Not renamed: ${o.error}`}\n`;
  }
  const lines = [
    ...o.warnings.map((w) => `Warning: ${w}`),
    ...o.changes,
    `${o.status === "renamed" ? "Wrote" : "Would write"} ${o.files.length} file(s): ${
      o.files.join(", ")
    }`,
  ];
  return `${lines.join("\n")}\n`;
}
