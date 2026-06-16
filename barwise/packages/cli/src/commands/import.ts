/**
 * barwise import transcript <file>
 * barwise import model <source> --format <format>
 * barwise import batch <dir> --model <model> [--model <model>...]
 *
 * Processes transcripts through the LLM extraction pipeline
 * and produces .orm.yaml files.
 */

import { registerCodeFormats } from "@barwise/code-analysis";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import type { Command } from "commander";
import { addBatchSubcommand } from "./import/batch.js";
import { addCodeSubcommands } from "./import/code.js";
import { addDbtSubcommand } from "./import/dbt.js";
import { addModelSubcommand } from "./import/model.js";
import { addNormaSubcommand } from "./import/norma.js";
import { addSqlSubcommand } from "./import/sql.js";
import { addTranscriptSubcommand } from "./import/transcript.js";

export { formatAlternativeFramings, slugifyModel } from "./import/shared.js";

// Register the standard formats (DDL, OpenAPI, Avro, SQL, NORMA).
registerStandardFormats();
// Register code-analysis formats (TypeScript, etc.)
registerCodeFormats();
// Register the dbt connector format.
registerDbtFormats();

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Import data into ORM models");

  addModelSubcommand(importCmd);
  addNormaSubcommand(importCmd);
  addDbtSubcommand(importCmd);
  addSqlSubcommand(importCmd);
  addCodeSubcommands(importCmd);
  addTranscriptSubcommand(importCmd);
  addBatchSubcommand(importCmd);
}
