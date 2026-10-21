/**
 * barwise migrate <files...>
 *
 * Rewrites each .orm.yaml file in place to the current format, and says
 * what reading it changed beyond the format: the 2.0 `is_preferred` flags
 * the model could not carry as written (orm-format-3 WS4b-iii, Open
 * decision 5). The one CLI command that modifies its inputs; that is its
 * whole job, and the capability matrix records it.
 */

import { CURRENT_ORM_VERSION, type MigrationNote } from "@barwise/core";
import type { Command } from "commander";
import { writeFileSync } from "node:fs";
import { readFile, serializer } from "../workspace/io.js";

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
      const outcomes = files.map((file) => migrateFile(file, opts.check === true));
      process.stdout.write(
        opts.format === "json"
          ? `${JSON.stringify(outcomes, null, 2)}\n`
          : outcomes.map(describe).join(""),
      );
      const failed = outcomes.some((o) => o.status === "error" || o.status === "would-migrate");
      if (failed) process.exitCode = 1;
    });
}

function migrateFile(file: string, check: boolean): FileOutcome {
  try {
    // Leniently, as `barwise validate` loads: a format rewrite carries a
    // dangling reference across for validation to report, rather than
    // refusing a fragment that names elements it does not define.
    const result = serializer.migrate(readFile(file), { lenient: true });
    if (result.from === CURRENT_ORM_VERSION) return { file, status: "current" };
    if (!check) writeFileSync(file, serializer.serialize(result.model), "utf-8");
    return {
      file,
      status: check ? "would-migrate" : "migrated",
      from: result.from ?? "(none)",
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
  return n.kind === "flag-dropped"
    ? `dropped the is_preferred flag on constraint "${n.constraintId}" in "${n.factType}": it identifies no entity type`
    : `"${n.entity}" had ${n.others.length + 1} preferred identifiers; kept "${n.kept}", dropped ${
      n.others.map((id) => `"${id}"`).join(", ")
    }`;
}
