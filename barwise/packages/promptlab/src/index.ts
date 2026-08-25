// Eval-case format
export { defaultSuitePath, loadEvalCase, loadSuite } from "./evalcase/loadSuite.js";
export { renderReference, withDeterministicIds } from "./evalcase/renderReference.js";
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

// Provenance
export { hashPrompt } from "./provenance/promptHash.js";

// Suite runner
export { classifyFailure, describeProviderError, withRetry } from "./run/retry.js";
export type { FailureKind, ProviderErrorInfo, RetryOptions, RetryResult } from "./run/retry.js";
export { runSuite } from "./run/runSuite.js";
export type {
  CaseRun,
  CaseSummary,
  RunProgress,
  RunSuiteOptions,
  SuiteReport,
} from "./run/runSuite.js";

// History
export {
  appendHistory,
  appendRunHistory,
  historyPathFor,
  IncompleteRunError,
  readHistory,
  toHistoryEntry,
} from "./history/history.js";
export type { BuildProvenance, HistoryEntry } from "./history/history.js";
