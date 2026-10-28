/**
 * OpenAPI 3.0 renderer.
 *
 * Produces an OpenAPI 3.0.0 specification from a RelationalSchema.
 * Each table becomes a component schema with JSON Schema properties,
 * and CRUD paths are generated for each resource.
 *
 * Type mapping:
 *   SQL TEXT / VARCHAR     -> { type: "string" }
 *   SQL INTEGER / INT      -> { type: "integer" }
 *   SQL DECIMAL / FLOAT    -> { type: "number" }
 *   SQL BOOLEAN            -> { type: "boolean" }
 *   SQL DATE               -> { type: "string", format: "date" }
 *   SQL TIME               -> { type: "string", format: "time" }
 *   SQL DATETIME/TIMESTAMP -> { type: "string", format: "date-time" }
 *   SQL UUID               -> { type: "string", format: "uuid" }
 *   SQL BINARY / BLOB      -> { type: "string", format: "binary" }
 *   Fallback               -> { type: "string" }
 *
 * Nullable columns use the OpenAPI 3.0 `nullable: true` pattern.
 * Foreign key columns reference their target schema via `$ref`.
 */

import { renderPopulationAsOpenApiExamples } from "../../export/populationRenderer.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { RelationalSchema, Table } from "../RelationalSchema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A JSON Schema property type (subset used by OpenAPI). */
export interface OpenApiPropertyType {
  readonly type?: string;
  readonly format?: string;
  readonly nullable?: true;
  readonly $ref?: string;
  readonly example?: unknown;
}

/** Options for OpenAPI rendering. */
export interface OpenApiRenderOptions {
  /** API title (default: "ORM API"). */
  readonly title?: string;
  /** API version string (default: "1.0.0"). */
  readonly version?: string;
  /** Base path prefix for all endpoints (default: "/"). */
  readonly basePath?: string;
  /** Include population examples in schemas (default: true). */
  readonly includeExamples?: boolean;
}

/** The complete OpenAPI specification document. */
export interface OpenApiSpec {
  readonly openapi: "3.0.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
  };
  readonly paths: Record<string, unknown>;
  readonly components: {
    readonly schemas: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render a RelationalSchema as an OpenAPI 3.0.0 specification.
 *
 * @param schema - The relational schema to render
 * @param optionsOrModel - Either rendering options OR the source ORM model (for backward compatibility)
 * @param maybeOptions - Rendering options (when second param is a model)
 */
export function renderOpenApi(
  schema: RelationalSchema,
  optionsOrModel?: OpenApiRenderOptions | OrmModel,
  maybeOptions?: OpenApiRenderOptions,
): OpenApiSpec {
  // Handle overloaded parameters for backward compatibility
  let options: OpenApiRenderOptions;
  let model: OrmModel | undefined;

  if (!optionsOrModel) {
    options = {};
    model = undefined;
  } else if ("objectTypes" in optionsOrModel) {
    // Second param is a model
    model = optionsOrModel;
    options = maybeOptions ?? {};
  } else {
    // Second param is options (original signature)
    options = optionsOrModel;
    model = undefined;
  }
  const title = options.title ?? "ORM API";
  const version = options.version ?? "1.0.0";
  const basePath = normalizePath(options.basePath ?? "/");
  const includeExamples = options.includeExamples ?? true;

  // Get population examples if requested and model is provided
  const examples = includeExamples && model
    ? renderPopulationAsOpenApiExamples(model)
    : new Map<string, Record<string, unknown>>();

  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (const table of schema.tables) {
    const schemaName = toPascalCase(table.name);
    const example = examples.get(schemaName);
    schemas[schemaName] = renderComponentSchema(table, example);

    const resourcePath = `${basePath}${toKebabCase(table.name)}`;
    // The path's segments and the operations' parameters come from this one
    // list; a step that renames a key column (barwise-9g3) must apply here.
    const keyParams = primaryKeyParams(table);
    const idPath = `${resourcePath}/${keyParams.map((name) => `{${name}}`).join("/")}`;

    paths[resourcePath] = renderCollectionPaths(schemaName);
    paths[idPath] = renderItemPaths(schemaName, keyParams);
  }

  return {
    openapi: "3.0.0",
    info: { title, version },
    paths,
    components: { schemas },
  };
}

/**
 * Serialize an OpenAPI spec as formatted JSON.
 */
export function openApiToJson(spec: OpenApiSpec): string {
  return JSON.stringify(spec, null, 2);
}

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

function renderComponentSchema(
  table: Table,
  example?: Record<string, unknown>,
): Record<string, unknown> {
  const properties: Record<string, OpenApiPropertyType> = {};
  const required: string[] = [];

  // Build FK lookup: column name -> referenced table
  const fkMap = new Map<string, string>();
  for (const fk of table.foreignKeys) {
    for (const colName of fk.columnNames) {
      fkMap.set(colName, fk.referencedTable);
    }
  }

  for (const col of table.columns) {
    const refTable = fkMap.get(col.name);
    if (refTable) {
      // FK column: use $ref to the referenced schema.
      const prop: OpenApiPropertyType = {
        $ref: `#/components/schemas/${toPascalCase(refTable)}`,
      };
      properties[col.name] = prop;
    } else {
      const prop = sqlTypeToOpenApi(col.dataType, col.nullable);
      // Add example value if available
      if (example && example[col.name] !== undefined) {
        (prop as { example: unknown; }).example = example[col.name];
      }
      properties[col.name] = prop;
    }

    if (!col.nullable) {
      required.push(col.name);
    }
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  // Add example object at schema level if available
  if (example && Object.keys(example).length > 0) {
    schema.example = example;
  }

  return schema;
}

// ---------------------------------------------------------------------------
// Path generation
// ---------------------------------------------------------------------------

function renderCollectionPaths(schemaName: string): Record<string, unknown> {
  return {
    get: {
      summary: `List all ${schemaName} resources`,
      operationId: `list${schemaName}`,
      responses: {
        "200": {
          description: `A list of ${schemaName} resources`,
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: `#/components/schemas/${schemaName}` },
              },
            },
          },
        },
      },
    },
    post: {
      summary: `Create a ${schemaName}`,
      operationId: `create${schemaName}`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${schemaName}` },
          },
        },
      },
      responses: {
        "201": {
          description: `${schemaName} created`,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schemaName}` },
            },
          },
        },
      },
    },
  };
}

function renderItemPaths(
  schemaName: string,
  paramNames: readonly string[],
): Record<string, unknown> {
  // A fresh list per operation, so a caller editing one does not edit all three.
  const parameters = () =>
    paramNames.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));

  return {
    get: {
      summary: `Get a ${schemaName} by ID`,
      operationId: `get${schemaName}`,
      parameters: parameters(),
      responses: {
        "200": {
          description: `A ${schemaName} resource`,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schemaName}` },
            },
          },
        },
        "404": { description: `${schemaName} not found` },
      },
    },
    put: {
      summary: `Update a ${schemaName}`,
      operationId: `update${schemaName}`,
      parameters: parameters(),
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${schemaName}` },
          },
        },
      },
      responses: {
        "200": {
          description: `${schemaName} updated`,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schemaName}` },
            },
          },
        },
        "404": { description: `${schemaName} not found` },
      },
    },
    delete: {
      summary: `Delete a ${schemaName}`,
      operationId: `delete${schemaName}`,
      parameters: parameters(),
      responses: {
        "204": { description: `${schemaName} deleted` },
        "404": { description: `${schemaName} not found` },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Type conversion
// ---------------------------------------------------------------------------

/**
 * Map a SQL data type string to an OpenAPI / JSON Schema type.
 */
function sqlTypeToOpenApi(
  sqlType: string,
  nullable: boolean,
): OpenApiPropertyType {
  const normalized = sqlType.toUpperCase().replace(/\(.*\)/, "").trim();

  let base: OpenApiPropertyType;

  switch (normalized) {
    case "TEXT":
    case "VARCHAR":
      base = { type: "string" };
      break;

    case "INTEGER":
    case "INT":
    case "BIGINT":
    case "AUTO_COUNTER":
      base = { type: "integer" };
      break;

    case "DECIMAL":
    case "NUMERIC":
    case "FLOAT":
    case "DOUBLE":
      base = { type: "number" };
      break;

    case "BOOLEAN":
    case "BOOL":
      base = { type: "boolean" };
      break;

    case "DATE":
      base = { type: "string", format: "date" };
      break;

    case "TIME":
      base = { type: "string", format: "time" };
      break;

    case "DATETIME":
    case "TIMESTAMP":
      base = { type: "string", format: "date-time" };
      break;

    case "UUID":
      base = { type: "string", format: "uuid" };
      break;

    case "BINARY":
    case "BLOB":
      base = { type: "string", format: "binary" };
      break;

    default:
      base = { type: "string" };
      break;
  }

  if (nullable) {
    return { ...base, nullable: true };
  }
  return base;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/** Convert a snake_case name to PascalCase. */
function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/** Convert a snake_case name to kebab-case for URL paths. */
function toKebabCase(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
}

/** Normalize a base path to ensure it ends with "/" (or is just "/"). */
function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  if (!path.endsWith("/")) {
    path = path + "/";
  }
  return path;
}

/**
 * The item path's parameters: every primary-key column, in key order, so
 * a key over several columns addresses one row rather than many
 * (openapi-composite-key-path.spec.md, barwise-pki). "id" when the table
 * has no key, as before.
 */
function primaryKeyParams(table: Table): readonly string[] {
  const key = table.primaryKey.columnNames;
  return key.length > 0 ? key : ["id"];
}
