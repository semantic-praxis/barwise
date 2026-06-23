/**
 * barwise validate <file>
 *
 * Loads an .orm.yaml model file (or an .orm-project.yaml manifest),
 * runs the validation engine, and prints diagnostics to stdout.
 */

import { type Diagnostic, projectRules, ValidationEngine } from "@barwise/core";
import type { Command } from "commander";
import { formatDiagnostics, formatDiagnosticsJson } from "../workspace/format.js";
import { isProjectFile, loadModel } from "../workspace/io.js";
import { loadProject } from "../workspace/projectLoader.js";

interface ValidateOptions {
  format: string;
  warnings: boolean;
}

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate an ORM model or project file")
    .argument("<file>", "Path to .orm.yaml or .orm-project.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--no-warnings", "Suppress warnings")
    .action(async (file: string, opts: ValidateOptions) => {
      try {
        const diagnostics = isProjectFile(file)
          ? collectProjectDiagnostics(file)
          : new ValidationEngine().validate(loadModel(file));
        report(file, diagnostics, opts);
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/**
 * Validate every domain model in a project plus the cross-domain
 * project rules. Domain diagnostics are prefixed with their context;
 * project-level diagnostics are prefixed with `[project]`.
 */
function collectProjectDiagnostics(file: string): Diagnostic[] {
  const { project, problems } = loadProject(file);
  const engine = new ValidationEngine();
  const diagnostics: Diagnostic[] = [];

  for (const problem of problems) {
    diagnostics.push({
      severity: "error",
      message: problem,
      elementId: file,
      ruleId: "project/file-unresolved",
    });
  }

  for (const domain of project.domains) {
    if (!domain.model) continue; // Unresolved domains are already reported.
    for (const d of engine.validate(domain.model)) {
      diagnostics.push({ ...d, message: `[${domain.context}] ${d.message}` });
    }
  }

  for (const d of projectRules(project)) {
    diagnostics.push({ ...d, message: `[project] ${d.message}` });
  }

  return diagnostics;
}

function report(file: string, all: Diagnostic[], opts: ValidateOptions): void {
  const diagnostics = opts.warnings
    ? all
    : all.filter((d) => d.severity === "error");

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  if (opts.format === "json") {
    process.stdout.write(formatDiagnosticsJson(diagnostics) + "\n");
  } else if (diagnostics.length === 0) {
    process.stdout.write(`${file}: valid (0 errors, 0 warnings)\n`);
  } else {
    process.stdout.write(
      `${file}: ${errors.length} error(s), ${warnings.length} warning(s)\n\n`,
    );
    process.stdout.write(formatDiagnostics(diagnostics) + "\n");
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}
