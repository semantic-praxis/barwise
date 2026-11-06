// Format registration
export {
  avroFormat,
  ddlFormat,
  normaFormat,
  openApiFormat,
  ossieFormat,
  registerStandardFormats,
  sqlFormat,
} from "./registration.js";

// The report of an export's constraintSpecs, shared by the surfaces
export { type ConstraintReportOptions, formatConstraintReport } from "./constraintReport.js";

// Format implementations
export { AvroExportFormat } from "./avro/AvroExportFormat.js";
export { toAvroNamespace } from "./avro/avroNames.js";
export { DdlExportFormat, PLAIN_DDL_OPTIONS } from "./ddl/DdlExportFormat.js";
export { DdlImportFormat } from "./ddl/DdlImportFormat.js";
export { NormaExportFormat } from "./norma/NormaExportFormat.js";
export { NormaImportFormat } from "./norma/NormaImportFormat.js";
export { NormaImportError } from "./norma/NormaXmlImporter.js";
export { OpenApiExportFormat } from "./openapi/OpenApiExportFormat.js";
export { OpenApiImportFormat } from "./openapi/OpenApiImportFormat.js";
export { OssieExportFormat } from "./ossie/OssieExportFormat.js";
export { OssieImportFormat } from "./ossie/OssieImportFormat.js";
export { OSSIE_VERSION, OssieImportError } from "./ossie/OssieTypes.js";
export { SqlImportFormat } from "./sql/SqlImportFormat.js";
// The SQL parser cascade, moved from core (format-renderers-to-connectors.spec.md, WS3)
export { parseSqlPatterns } from "./sql/parseSqlPatterns.js";
export { detectStatementType, parseSqlFile, parseSqlStatement } from "./sql/SqlCascadeParser.js";
export { extractSqlPatterns, splitSqlStatements } from "./sql/SqlPatternExtractor.js";
export { mapSqlTypeToConceptual, parseSqlDataType } from "./sql/typeMapping.js";

// Renderers: each format's text writer, beside its descriptor
// (format-renderers-to-connectors.spec.md, WS1).
export { AVRO_NAME, avroFieldNames, toAvroName } from "./avro/avroNames.js";
export {
  type AvroField,
  type AvroFieldType,
  type AvroRenderOptions,
  type AvroSchema,
  type AvroSchemaSet,
  avroSchemaToJson,
  renderAvro,
} from "./avro/renderAvro.js";
export { renderDdl } from "./ddl/renderDdl.js";
export {
  type OpenApiPropertyType,
  type OpenApiRenderOptions,
  type OpenApiSpec,
  openApiToJson,
  renderOpenApi,
} from "./openapi/renderOpenApi.js";
export {
  renderPopulationAsOpenApiExamples,
  renderPopulationAsSql,
} from "./population/populationRenderer.js";
