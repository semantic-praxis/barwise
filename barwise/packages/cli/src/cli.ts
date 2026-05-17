/**
 * Commander program definition for the barwise CLI.
 *
 * Each command group is registered from its own module.
 */

import { Command } from "commander";
import { registerAnalyzeCommand } from "./commands/analyze.js";
import { registerDescribeCommand } from "./commands/describe.js";
import { registerDiagramCommand } from "./commands/diagram.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerExportCommand } from "./commands/export.js";
import { registerImportCommand } from "./commands/import.js";
import { registerLineageCommand } from "./commands/lineage.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerSchemaCommand } from "./commands/schema.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerVerbalizeCommand } from "./commands/verbalize.js";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("barwise")
    .description("ORM 2 modeling tool for data engineers and architects")
    .version("0.1.0");

  registerAnalyzeCommand(program);
  registerValidateCommand(program);
  registerVerbalizeCommand(program);
  registerDescribeCommand(program);
  registerQueryCommand(program);
  registerSchemaCommand(program);
  registerExportCommand(program);
  registerDiagramCommand(program);
  registerDiffCommand(program);
  registerImportCommand(program);
  registerLineageCommand(program);

  return program;
}
