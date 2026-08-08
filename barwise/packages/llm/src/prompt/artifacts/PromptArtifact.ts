/**
 * Prompt artifacts: versioned, per-provider prompt definitions for the
 * LLM surfaces (see docs/specs/prompt-optimization-harness.spec.md).
 *
 * The default artifact for each surface lives in code so the packaged
 * bundle needs no runtime file loading; variants are `.prompt.yaml`
 * files loaded with `loadArtifact` and selected with `resolveArtifact`.
 */

export type PromptSurface = "extraction" | "review";

/** A few-shot demonstration rendered inline into the system prompt. */
export interface PromptDemo {
  readonly transcriptExcerpt: string;
  /** Canonical JSON of the expected extraction payload. */
  readonly extraction: string;
}

/**
 * Declares which provider/model a variant artifact targets. A plain
 * string rather than the factory's ProviderName union so clients
 * outside the factory (the VS Code Copilot integration) can declare
 * variants too.
 */
export interface PromptArtifactMatch {
  readonly provider?: string;
  /** Applies when the target model id starts with this prefix. */
  readonly modelPrefix?: string;
}

/** Where an artifact came from and how it scored when it was accepted. */
export interface PromptProvenance {
  readonly optimizer?: string;
  readonly proposerModel?: string;
  readonly scoredAgainst?: string;
  readonly suiteVersion?: string;
  readonly score?: number;
  readonly date?: string;
}

export interface PromptArtifact {
  readonly surface: PromptSurface;
  /** Artifact version, independent of the package version. */
  readonly version: string;
  /** Absent on a default artifact; a variant declares its target. */
  readonly match?: PromptArtifactMatch;
  /** The system-prompt body. */
  readonly instructions: string;
  readonly demos: readonly PromptDemo[];
  readonly provenance?: PromptProvenance;
}
