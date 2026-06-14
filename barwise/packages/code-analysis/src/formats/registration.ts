/**
 * Format registration for code-analysis importers.
 *
 * Registers TypeScript (and in Phase 4, Java/Kotlin) format importers
 * with the unified format registry from @barwise/core.
 */

import { type FormatDescriptor, formatRegistry, registerFormat } from "@barwise/core";
import type { LspSessionProvider } from "../types.js";
import { JavaImportFormat } from "./JavaImportFormat.js";
import { KotlinImportFormat } from "./KotlinImportFormat.js";
import { TypeScriptImportFormat } from "./TypeScriptImportFormat.js";

/**
 * TypeScript format descriptor.
 */
export function createTypeScriptFormat(sessionProvider?: LspSessionProvider): FormatDescriptor {
  return {
    name: "typescript",
    description: "TypeScript project (types, validations, state machines)",
    importer: new TypeScriptImportFormat(sessionProvider),
  };
}

/**
 * Java format descriptor.
 */
export function createJavaFormat(sessionProvider?: LspSessionProvider): FormatDescriptor {
  return {
    name: "java",
    description: "Java project (annotations, types, validations)",
    importer: new JavaImportFormat(sessionProvider),
  };
}

/**
 * Kotlin format descriptor.
 */
export function createKotlinFormat(sessionProvider?: LspSessionProvider): FormatDescriptor {
  return {
    name: "kotlin",
    description: "Kotlin project (annotations, sealed classes, validations)",
    importer: new KotlinImportFormat(sessionProvider),
  };
}

/**
 * Register all code-analysis format importers with the unified registry.
 *
 * Call this at tool startup (CLI main, MCP server init, etc.) alongside
 * registerStandardFormats(). Safe to call multiple times -- skips
 * formats that are already registered.
 */
export function registerCodeFormats(sessionProvider?: LspSessionProvider): void {
  const formats: readonly FormatDescriptor[] = [
    createTypeScriptFormat(sessionProvider),
    createJavaFormat(sessionProvider),
    createKotlinFormat(sessionProvider),
  ];

  for (const descriptor of formats) {
    if (!formatRegistry.get(descriptor.name)) {
      registerFormat(descriptor);
    }
  }
}
