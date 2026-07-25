// Exercise format
export { type LoadedExercise, loadExercise } from "./exercise/loadExercise.js";
export { ExerciseParseError, parseExercise } from "./exercise/parseExercise.js";
export type {
  ConstraintKind,
  Difficulty,
  ElementQuery,
  GymCheck,
  GymExercise,
} from "./exercise/types.js";

// Evaluator
export { evaluateCandidate } from "./evaluate/evaluateCandidate.js";
export type { CheckResult, GymReport } from "./evaluate/GymReport.js";

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
