// Extraction types
export type {
  Ambiguity,
  CandidateFraming,
  ConstraintProvenance,
  DraftModelResult,
  ElementProvenance,
  ExtractedFactType,
  ExtractedObjectifiedFactType,
  ExtractedObjectType,
  ExtractedRole,
  ExtractedSubtype,
  ExtractionAlternative,
  ExtractionResponse,
  InferredConstraint,
  InferredConstraintType,
  ObjectificationProvenance,
  SourceReference,
  SubtypeProvenance,
} from "./ExtractionTypes.js";

// LLM client interface
export type { CompletionRequest, CompletionResponse, LlmClient } from "./LlmClient.js";

// Output-token budget
export {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKEN_CAP,
  MIN_DERIVED_OUTPUT_TOKENS,
  OBSERVED_PAYLOAD_RATIO,
  suggestContextWindow,
  suggestMaxTokens,
} from "./budget.js";
export type { BudgetOptions } from "./budget.js";

// Prompt construction
export {
  buildResponseSchema,
  buildSystemPrompt,
  buildUserMessage,
  parseExtractionResponse,
} from "./ExtractionPrompt.js";

// Prompt artifacts
export { builtinArtifacts } from "./prompt/artifacts/builtins.generated.js";
export { loadArtifact, loadArtifactsFromDir } from "./prompt/artifacts/loadArtifact.js";
export type {
  PromptArtifact,
  PromptArtifactMatch,
  PromptDemo,
  PromptProvenance,
  PromptSurface,
} from "./prompt/artifacts/PromptArtifact.js";
export { resolveArtifact } from "./prompt/artifacts/resolveArtifact.js";
export type { ArtifactQuery } from "./prompt/artifacts/resolveArtifact.js";
export { defaultExtractionArtifact } from "./prompt/systemPrompt.js";

// Call observability
export { withCallLog } from "./observe/callLog.js";
export type { CallLogOptions, CallLogSink, LlmCallRecord } from "./observe/callLog.js";
export { emitExtractionRecord, summariseExtraction } from "./observe/extractionLog.js";
export type { ExtractionLogSink, ExtractionRecord } from "./observe/extractionLog.js";

// Conformance validation
export { enforceConformance } from "./ExtractionConformance.js";
export type { ConformanceCorrection, ConformanceResult } from "./ExtractionConformance.js";

// Model parser
export { parseDraftModel } from "./DraftModelParser.js";

// Reasoning trail
export { buildReasoningTrail } from "./ReasoningTrail.js";
export type { DiscardedFraming, ReasoningTrail, TrailAssumption } from "./ReasoningTrail.js";

// Model context helper
export { buildExistingModelContext } from "./ModelContext.js";

// Pipeline orchestrator
export { parseExtractionFromJson, processTranscript } from "./TranscriptProcessor.js";
export type { ProcessorOptions } from "./TranscriptProcessor.js";

// Providers
export { AnthropicLlmClient } from "./providers/anthropic.js";
export type { AnthropicClientOptions } from "./providers/anthropic.js";
export { OllamaLlmClient } from "./providers/ollama.js";
export type { OllamaClientOptions } from "./providers/ollama.js";
export { OpenAILlmClient } from "./providers/openai.js";
export type { OpenAIClientOptions } from "./providers/openai.js";

// Provider factory
export { createLlmClient, detectProvider } from "./providers/factory.js";
export type { ProviderName, ProviderOptions } from "./providers/factory.js";

// Review
export { reviewModel } from "./review/reviewModel.js";
export type { ReviewOptions, ReviewResult, ReviewSuggestion } from "./review/reviewModel.js";
