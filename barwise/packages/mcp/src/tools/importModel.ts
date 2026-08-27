/**
 * import_model tool: imports from structured formats (DDL, OpenAPI, dbt, sql, etc.).
 */

import { registerCodeFormats } from "@barwise/code-analysis";
import { getImporter, listImporters, OrmYamlSerializer } from "@barwise/core";
import { SQL_DIALECTS } from "@barwise/core/sql";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readSource } from "../workspace/resolve.js";

const serializer = new OrmYamlSerializer();

// Register the standard formats (DDL, OpenAPI, Avro, SQL, NORMA).
registerStandardFormats();
// Register code-analysis formats (TypeScript, etc.)
registerCodeFormats();
// Register the dbt connector format.
registerDbtFormats();

export function registerImportModelTool(server: McpServer): void {
  server.registerTool(
    "import_model",
    {
      title: "Import Model",
      description: "Import an ORM model from a structured format. "
        + "Performs deterministic parsing to produce a draft ORM model. "
        + "For text formats (ddl, openapi, norma, sql), prefer passing a file path over inline content "
        + "(especially for large files like NORMA .orm XML). "
        + "For directory formats (dbt, typescript, java, kotlin), source is a directory path. "
        + "The sql format also supports directory paths for analyzing multiple SQL files.",
      inputSchema: {
        source: z
          .string()
          .describe(
            "File path (preferred) or inline content. "
              + "For text formats: absolute file path or raw content. Prefer file paths for large files. "
              + "For directory formats (dbt, typescript, java, kotlin): path to project directory. "
              + "For sql: file path, directory path, or inline content.",
          ),
        format: z
          // Derived from the registry (populated above) so a newly
          // registered importer is accepted without editing this enum
          // (barwise-867).
          .enum(listImporters().map((f) => f.name) as [string, ...string[]])
          .describe(
            "Format of the source: 'ddl' for SQL DDL, 'openapi' for OpenAPI 3.x specs, "
              + "'norma' for NORMA .orm XML files, "
              + "'dbt' for dbt project directory, 'sql' for raw SQL files/directories, "
              + "'typescript' for TypeScript project directory, 'java' for Java project directory, "
              + "'kotlin' for Kotlin project directory",
          ),
        modelName: z
          .string()
          .optional()
          .describe("Name for the resulting ORM model (defaults to format-specific)"),
        dialect: z
          .enum(SQL_DIALECTS as unknown as [string, ...string[]])
          .optional()
          .describe("SQL dialect (for sql format). Auto-detected if omitted."),
      },
    },
    async ({ source, format, modelName, dialect }) => {
      return executeImportModel(source, format, modelName, dialect);
    },
  );
}

export async function executeImportModel(
  source: string,
  // Validated against the registry below, not a re-listed union: the
  // registry is the one owner of which importers exist (barwise-867).
  format: string,
  modelName?: string,
  dialect?: string,
): Promise<{ content: Array<{ type: "text"; text: string; }>; }> {
  // Get the importer from the unified registry
  const importFormat = getImporter(format);
  if (!importFormat) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Unknown import format "${format}". Supported formats: ${
            listImporters().map((f) => f.name).join(", ")
          }`,
        },
      ],
    };
  }

  // Build options
  const options: Record<string, unknown> = { modelName };
  if (dialect) {
    options["dialect"] = dialect;
  }
  if (format === "dbt") {
    // The tool layer (not core) reads the environment for dbt dialect
    // detection and passes it in explicitly.
    options["dbtTargetType"] = process.env["DBT_TARGET_TYPE"] ?? process.env["DBT_ADAPTER"];
    options["dbtProfilesHome"] = process.env["HOME"] ?? process.env["USERPROFILE"];
  }

  // Route based on input kind
  let result;
  if (importFormat.inputKind === "directory") {
    // Directory-based format: source is a path
    if (!importFormat.parseAsync) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Error: Format "${format}" is directory-based but does not support async parsing.`,
          },
        ],
      };
    }
    result = await importFormat.parseAsync(source, options);
  } else {
    // Text-based format: try parseAsync for directory paths first, then parse
    if (importFormat.parseAsync) {
      // Some text formats (sql) also support directories via parseAsync
      try {
        const { statSync } = await import("node:fs");
        const stat = statSync(source);
        if (stat.isDirectory()) {
          result = await importFormat.parseAsync(source, options);
        }
      } catch {
        // Not a directory or doesn't exist -- fall through to parse
      }
    }

    if (!result) {
      if (!importFormat.parse) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Format "${format}" does not support synchronous text parsing.`,
            },
          ],
        };
      }
      const input = readSource(source);
      result = importFormat.parse(input, options);
    }
  }

  // Serialize to YAML
  const yaml = serializer.serialize(result.model);

  // Format output with warnings
  let output = yaml;
  if (result.warnings.length > 0) {
    output += "\n\n# Import Warnings:\n";
    for (const warning of result.warnings) {
      output += `# - ${warning}\n`;
    }
  }

  output += `\n# Import confidence: ${result.confidence}\n`;
  output += `# Note: This is a draft model from ${format} import. Review and refine as needed.\n`;

  return {
    content: [{ type: "text" as const, text: output }],
  };
}
