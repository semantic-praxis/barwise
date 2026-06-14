/**
 * dbt schema YAML parser.
 *
 * Parses one or more dbt schema YAML strings into a DbtProjectDocument.
 * Handles both `models:` and `sources:` top-level keys. Extracts
 * standard tests (not_null, unique, accepted_values, relationships)
 * and preserves custom/macro tests for downstream mapping.
 *
 * dbt supports two test formats:
 *   - `tests:` (legacy, dbt < 1.8)
 *   - `data_tests:` (dbt >= 1.8)
 * Both are accepted by this parser.
 */

import { parse } from "yaml";
import type {
  DbtColumn,
  DbtModel,
  DbtProjectDocument,
  DbtSource,
  DbtSourceTable,
  DbtTest,
} from "./DbtSchemaTypes.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Error thrown when dbt schema YAML cannot be parsed.
 */
export class DbtParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DbtParseError";
  }
}

/**
 * Parse one or more dbt schema YAML strings into a single DbtProjectDocument.
 *
 * Each string represents the content of one `.yml` file from a dbt project.
 * Models and sources from all files are aggregated.
 */
export function parseDbtSchema(
  yamlContents: readonly string[],
): DbtProjectDocument {
  const allModels: DbtModel[] = [];
  const allSources: DbtSource[] = [];

  for (const content of yamlContents) {
    let doc: unknown;
    try {
      doc = parse(content);
    } catch (err) {
      throw new DbtParseError("Failed to parse YAML content", {
        cause: err,
      });
    }

    if (doc === null || doc === undefined || typeof doc !== "object") {
      // Empty or non-object YAML -- skip.
      continue;
    }

    const root = doc as Record<string, unknown>;

    // Parse models.
    if (Array.isArray(root.models)) {
      for (const rawModel of root.models) {
        if (rawModel && typeof rawModel === "object") {
          allModels.push(parseModel(rawModel as Record<string, unknown>));
        }
      }
    }

    // Parse sources.
    if (Array.isArray(root.sources)) {
      for (const rawSource of root.sources) {
        if (rawSource && typeof rawSource === "object") {
          allSources.push(parseSource(rawSource as Record<string, unknown>));
        }
      }
    }
  }

  return { models: allModels, sources: allSources };
}

// ---------------------------------------------------------------------------
// Model parsing
// ---------------------------------------------------------------------------

function parseModel(raw: Record<string, unknown>): DbtModel {
  const name = String(raw.name ?? "");
  const description = typeof raw.description === "string" ? raw.description : undefined;
  const columns = parseColumns(raw.columns);

  // Model-level tests: dbt >= 1.8 uses data_tests, older uses tests.
  const rawModelTests = raw.data_tests ?? raw.tests;
  const modelTests = Array.isArray(rawModelTests)
    ? rawModelTests.flatMap((t) => parseTest(t))
    : [];

  return { name, description, columns, modelTests };
}

// ---------------------------------------------------------------------------
// Column parsing
// ---------------------------------------------------------------------------

function parseColumns(raw: unknown): DbtColumn[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
    .map(parseColumn);
}

function parseColumn(raw: Record<string, unknown>): DbtColumn {
  const name = String(raw.name ?? "");
  const description = typeof raw.description === "string" ? raw.description : undefined;
  const dataType = typeof raw.data_type === "string" ? raw.data_type : undefined;

  // Column-level tests: dbt >= 1.8 uses data_tests, older uses tests.
  const rawTests = raw.data_tests ?? raw.tests;
  const tests: DbtTest[] = Array.isArray(rawTests)
    ? rawTests.flatMap((t) => parseTest(t))
    : [];

  return { name, description, dataType, tests };
}

// ---------------------------------------------------------------------------
// Test parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single test entry from YAML.
 *
 * dbt tests come in two forms:
 *   - String: "not_null", "unique"
 *   - Object: { accepted_values: { values: [...] } },
 *             { relationships: { to: "ref('x')", field: "y" } },
 *             { dbt_utils.expression_is_true: { expression: "..." } }
 */
function parseTest(raw: unknown): DbtTest[] {
  if (typeof raw === "string") {
    return parseStringTest(raw);
  }

  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return parseObjectTest(raw as Record<string, unknown>);
  }

  return [];
}

function parseStringTest(name: string): DbtTest[] {
  switch (name) {
    case "not_null":
      return [{ type: "not_null" }];
    case "unique":
      return [{ type: "unique" }];
    default:
      // Unknown string test -> custom.
      return [{ type: "custom", name, config: {} }];
  }
}

function parseObjectTest(raw: Record<string, unknown>): DbtTest[] {
  const tests: DbtTest[] = [];

  for (const [key, value] of Object.entries(raw)) {
    const config = value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

    switch (key) {
      case "not_null":
        tests.push({ type: "not_null" });
        break;

      case "unique":
        tests.push({ type: "unique" });
        break;

      case "accepted_values": {
        const values = Array.isArray(config.values)
          ? config.values.map(String)
          : [];
        tests.push({ type: "accepted_values", values });
        break;
      }

      case "relationships": {
        const toRaw = String(config.to ?? "");
        const field = String(config.field ?? "");
        const to = extractRefModelName(toRaw);
        tests.push({ type: "relationships", to, field });
        break;
      }

      default:
        // Custom/macro test.
        tests.push({ type: "custom", name: key, config });
        break;
    }
  }

  return tests;
}

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

function parseSource(raw: Record<string, unknown>): DbtSource {
  const name = String(raw.name ?? "");
  const description = typeof raw.description === "string" ? raw.description : undefined;

  const tables: DbtSourceTable[] = [];
  if (Array.isArray(raw.tables)) {
    for (const rawTable of raw.tables) {
      if (rawTable && typeof rawTable === "object") {
        tables.push(parseSourceTable(rawTable as Record<string, unknown>));
      }
    }
  }

  return { name, description, tables };
}

function parseSourceTable(raw: Record<string, unknown>): DbtSourceTable {
  const name = String(raw.name ?? "");
  const description = typeof raw.description === "string" ? raw.description : undefined;
  const columns = parseColumns(raw.columns);
  return { name, description, columns };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a model name from a dbt ref string.
 * Handles: ref('model_name'), ref("model_name"), ref('pkg', 'model_name')
 */
function extractRefModelName(refStr: string): string {
  // Match ref('name') or ref("name") -- take the last quoted argument.
  const match = refStr.match(/ref\(\s*(?:'[^']*'\s*,\s*)?['"]([^'"]+)['"]\s*\)/);
  if (match) {
    return match[1]!;
  }
  // If no ref() wrapper, return as-is (might already be a plain name).
  return refStr;
}
