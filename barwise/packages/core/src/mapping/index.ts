// Mapping: relational mapper, schema, and format renderers.
export { renderPopulationAsSql } from "../export/populationRenderer.js";
export { RelationalMapper, type RelationalMapperOptions } from "./RelationalMapper.js";
export type {
  Column,
  ForeignKey,
  PrimaryKey,
  RelationalSchema,
  Table,
} from "./RelationalSchema.js";
export {
  type AvroField,
  type AvroFieldType,
  type AvroRenderOptions,
  type AvroSchema,
  type AvroSchemaSet,
  avroSchemaToJson,
  renderAvro,
} from "./renderers/avro.js";
export {
  type DbtModelFile,
  type DbtProject,
  type DbtRenderOptions,
  renderDbt,
} from "./renderers/dbt.js";
export { annotateDbtExport, type ExportAnnotationResult } from "./renderers/DbtExportAnnotator.js";
export { renderDdl } from "./renderers/ddl.js";
export {
  type OpenApiPropertyType,
  type OpenApiRenderOptions,
  type OpenApiSpec,
  openApiToJson,
  renderOpenApi,
} from "./renderers/openapi.js";
