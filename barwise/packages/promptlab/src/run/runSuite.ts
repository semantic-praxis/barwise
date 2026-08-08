/**
 * The suite runner: extract every case's transcript through the LLM
 * with the active prompt artifact and score each run deterministically.
 * The only non-determinism here is the LLM call itself; a score is a
 * sample, so `repeat` controls how many samples each case gets.
 */
import type { LlmClient, PromptArtifact } from "@barwise/llm";
import {
  buildResponseSchema,
  buildSystemPrompt,
  buildUserMessage,
  defaultExtractionArtifact,
} from "@barwise/llm";
import type { EvalSuite } from "../evalcase/types.js";
import type { CaseScore } from "../score/scoreExtraction.js";
import { scoreExtraction } from "../score/scoreExtraction.js";

export interface RunSuiteOptions {
  /** Variant artifact to render; omitted, the default artifact runs. */
  readonly artifact?: PromptArtifact;
  /** Samples per case (default 1). */
  readonly repeat?: number;
}

/** One LLM call's outcome: a score, or the error that prevented one. */
export interface CaseRun {
  readonly score?: CaseScore;
  /** Set when the call or the payload parse failed; the run counts as 0. */
  readonly error?: string;
  readonly modelUsed?: string;
}

export interface CaseSummary {
  readonly caseId: string;
  readonly runs: readonly CaseRun[];
  readonly mean: number;
  readonly worst: number;
}

export interface SuiteReport {
  readonly suiteVersion: string;
  readonly artifactVersion: string;
  readonly repeat: number;
  readonly cases: readonly CaseSummary[];
  /** Mean of the per-case means. */
  readonly mean: number;
  /** Lowest single-run score across the suite. */
  readonly worst: number;
}

export async function runSuite(
  suite: EvalSuite,
  client: LlmClient,
  options?: RunSuiteOptions,
): Promise<SuiteReport> {
  const repeat = options?.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`repeat must be a positive integer, got ${repeat}.`);
  }

  const artifact = options?.artifact;
  if (artifact !== undefined && artifact.surface !== "extraction") {
    throw new Error(
      `Prompt artifact surface "${artifact.surface}" cannot drive transcript extraction.`,
    );
  }
  const systemPrompt = buildSystemPrompt(false, artifact);
  const responseSchema = buildResponseSchema(false);

  const runOnce = async (loadedCase: EvalSuite["cases"][number]): Promise<CaseRun> => {
    try {
      const response = await client.complete({
        systemPrompt,
        userMessage: buildUserMessage(loadedCase.transcript),
        responseSchema,
      });
      const score = scoreExtraction(response.content, loadedCase, suite.weights);
      return {
        score,
        ...(response.modelUsed !== undefined ? { modelUsed: response.modelUsed } : {}),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };

  const cases: CaseSummary[] = [];
  for (const loadedCase of suite.cases) {
    const runs: CaseRun[] = [];
    for (let i = 0; i < repeat; i++) {
      runs.push(await runOnce(loadedCase));
    }
    const scores = runs.map((r) => r.score?.score ?? 0);
    cases.push({
      caseId: loadedCase.evalCase.id,
      runs,
      mean: mean(scores),
      worst: Math.min(...scores),
    });
  }

  return {
    suiteVersion: suite.version,
    artifactVersion: (artifact ?? defaultExtractionArtifact).version,
    repeat,
    cases,
    mean: mean(cases.map((c) => c.mean)),
    worst: Math.min(...cases.map((c) => c.worst)),
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
