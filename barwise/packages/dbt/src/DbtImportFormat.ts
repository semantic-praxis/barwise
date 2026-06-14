/**
 * dbt import format.
 *
 * Directory-based importer that reads dbt schema YAML files and SQL
 * models from a project directory and produces an ORM model. Wraps
 * the existing DbtProjectImporter (YAML) with filesystem discovery,
 * and optionally compiles and analyzes SQL models through the cascade
 * parser for additional constraint extraction.
 *
 * Accepts a directory path as input. Discovers all `.yml` and `.yaml`
 * files under `models/` (or the project root if no `models/` directory
 * exists). Reads and parses them through the existing dbt pipeline.
 * Then compiles SQL files (via dbt compile or stub Jinja rendering)
 * and extracts JOIN, WHERE, CASE, and constraint patterns.
 */

import {
  type ImportFormat,
  type ImportOptions,
  type ImportResult,
  parseSqlFile,
  type SqlDialect,
} from "@barwise/core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { type DbtDialectOptions, detectDbtDialect } from "./DbtDialectDetector.js";
import { importDbtProject } from "./DbtProjectImporter.js";
import { compileDbtSql } from "./DbtSqlCompiler.js";

/**
 * Recursively find all .yml and .yaml files under a directory.
 */
function findYamlFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      // Skip common non-model directories.
      if (
        entry === "node_modules"
        || entry === ".git"
        || entry === "target"
        || entry === "dbt_packages"
        || entry === "logs"
      ) {
        continue;
      }
      results.push(...findYamlFiles(fullPath));
    } else if (/\.ya?ml$/i.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Filter YAML files to only those containing dbt schema content
 * (models: or sources: top-level keys).
 */
function isDbtSchemaYaml(content: string): boolean {
  // Quick check: does the file contain models: or sources: at the top level?
  // This avoids parsing non-schema YAML (dbt_project.yml, profiles.yml, etc.)
  return /^(?:models|sources)\s*:/m.test(content);
}

/**
 * dbt import format: reads dbt project directories and produces ORM models
 * from schema YAML files.
 */
export class DbtImportFormat implements ImportFormat {
  readonly name = "dbt";
  readonly description = "Import ORM model from a dbt project (schema YAML + SQL models)";
  readonly inputKind = "directory" as const;

  async parseAsync(input: string, options?: ImportOptions): Promise<ImportResult> {
    const projectDir = resolve(input);
    const warnings: string[] = [];

    // Look for a models/ directory; fall back to project root.
    const modelsDir = join(projectDir, "models");
    let searchDir: string;
    try {
      const stat = statSync(modelsDir);
      searchDir = stat.isDirectory() ? modelsDir : projectDir;
    } catch {
      searchDir = projectDir;
    }

    // Discover YAML files.
    const yamlPaths = findYamlFiles(searchDir);
    if (yamlPaths.length === 0) {
      warnings.push(
        `No .yml/.yaml files found under "${searchDir}". `
          + "Ensure the path points to a dbt project directory.",
      );
      const { OrmModel } = await import("@barwise/core");
      return {
        model: new OrmModel({ name: options?.modelName ?? "dbt Import" }),
        warnings,
        confidence: "low",
      };
    }

    // Read and filter to dbt schema files.
    const yamlContents: string[] = [];
    for (const yamlPath of yamlPaths) {
      try {
        const content = readFileSync(yamlPath, "utf-8");
        if (isDbtSchemaYaml(content)) {
          yamlContents.push(content);
        }
      } catch (err) {
        warnings.push(
          `Failed to read "${yamlPath}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (yamlContents.length === 0) {
      warnings.push(
        `Found ${yamlPaths.length} YAML file(s) but none contain dbt schema definitions `
          + "(models: or sources: top-level keys).",
      );
      const { OrmModel } = await import("@barwise/core");
      return {
        model: new OrmModel({ name: options?.modelName ?? "dbt Import" }),
        warnings,
        confidence: "low",
      };
    }

    // Delegate to the existing dbt project importer (YAML-based).
    const result = importDbtProject(yamlContents);

    // Override model name if provided.
    if (options?.modelName) {
      (result.model as { name: string; }).name = options.modelName;
    }

    // SQL analysis: compile and parse SQL files for additional patterns.
    // Dialect-detection inputs come from the caller (the tool layer reads
    // the environment), never from process.env in core.
    const dialectOptions: DbtDialectOptions = {
      dialect: options?.["dialect"] as SqlDialect | undefined,
      targetType: options?.["dbtTargetType"] as string | undefined,
      homeDir: options?.["dbtProfilesHome"] as string | undefined,
    };
    const sqlPatternCount = this.analyzeSqlFiles(projectDir, warnings, dialectOptions);

    // Convert report entries to warnings for the ImportResult interface.
    const reportWarnings = result.report.entries
      .filter((e) => e.severity === "warning" || e.severity === "gap")
      .map((e) => `[${e.severity}] ${e.modelName}: ${e.message}`);

    if (sqlPatternCount > 0) {
      warnings.push(
        `SQL analysis: found ${sqlPatternCount} pattern(s) from compiled SQL models`,
      );
    }

    return {
      model: result.model,
      warnings: [...warnings, ...reportWarnings],
      confidence: "medium",
    };
  }

  /**
   * Analyze SQL files in the dbt project.
   *
   * Compiles Jinja-templated SQL via dbt compile output or stub rendering,
   * then extracts patterns through the SQL cascade parser.
   *
   * @returns Number of patterns found
   */
  private analyzeSqlFiles(
    projectDir: string,
    warnings: string[],
    dialectOptions: DbtDialectOptions,
  ): number {
    try {
      const dialect = detectDbtDialect(projectDir, dialectOptions);
      const compiledFiles = compileDbtSql(projectDir);

      if (compiledFiles.length === 0) {
        return 0;
      }

      let totalPatterns = 0;
      for (const file of compiledFiles) {
        const result = parseSqlFile(file.sql, file.sourcePath, dialect);
        totalPatterns += result.patterns.length;
      }

      return totalPatterns;
    } catch (err) {
      warnings.push(
        `SQL analysis skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }
}
