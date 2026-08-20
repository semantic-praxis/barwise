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

// Suite runner
export { runSuite } from "./run/runSuite.js";
export type { CaseRun, CaseSummary, RunSuiteOptions, SuiteReport } from "./run/runSuite.js";

// History
export { appendHistory, historyPathFor, readHistory, toHistoryEntry } from "./history/history.js";
export type { HistoryEntry } from "./history/history.js";
