// Model
export {
  type Constraint,
  type DisjunctiveMandatoryConstraint,
  type EqualityConstraint,
  type ExclusionConstraint,
  type ExclusiveOrConstraint,
  type ExternalUniquenessConstraint,
  type FrequencyConstraint,
  type InternalUniquenessConstraint,
  isDisjunctiveMandatory,
  isEquality,
  isExclusion,
  isExclusiveOr,
  isExternalUniqueness,
  isFrequency,
  isInternalUniqueness,
  isMandatoryRole,
  isRing,
  isSubset,
  isValueComparison,
  isValueConstraint,
  type MandatoryRoleConstraint,
  type RingConstraint,
  type RingType,
  type SubsetConstraint,
  type ValueComparisonConstraint,
  type ValueComparisonOperator,
  type ValueConstraint,
} from "./model/Constraint.js";
export {
  ContextMapping,
  type ContextMappingConfig,
  type MappingPattern,
} from "./model/ContextMapping.js";
export { type Definition } from "./model/Definition.js";
export { type DiagramLayout } from "./model/DiagramLayout.js";
export { DomainModel, type DomainModelConfig } from "./model/DomainModel.js";
export { EntityMapping, type EntityMappingConfig } from "./model/EntityMapping.js";
export { FactType, type FactTypeConfig } from "./model/FactType.js";
export { ModelElement } from "./model/ModelElement.js";
export {
  ObjectifiedFactType,
  type ObjectifiedFactTypeConfig,
} from "./model/ObjectifiedFactType.js";
export {
  type ConceptualDataTypeName,
  type DataTypeDef,
  ObjectType,
  type ObjectTypeConfig,
  type ObjectTypeKind,
  type ValueConstraintDef,
  type ValueRange,
} from "./model/ObjectType.js";
export { OrmModel, type OrmModelConfig } from "./model/OrmModel.js";
export {
  type ExportFormat,
  OrmProject,
  type OrmProjectConfig,
  type PreferredIdentifierStrategy,
  type ProjectSettings,
} from "./model/OrmProject.js";
export {
  type FactInstance,
  type FactInstanceConfig,
  Population,
  type PopulationConfig,
} from "./model/Population.js";
export { type ProductConfig, ProductDependency } from "./model/ProductDependency.js";
export { expandReading, type ReadingOrder, validateReadingTemplate } from "./model/ReadingOrder.js";
export { Role, type RoleConfig } from "./model/Role.js";
export { SemanticConflict, type SemanticConflictConfig } from "./model/SemanticConflict.js";
export { SubtypeFact, type SubtypeFactConfig } from "./model/SubtypeFact.js";

// Serialization
export {
  ModelSplitError,
  parseSplitConfig,
  scaffoldProject,
  scaffoldSplitConfig,
  type SplitConfig,
  type SplitDomainFile,
  type SplitMappingFile,
  splitModel,
  type SplitResult,
} from "./project/index.js";
export {
  MappingDeserializationError,
  MappingSerializer,
} from "./serialization/MappingSerializer.js";
export { DeserializationError, OrmYamlSerializer } from "./serialization/OrmYamlSerializer.js";
export {
  assembleProject,
  type LoadedProject,
  type ProjectFile,
  projectFilePaths,
  type ProjectFiles,
  ProjectLoadError,
} from "./serialization/projectAssembly.js";
export {
  ProjectDeserializationError,
  ProjectSerializer,
} from "./serialization/ProjectSerializer.js";
export {
  type SchemaError,
  type SchemaValidationResult,
  SchemaValidator,
} from "./serialization/SchemaValidator.js";
export { CURRENT_ORM_VERSION, type OrmVersionMigration } from "./serialization/schemaVersion.js";

// Validation
export { type Diagnostic, type DiagnosticSeverity } from "./validation/Diagnostic.js";
export { completenessWarnings } from "./validation/rules/completenessWarnings.js";
export { constraintConsistencyRules } from "./validation/rules/constraintConsistency.js";
export { populationValidationRules } from "./validation/rules/populationValidation.js";
export { projectRules, type ProjectValidationRule } from "./validation/rules/projectRules.js";
export { structuralRules } from "./validation/rules/structural.js";
export { ValidationEngine } from "./validation/ValidationEngine.js";
export { type ValidationRule } from "./validation/ValidationRule.js";

// Import format interface (standard format connectors live in
// @barwise/formats; the dbt connector in @barwise/dbt)
export type { ImportFormat, ImportOptions, ImportResult } from "./import/types.js";

// Export format types
export type {
  ConstraintSpec,
  ExportFormatAdapter,
  ExportOptions,
  ExportResult,
} from "./export/types.js";

// Unified format system (registry only; descriptors register from
// outside core via @barwise/formats, @barwise/dbt, @barwise/code-analysis)
export {
  clearFormats,
  formatRegistry,
  FormatRegistryError,
  getExporter,
  getFormat,
  getImporter,
  listExporters,
  listFormats,
  listImporters,
  registerFormat,
} from "./format/registry.js";
export type { FormatDescriptor } from "./format/types.js";
