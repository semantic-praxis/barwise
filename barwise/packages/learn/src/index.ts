// Exercise format
export {
  type CatalogEntry,
  defaultCatalogDir,
  findExercise,
  listExercises,
} from "./exercise/catalog.js";
export { type LoadedExercise, loadExercise } from "./exercise/loadExercise.js";
export { ExerciseParseError, parseExercise, parseVocabulary } from "./exercise/parseExercise.js";
export {
  type CheckGuidance,
  type ConstraintKind,
  type ElementQuery,
  type GymCheck,
  type GymExercise,
  type GymTransition,
  type NameLicence,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
} from "./exercise/types.js";

// Evaluator
export { evaluateCandidate } from "./evaluate/evaluateCandidate.js";
export type { CheckResult, GymReport } from "./evaluate/GymReport.js";

// Miss-card emission (learning-design C6)
export { buildMissCards, type MissCard, renderMissCardFile } from "./deck/missCards.js";

// Tutorial (modeling-tutorial spec, workstream 1)
export { loadTutorial } from "./tutorial/loadTutorial.js";
export { parseTutorial, TutorialParseError } from "./tutorial/parseTutorial.js";
export {
  renderTutorial,
  type RenderTutorialOptions,
  TutorialRenderError,
} from "./tutorial/renderTutorial.js";
export type {
  LoadedTutorial,
  LoadedTutorialStep,
  TutorialDef,
  TutorialMotivation,
  TutorialStepDef,
  TutorialTransition,
} from "./tutorial/types.js";
