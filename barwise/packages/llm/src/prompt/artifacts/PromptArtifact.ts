/**
 * Prompt artifacts: versioned, per-provider prompt definitions for the
 * LLM surfaces (see docs/specs/prompt-optimization-harness.spec.md).
 *
 * Every artifact -- each surface's matchless default and every
 * variant -- is a `.prompt.yaml` file compiled into
 * `builtins.generated.ts`, so the packaged bundle needs no runtime
 * file loading. Variants are selected with `resolveArtifact`; the
 * defaults are invisible to it and reached only through
 * `selectArtifact`'s fallback (extraction-default-parity.spec.md).
 */

/**
 * Every prompt surface, declared once.
 *
 * A list rather than a bare union because the union's members are a
 * capability, not a data vocabulary: each one needs wiring at several
 * layers, and the CLI commands that take a `--surface` flag validate a
 * *string* against it. Hand-written literals in those guards is how
 * barwise-855 happened -- `prompt artifact` and `prompt schema` went on
 * refusing `--surface review` long after `reviewModel` was
 * artifact-driven, with tests pinning the refusal as a requirement.
 *
 * Deriving both the type and the guards from this array means adding a
 * surface makes the commands accept it without anyone remembering to,
 * which is the failure defined out of existence rather than tested for.
 * The same shape as `REVIEW_CATEGORIES` in `review/reviewModel.ts`, for
 * the same reason. `loadArtifact` validates against this too -- it kept
 * its own copy, typed `readonly PromptSurface[]`, which catches a
 * REMOVED member and silently lags on an added one.
 */
export const PROMPT_SURFACES = ["extraction", "review"] as const;

export type PromptSurface = (typeof PROMPT_SURFACES)[number];

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
