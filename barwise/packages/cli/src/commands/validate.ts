/**
 * barwise validate <file>
 *
 * Loads an .orm.yaml model file (or an .orm-project.yaml manifest),
 * runs the validation engine, and prints diagnostics to stdout.
 */

import { type Diagnostic, projectRules, type RuleId, ValidationEngine } from "@barwise/core";
import { emitValidationRecord, summariseValidation } from "@barwise/llm";
import type { Command } from "commander";
import { callLogSink } from "../workspace/callLogSink.js";
import { formatDiagnostics, formatDiagnosticsJson } from "../workspace/format.js";
import { isProjectFile, loadModel } from "../workspace/io.js";
import { loadProject } from "../workspace/projectLoader.js";
import { cliReport, type CliRuleId } from "../workspace/ruleId.js";

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
        // Loaded leniently, because reporting what is wrong with a model
        // is this command's whole job and a loader throw pre-empts it.
        // `addPopulation` and friends refuse a dangling reference, so a
        // schema-valid file naming a missing fact type used to print one
        // parse error instead of every diagnostic -- and three rules
        // that report exactly that could never fire (barwise-977).
        // `ValidationEngine` reports unresolved references itself now,
        // so deferring them to it loses nothing: the JSON Schema check
        // still runs at parse time, and only reference resolution moves.
        const diagnostics = isProjectFile(file)
          ? collectProjectDiagnostics(file)
          : new ValidationEngine().validate(loadModel(file, { lenient: true }));
        // Recorded under the command name, not the path: a path is the
        // user's directory layout, which is theirs and not ours to
        // accumulate (docs/specs/pipeline-observability.spec.md).
        emitValidationRecord(
          callLogSink(),
          summariseValidation({
            startedAt: new Date().toISOString(),
            source: isProjectFile(file) ? "validate:project" : "validate:model",
            diagnostics,
          }),
        );
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
function collectProjectDiagnostics(file: string): Diagnostic<RuleId | CliRuleId>[] {
  const { project, problems } = loadProject(file);
  const engine = new ValidationEngine();
  const diagnostics: Diagnostic<RuleId | CliRuleId>[] = [];

  for (const problem of problems) {
    diagnostics.push(cliReport("project/file-unresolved", "default", file, problem));
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

function report<R extends string>(
  file: string,
  all: readonly Diagnostic<R>[],
  opts: ValidateOptions,
): void {
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
