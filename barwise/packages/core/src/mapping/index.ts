// Mapping: relational mapper, schema, and format renderers.
export {
  type ConstraintPlacement,
  type ConstraintRouting,
  routeConstraints,
  type RoutedClause,
  routeUniqueOnly,
  type SpilledConstraint,
  unreportedConstraintSpecs,
  withConstraintSpecs,
} from "./constraintRouting.js";
export {
  type ConstraintChannel,
  type DialectCapabilityProfile,
  resolveDialectProfile,
} from "./dialectCapabilities.js";
export {
  objectificationGivesKey,
  RelationalMapper,
  type RelationalMapperOptions,
} from "./RelationalMapper.js";
export type {
  Column,
  ForeignKey,
  PrimaryKey,
  RelationalSchema,
  RoutedUnique,
  Table,
} from "./RelationalSchema.js";
export {
  DBT_KEY_TEST,
  type DbtModelFile,
  type DbtProject,
  type DbtRenderOptions,
  renderDbt,
} from "./renderers/dbt.js";
export { annotateDbtExport, type ExportAnnotationResult } from "./renderers/DbtExportAnnotator.js";
export {
  hasGeneratedKeys,
  SURROGATE_KEY_TYPE,
  SURROGATE_POPULATION_NOTE,
  withSurrogateKeys,
} from "./surrogateKeys.js";
