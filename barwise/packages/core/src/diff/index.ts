// Diff and merge.
export { type ChangeDescription, describeChange, type RoleSummary } from "./changeDescription.js";
export {
  type BreakingLevel,
  type DefinitionDelta,
  type DeltaJson,
  type DeltaKind,
  deltaLabel,
  deltaToJson,
  diffModels,
  ELEMENT_TYPES,
  elementLabel,
  elementName,
  type ElementRef,
  type ElementType,
  type FactTypeDelta,
  type ModelDelta,
  type ModelDiffResult,
  type NamedElementType,
  type ObjectifiedFactTypeDelta,
  type ObjectTypeDelta,
  type PopulationDelta,
  type SubtypeFactDelta,
  type SynonymCandidate,
} from "./ModelDiff.js";
export {
  getStructuralErrors,
  mergeAndValidate,
  mergeModels,
  type MergeValidationResult,
} from "./ModelMerge.js";
