// Eval-case format
export { defaultSuitePath, loadEvalCase, loadSuite } from "./evalcase/loadSuite.js";
export { isPromptCheck } from "./evalcase/types.js";
export type {
  EvalCase,
  EvalSuite,
  LoadedEvalCase,
  PromptCheck,
  SuiteWeights,
} from "./evalcase/types.js";

// Scorer
export { ambiguityExcess, runPromptChecks } from "./score/promptChecks.js";
export type { PromptCheckResult } from "./score/promptChecks.js";
export { scoreExtraction } from "./score/scoreExtraction.js";
export type { CaseScore } from "./score/scoreExtraction.js";

// Dispersion
export { dispersionOf, marginOfError, sampleSd } from "./stats/dispersion.js";
export type { CaseDispersionInput, Dispersion } from "./stats/dispersion.js";

// Suite runner
export { classifyFailure, withRetry } from "./run/retry.js";
export type { FailureKind, RetryOptions, RetryResult } from "./run/retry.js";
export { runSuite } from "./run/runSuite.js";
export type { CaseRun, CaseSummary, RunSuiteOptions, SuiteReport } from "./run/runSuite.js";

// History
export {
  appendHistory,
  appendRunHistory,
  historyPathFor,
  IncompleteRunError,
  readHistory,
  toHistoryEntry,
} from "./history/history.js";
export type { HistoryEntry } from "./history/history.js";
