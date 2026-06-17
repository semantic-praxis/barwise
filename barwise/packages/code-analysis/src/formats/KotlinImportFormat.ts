/**
 * Kotlin format importer.
 *
 * Implements ImportFormat for Kotlin projects. Analyzes Kotlin source code
 * using LSP queries (when available) and regex-based extraction to
 * produce draft ORM models.
 *
 * Kotlin-specific features:
 * - Sealed classes/interfaces for subtype hierarchies
 * - Data classes for entity types
 * - Bean Validation annotations (same as Java)
 * - JPA/Hibernate annotations (same as Java)
 */

import type { ImportFormat, ImportOptions, ImportResult } from "@barwise/core";
import { assembleKotlinContext } from "../context/JvmContextAssembler.js";
import { LspManager } from "../lsp/LspManager.js";
import { defaultKotlinConfig } from "../lsp/servers/kotlin.js";
import type { CodeContext, CodeImportOptions, LspSession, LspSessionProvider } from "../types.js";
import { buildModelFromJvmContext } from "./jvmModelBuilder.js";

/**
 * Import format for Kotlin projects.
 *
 * Given a workspace root, discovers Kotlin source files, optionally
 * connects to kotlin-language-server for type resolution, and
 * extracts ORM-relevant patterns from the code.
 */
export class KotlinImportFormat implements ImportFormat {
  readonly name = "kotlin";
  readonly description = "Kotlin project (annotations, sealed classes, validations)";
  readonly inputKind = "directory" as const;

  private readonly sessionProvider?: LspSessionProvider;

  constructor(sessionProvider?: LspSessionProvider) {
    this.sessionProvider = sessionProvider;
  }

  async parseAsync(input: string, options?: ImportOptions): Promise<ImportResult> {
    const codeOptions = options as CodeImportOptions | undefined;
    const warnings: string[] = [];

    let session: LspSession | null = null;
    const manager = new LspManager(this.sessionProvider);

    try {
      const config = codeOptions?.lspCommand
        ? {
          language: "kotlin",
          workspaceRoot: input,
          command: codeOptions.lspCommand.split(" ")[0]!,
          args: codeOptions.lspCommand.split(" ").slice(1),
        }
        : defaultKotlinConfig(input);

      session = await manager.start(config);
    } catch (err) {
      warnings.push(
        `Could not start Kotlin language server: ${
          err instanceof Error ? err.message : String(err)
        }. Falling back to regex-based analysis.`,
      );
    }

    let context: CodeContext;
    try {
      context = await assembleKotlinContext(input, session, codeOptions);
    } finally {
      await manager.stopAll();
    }

    const modelName = codeOptions?.modelName ?? "Kotlin Import";
    const model = buildModelFromJvmContext(context, modelName, warnings);

    const totalPatterns = context.types.length + context.validations.length
      + context.stateTransitions.length + context.annotations.length;
    const confidence = totalPatterns > 10 ? "high" : totalPatterns > 0 ? "medium" : "low";

    return { model, warnings, confidence };
  }
}
