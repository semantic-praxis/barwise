/**
 * dbt-to-ORM mapper.
 *
 * Maps a DbtProjectDocument into an OrmModel, inferring ORM 2 concepts
 * from dbt schema YAML structure:
 *
 *   - Models with a unique+not_null column become entity types
 *   - Non-FK columns become value types with binary fact types
 *   - Columns with relationship tests become entity-to-entity fact types
 *   - not_null tests become mandatory constraints
 *   - unique tests become internal uniqueness constraints
 *   - accepted_values tests become value constraints
 *   - Descriptions are used when present; inferred from naming when absent
 *   - Recognizable custom tests (expression_is_true) noted in report
 *
 * Mapping proceeds in phases to respect OrmModel dependency ordering:
 *   Phase 1: Identify entity types from models
 *   Phase 2: Create value types for non-FK columns
 *   Phase 3: Create fact types with roles and constraints
 *   Phase 4: Apply descriptions (explicit or inferred)
 */

import {
  type ConceptualDataTypeName,
  type Constraint,
  type DataTypeDef,
  OrmModel,
} from "@barwise/core";
import type { DbtImportReport } from "./DbtImportReport.js";
import { ReportBuilder } from "./DbtImportReport.js";
import type { DbtColumn, DbtProjectDocument, DbtTest } from "./DbtSchemaTypes.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Error thrown when dbt-to-ORM mapping fails.
 */
export class DbtMappingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DbtMappingError";
  }
}

/**
 * Result of mapping a DbtProjectDocument to an OrmModel.
 */
export interface DbtMapResult {
  readonly model: OrmModel;
  readonly report: DbtImportReport;
}

/**
 * Map a parsed dbt project document into an OrmModel with a gap report.
 */
export function mapDbtToOrm(doc: DbtProjectDocument): DbtMapResult {
  const mapper = new DbtMapper(doc);
  return mapper.map();
}

// ---------------------------------------------------------------------------
// Internal mapper
// ---------------------------------------------------------------------------

/** Tracks a column identified as the PK of a model. */
interface PkInfo {
  readonly columnName: string;
  readonly modelName: string;
}

/** Tracks a relationship (FK) column. */
interface RelationshipInfo {
  readonly columnName: string;
  readonly targetModelName: string;
  readonly targetField: string;
}

class DbtMapper {
  private readonly doc: DbtProjectDocument;
  private readonly report: ReportBuilder;
  private readonly model: OrmModel;

  /** model name -> PK info (if identifiable). */
  private readonly pkMap = new Map<string, PkInfo>();
  /** model name -> relationship columns. */
  private readonly relMap = new Map<string, RelationshipInfo[]>();
  /** model name -> entity type id in OrmModel. */
  private readonly entityIdMap = new Map<string, string>();
  /** "modelName::columnName" -> value type id. */
  private readonly valueTypeIdMap = new Map<string, string>();
  /** Source table data types: "sourceName.tableName.columnName" -> data_type string. */
  private readonly sourceDataTypes = new Map<string, string>();
  /** Column-level source data types: "columnName" -> data_type string (if unambiguous). */
  private readonly sourceColumnTypes = new Map<string, string | null>();

  constructor(doc: DbtProjectDocument) {
    this.doc = doc;
    this.report = new ReportBuilder();
    this.model = new OrmModel({ name: "dbt Import" });
  }

  map(): DbtMapResult {
    this.indexSourceDataTypes();
    this.analyzeModels();
    this.phase1CreateEntityTypes();
    this.phase2CreateValueTypes();
    this.phase3CreateFactTypes();
    return { model: this.model, report: this.report.build() };
  }

  // -----------------------------------------------------------------------
  // Index source data types
  // -----------------------------------------------------------------------

  private indexSourceDataTypes(): void {
    for (const source of this.doc.sources) {
      for (const table of source.tables) {
        for (const col of table.columns) {
          if (col.dataType) {
            const key = `${source.name}.${table.name}.${col.name}`;
            this.sourceDataTypes.set(key, col.dataType);

            // Build column-level index. If the same column name appears
            // across multiple source tables with different types, mark it
            // as ambiguous (null) so we don't guess wrong.
            const existing = this.sourceColumnTypes.get(col.name);
            if (existing === undefined) {
              // First time seeing this column name.
              this.sourceColumnTypes.set(col.name, col.dataType);
            } else if (existing !== null && existing !== col.dataType) {
              // Conflicting types -- mark ambiguous.
              this.sourceColumnTypes.set(col.name, null);
            }
            // If existing === col.dataType, no change needed (consistent).
          }
        }
      }
    }
  }

  /**
   * Look up a column's data type from source definitions.
   * Returns the type string if unambiguously found, undefined otherwise.
   */
  private resolveSourceColumnType(columnName: string): string | undefined {
    const sourceType = this.sourceColumnTypes.get(columnName);
    // null means ambiguous (multiple sources disagree), undefined means not found.
    if (sourceType === null || sourceType === undefined) return undefined;
    return sourceType;
  }

  // -----------------------------------------------------------------------
  // Analysis: identify PKs, FKs, and custom tests
  // -----------------------------------------------------------------------

  private analyzeModels(): void {
    for (const m of this.doc.models) {
      // Find PK column: has both unique and not_null tests.
      const pkCol = m.columns.find(
        (c) => hasTest(c, "unique") && hasTest(c, "not_null"),
      );

      if (pkCol) {
        this.pkMap.set(m.name, {
          columnName: pkCol.name,
          modelName: m.name,
        });
        this.report.info(
          "identifier",
          m.name,
          `Primary identifier "${pkCol.name}" detected from unique + not_null tests.`,
          pkCol.name,
        );
      } else {
        this.report.gap(
          "identifier",
          m.name,
          `No column with both unique and not_null tests found. Cannot determine primary identifier.`,
        );
      }

      // Find relationship columns.
      const rels: RelationshipInfo[] = [];
      for (const col of m.columns) {
        const relTest = findRelationshipTest(col);
        if (relTest) {
          rels.push({
            columnName: col.name,
            targetModelName: relTest.to,
            targetField: relTest.field,
          });
        }
      }
      if (rels.length > 0) {
        this.relMap.set(m.name, rels);
      }

      // Report custom tests.
      for (const col of m.columns) {
        for (const test of col.tests) {
          if (test.type === "custom") {
            this.report.warning(
              "macro",
              m.name,
              `Custom test "${test.name}" on column "${col.name}" -- manual review needed to determine if this implies an ORM constraint.`,
              col.name,
            );
          }
        }
      }

      // Report model-level custom tests.
      for (const test of m.modelTests) {
        if (test.type === "custom") {
          this.report.warning(
            "macro",
            m.name,
            `Model-level custom test "${test.name}" -- manual review needed.`,
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Phase 1: Create entity types
  // -----------------------------------------------------------------------

  private phase1CreateEntityTypes(): void {
    for (const m of this.doc.models) {
      const pk = this.pkMap.get(m.name);
      if (!pk) continue; // Skip models without identifiable PK.

      const entityName = toPascalCase(m.name);
      const refMode = pk.columnName;

      // Resolve description.
      const description = m.description ?? inferModelDescription(m.name);
      const descSource = m.description ? "explicit" : "inferred";

      const ot = this.model.addObjectType({
        name: entityName,
        kind: "entity",
        referenceMode: refMode,
        definition: description,
      });

      this.entityIdMap.set(m.name, ot.id);

      if (descSource === "inferred") {
        this.report.warning(
          "description",
          m.name,
          `No model description provided. Inferred: "${description}"`,
        );
      } else {
        this.report.info(
          "description",
          m.name,
          `Model description used from YAML.`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Phase 2: Create value types for non-FK, non-PK columns
  // -----------------------------------------------------------------------

  private phase2CreateValueTypes(): void {
    for (const m of this.doc.models) {
      const entityId = this.entityIdMap.get(m.name);
      if (!entityId) continue;

      const pk = this.pkMap.get(m.name);
      const rels = this.relMap.get(m.name) ?? [];
      const relColNames = new Set(rels.map((r) => r.columnName));

      for (const col of m.columns) {
        // Skip PK column and FK columns.
        if (col.name === pk?.columnName) continue;
        if (relColNames.has(col.name)) continue;

        const vtName = toPascalCase(col.name);

        // Check if we already created this value type (shared across models).
        const existingVt = this.model.getObjectTypeByName(vtName);
        if (existingVt) {
          // Reuse existing value type.
          this.valueTypeIdMap.set(`${m.name}::${col.name}`, existingVt.id);
          continue;
        }

        // Resolve data type: prefer model column, fall back to source.
        let rawDataType = col.dataType;
        let dataTypeSource: "model" | "source" | "none" = "none";

        if (rawDataType) {
          dataTypeSource = "model";
        } else {
          const sourceType = this.resolveSourceColumnType(col.name);
          if (sourceType) {
            rawDataType = sourceType;
            dataTypeSource = "source";
          }
        }

        const dataType = resolveDataType(rawDataType);

        // Resolve description.
        const description = col.description ?? inferColumnDescription(col.name, m.name);
        const descSource = col.description ? "explicit" : "inferred";

        const vt = this.model.addObjectType({
          name: vtName,
          kind: "value",
          definition: description,
          dataType,
        });

        this.valueTypeIdMap.set(`${m.name}::${col.name}`, vt.id);

        if (descSource === "inferred") {
          this.report.warning(
            "description",
            m.name,
            `No description for column "${col.name}". Inferred: "${description}"`,
            col.name,
          );
        }

        if (dataTypeSource === "model") {
          this.report.info(
            "data_type",
            m.name,
            `Data type "${col.dataType}" resolved for column "${col.name}".`,
            col.name,
          );
        } else if (dataTypeSource === "source") {
          this.report.info(
            "data_type",
            m.name,
            `Data type "${rawDataType}" resolved for column "${col.name}" from source definitions.`,
            col.name,
          );
        } else {
          this.report.gap(
            "data_type",
            m.name,
            `No data_type for column "${col.name}" in model or source definitions.`,
            col.name,
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Phase 3: Create fact types with constraints
  // -----------------------------------------------------------------------

  private phase3CreateFactTypes(): void {
    for (const m of this.doc.models) {
      const entityId = this.entityIdMap.get(m.name);
      if (!entityId) continue;

      const pk = this.pkMap.get(m.name);
      const rels = this.relMap.get(m.name) ?? [];
      const relColNames = new Set(rels.map((r) => r.columnName));

      // Create fact types for value columns.
      for (const col of m.columns) {
        if (col.name === pk?.columnName) continue;
        if (relColNames.has(col.name)) continue;

        const vtId = this.valueTypeIdMap.get(`${m.name}::${col.name}`);
        if (!vtId) continue;

        const entityName = toPascalCase(m.name);
        const vtName = toPascalCase(col.name);
        const factName = `${entityName} has ${vtName}`;

        const role1Id = `${factName}::role1`;
        const role2Id = `${factName}::role2`;

        // Build constraints from tests.
        const constraints = buildConstraints(col, role1Id, role2Id, this.report, m.name);

        this.model.addFactType({
          name: factName,
          roles: [
            { id: role1Id, name: "has", playerId: entityId },
            { id: role2Id, name: "is of", playerId: vtId },
          ],
          readings: [`{0} has {1}`, `{1} is of {0}`],
          constraints,
        });
      }

      // Create fact types for FK (relationship) columns.
      for (const rel of rels) {
        const targetEntityId = this.entityIdMap.get(rel.targetModelName);
        if (!targetEntityId) {
          this.report.gap(
            "relationship",
            m.name,
            `Relationship column "${rel.columnName}" references model "${rel.targetModelName}" which has no identifiable PK -- skipped.`,
            rel.columnName,
          );
          continue;
        }

        // Resolve the target model name to find the staging vs. mart name.
        // dbt refs might point to staging (stg_customers) but we want the
        // entity name (Customer). Try the target model name directly first.
        const sourceEntityName = toPascalCase(m.name);
        const targetEntityName = toPascalCase(rel.targetModelName);
        const factName = `${sourceEntityName} has ${targetEntityName}`;

        const role1Id = `${factName}::role1`;
        const role2Id = `${factName}::role2`;

        // FK column: find the column to get its tests.
        const fkCol = m.columns.find((c) => c.name === rel.columnName);
        const isMandatory = fkCol ? hasTest(fkCol, "not_null") : false;

        const constraints: Constraint[] = [
          // The FK side (role2) gets uniqueness -- each target entity appears
          // at most once per source entity in this relationship.
          // This is a heuristic: many-to-one is the common case.
          { type: "internal_uniqueness", roleIds: [role2Id] },
        ];

        if (isMandatory) {
          constraints.push({ type: "mandatory", roleId: role2Id });
        }

        this.model.addFactType({
          name: factName,
          roles: [
            { id: role1Id, name: "has", playerId: targetEntityId },
            { id: role2Id, name: "is of", playerId: entityId },
          ],
          readings: [
            `{0} has {1}`,
            `{1} is of {0}`,
          ],
          constraints,
        });

        this.report.info(
          "relationship",
          m.name,
          `Relationship "${rel.columnName}" -> "${rel.targetModelName}.${rel.targetField}" mapped as many-to-one fact type.`,
          rel.columnName,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Constraint building
// ---------------------------------------------------------------------------

function buildConstraints(
  col: DbtColumn,
  role1Id: string,
  role2Id: string,
  report: ReportBuilder,
  modelName: string,
): Constraint[] {
  const constraints: Constraint[] = [];

  // Entity has Value: uniqueness on role1 means each entity has at most one value.
  // This is the default for value-type attributes.
  constraints.push({ type: "internal_uniqueness", roleIds: [role1Id] });

  // not_null on the column -> mandatory on role1 (entity must have this value).
  if (hasTest(col, "not_null")) {
    constraints.push({ type: "mandatory", roleId: role1Id });
  }

  // unique on a non-PK column -> the value is unique across entities
  // (i.e., each value belongs to at most one entity).
  if (hasTest(col, "unique")) {
    constraints.push({ type: "internal_uniqueness", roleIds: [role2Id] });
  }

  // accepted_values -> value constraint on the value type's role.
  const avTest = col.tests.find(
    (t): t is Extract<DbtTest, { type: "accepted_values"; }> => t.type === "accepted_values",
  );
  if (avTest) {
    if (avTest.values.length > 0) {
      constraints.push({
        type: "value_constraint",
        roleId: role2Id,
        values: avTest.values as string[],
      });
    } else {
      report.warning(
        "constraint",
        modelName,
        `accepted_values test on column "${col.name}" has an empty values list -- no value constraint generated. Check the dbt schema YAML.`,
        col.name,
      );
    }
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function hasTest(col: DbtColumn, testType: string): boolean {
  return col.tests.some((t) => t.type === testType);
}

function findRelationshipTest(
  col: DbtColumn,
): Extract<DbtTest, { type: "relationships"; }> | undefined {
  return col.tests.find(
    (t): t is Extract<DbtTest, { type: "relationships"; }> => t.type === "relationships",
  );
}

// ---------------------------------------------------------------------------
// Data type resolution
// ---------------------------------------------------------------------------

const SQL_TYPE_MAP: Record<string, ConceptualDataTypeName> = {
  text: "text",
  varchar: "text",
  "character varying": "text",
  string: "text",
  int: "integer",
  integer: "integer",
  bigint: "integer",
  smallint: "integer",
  number: "decimal",
  numeric: "decimal",
  decimal: "decimal",
  float: "float",
  double: "float",
  "double precision": "float",
  real: "float",
  boolean: "boolean",
  bool: "boolean",
  date: "date",
  time: "time",
  datetime: "datetime",
  timestamp: "timestamp",
  "timestamp_ntz": "timestamp",
  "timestamp_ltz": "timestamp",
  "timestamp_tz": "timestamp",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamp",
  binary: "binary",
  varbinary: "binary",
  bytes: "binary",
  uuid: "uuid",
};

function resolveDataType(rawType: string | undefined): DataTypeDef | undefined {
  if (!rawType) return undefined;

  const normalized = rawType.toLowerCase().replace(/\(.*\)/, "").trim();
  const conceptual = SQL_TYPE_MAP[normalized];

  if (!conceptual) return undefined;

  // Extract length/scale from parenthesized suffix.
  const parenMatch = rawType.match(/\((\d+)(?:\s*,\s*(\d+))?\)/);
  const length = parenMatch ? parseInt(parenMatch[1]!, 10) : undefined;
  const scale = parenMatch?.[2] ? parseInt(parenMatch[2], 10) : undefined;

  return { name: conceptual, length, scale };
}

// ---------------------------------------------------------------------------
// Name inference
// ---------------------------------------------------------------------------

/**
 * Convert a snake_case dbt name to PascalCase.
 * Strips common prefixes like "stg_".
 */
function toPascalCase(name: string): string {
  // Strip common dbt prefixes.
  let clean = name;
  for (const prefix of ["stg_", "staging_", "int_", "fct_", "dim_"]) {
    if (clean.startsWith(prefix)) {
      clean = clean.slice(prefix.length);
      break;
    }
  }

  return clean
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Infer a model description from its name when none is provided.
 */
function inferModelDescription(modelName: string): string {
  const name = toPascalCase(modelName);
  // Split PascalCase back to words.
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `A ${words} entity (description inferred from model name).`;
}

/**
 * Infer a column description from its name and parent model.
 */
function inferColumnDescription(
  columnName: string,
  modelName: string,
): string {
  const colWords = columnName.replace(/_/g, " ");
  const modelWords = toPascalCase(modelName)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

  // Common patterns.
  if (columnName.endsWith("_id")) {
    const entity = columnName.slice(0, -3).replace(/_/g, " ");
    return `Identifier for the associated ${entity}.`;
  }
  if (columnName.endsWith("_at") || columnName.endsWith("_date")) {
    return `The ${colWords} of the ${modelWords}.`;
  }
  if (
    columnName.startsWith("is_")
    || columnName.startsWith("has_")
  ) {
    return `Whether the ${modelWords} ${colWords.replace(/^(is|has) /, "")}.`;
  }
  if (
    columnName.startsWith("count_")
    || columnName.startsWith("total_")
    || columnName.startsWith("sum_")
    || columnName.startsWith("avg_")
    || columnName.startsWith("number_of_")
  ) {
    return `Computed: ${colWords} for the ${modelWords}.`;
  }

  return `The ${colWords} of a ${modelWords}.`;
}
