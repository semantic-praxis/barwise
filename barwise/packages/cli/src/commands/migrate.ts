/**
 * barwise migrate <files...>
 *
 * Rewrites each .orm.yaml file in place to the current format, and says
 * what reading it changed beyond the format: the 2.0 `is_preferred` flags
 * the model could not carry as written (orm-format-3 WS4b-iii, Open
 * decision 5). One of the two CLI commands that modify their inputs, with
 * `rename`; that is its whole job, and the capability matrix records it.
 */

import { CURRENT_ORM_VERSION, type MigrationNote } from "@barwise/core";
import type { Command } from "commander";
import { readFile, serializer } from "../workspace/io.js";
import { writeFilesAtomically } from "../workspace/stagedWrite.js";

interface MigrateOptions {
  check?: boolean;
  format: string;
}

/** One file's outcome. */
type FileOutcome =
  | { file: string; status: "current"; }
  | {
    file: string;
    status: "migrated" | "would-migrate";
    from: string;
    notes: readonly MigrationNote[];
  }
  | { file: string; status: "error"; error: string; };

export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description(`Rewrite .orm.yaml files in place as format ${CURRENT_ORM_VERSION}`)
    .argument("<files...>", "Paths to .orm.yaml files")
    .option("--check", "Write nothing; exit 1 if any file would be rewritten")
    .option("--format <format>", "Output format (text or json)", "text")
    .action((files: string[], opts: MigrateOptions) => {
      if (opts.format !== "text" && opts.format !== "json") {
        process.stderr.write(`Error: unknown --format "${opts.format}"; use text or json.\n`);
        process.exitCode = 2;
        return;
      }
      const outcomes = files.map((file) => migrateFile(file, opts.check === true));
      process.stdout.write(
        opts.format === "json"
          ? `${JSON.stringify(outcomes, null, 2)}\n`
          : outcomes.map(describe).join(""),
      );
      // 2 when a file could not be answered for, which a caller must not
      // read as "needs migrating" (the gate contract, root CLAUDE.md); 1
      // when --check found a file to rewrite.
      if (outcomes.some((o) => o.status === "error")) process.exitCode = 2;
      else if (outcomes.some((o) => o.status === "would-migrate")) process.exitCode = 1;
    });
}

function migrateFile(file: string, check: boolean): FileOutcome {
  try {
    // Leniently, as `barwise validate` loads: a format rewrite carries a
    // dangling reference across for validation to report, rather than
    // refusing a fragment that names elements it does not define.
    const result = serializer.migrate(readFile(file), { lenient: true });
    if (result.from === CURRENT_ORM_VERSION) return { file, status: "current" };
    const unplaceable = result.notes.find((n) => n.kind === "flags-unplaceable");
    if (unplaceable) return { file, status: "error", error: `not migrated: ${note(unplaceable)}` };
    const text = serializer.serialize(result.model);
    // A 2.0 file can hold what 3.0 refuses (two constraints sharing an id):
    // rewriting it would turn a file that loads into one that does not.
    try {
      serializer.deserialize(text, { lenient: true });
    } catch (err) {
      return {
        file,
        status: "error",
        error: `not migrated: its ${CURRENT_ORM_VERSION} form would not load: ${
          (err as Error).message
        }`,
      };
    }
    if (!check) writeFilesAtomically([{ path: file, text }], ".migrating");
    return {
      file,
      status: check ? "would-migrate" : "migrated",
      from: result.from,
      notes: result.notes,
    };
  } catch (err) {
    return { file, status: "error", error: (err as Error).message };
  }
}

function describe(o: FileOutcome): string {
  switch (o.status) {
    case "current":
      return `${o.file}: already ${CURRENT_ORM_VERSION}\n`;
    case "error":
      return `${o.file}: ${o.error}\n`;
    default: {
      const verb = o.status === "migrated" ? "->" : "would migrate to";
      return `${o.file}: ${o.from} ${verb} ${CURRENT_ORM_VERSION}\n${
        o.notes.map((n) => `  ${note(n)}\n`).join("")
      }`;
    }
  }
}

function note(n: MigrationNote): string {
  switch (n.kind) {
    case "flag-dropped":
      return `dropped the is_preferred flag on constraint "${n.constraintId}" in "${n.factType}": it identifies no entity type`;
    case "flags-unplaceable":
      return `it names elements it does not define (${
        n.missing.map((id) => `"${id}"`).join(", ")
      }) and carries is_preferred flags, which cannot be placed without them; migrate it as part of the whole model`;
    case "identifier-chosen":
      return `"${n.entity}" was named by ${
        n.others.length + 1
      } preferred identifiers; kept "${n.kept}", and ${
        n.others.map((id) => `"${id}"`).join(", ")
      } ${n.others.length === 1 ? "is" : "are"} no longer preferred`;
  }
}
