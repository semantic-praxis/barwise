/**
 * Java format importer.
 *
 * Implements ImportFormat for Java projects. Analyzes Java source code
 * using LSP queries (when available) and regex-based extraction to
 * produce draft ORM models.
 *
 * Java-specific features:
 * - Bean Validation annotations (@NotNull, @Size, @Pattern, etc.)
 * - JPA/Hibernate annotations (@Entity, @ManyToOne, @Column, etc.)
 * - Enum types as value constraints
 * - Class hierarchies for subtype relationships
 */

import type { ImportFormat, ImportOptions, ImportResult } from "@barwise/core";
import { assembleJavaContext } from "../context/JvmContextAssembler.js";
import { LspManager } from "../lsp/LspManager.js";
import { defaultJavaConfig } from "../lsp/servers/java.js";
import type { CodeContext, CodeImportOptions, LspSession, LspSessionProvider } from "../types.js";
import { buildModelFromJvmContext } from "./jvmModelBuilder.js";

/**
 * Import format for Java projects.
 *
 * Given a workspace root, discovers Java source files, optionally
 * connects to Eclipse JDT Language Server for type resolution, and
 * extracts ORM-relevant patterns from the code.
 */
export class JavaImportFormat implements ImportFormat {
  readonly name = "java";
  readonly description = "Java project (annotations, types, validations)";
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
          language: "java",
          workspaceRoot: input,
          command: codeOptions.lspCommand.split(" ")[0]!,
          args: codeOptions.lspCommand.split(" ").slice(1),
        }
        : defaultJavaConfig(input);

      session = await manager.start(config);
    } catch (err) {
      warnings.push(
        `Could not start Java language server: ${
          err instanceof Error ? err.message : String(err)
        }. Falling back to regex-based analysis.`,
      );
    }

    let context: CodeContext;
    try {
      context = await assembleJavaContext(input, session, codeOptions);
    } finally {
      await manager.stopAll();
    }

    const modelName = codeOptions?.modelName ?? "Java Import";
    const model = buildModelFromJvmContext(context, modelName, warnings);

    const totalPatterns = context.types.length + context.validations.length
      + context.stateTransitions.length + context.annotations.length;
    const confidence = totalPatterns > 10 ? "high" : totalPatterns > 0 ? "medium" : "low";

    return { model, warnings, confidence };
  }
}
