// Diff and merge.
export {
  type BreakingLevel,
  type DefinitionDelta,
  type DeltaKind,
  diffModels,
  type FactTypeDelta,
  type ModelDelta,
  type ModelDiffResult,
  type ObjectTypeDelta,
  type SynonymCandidate,
} from "./ModelDiff.js";
export {
  getStructuralErrors,
  mergeAndValidate,
  mergeModels,
  type MergeValidationResult,
} from "./ModelMerge.js";
