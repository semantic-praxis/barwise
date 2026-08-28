/**
 * The artifact candidate set the `prompt` commands resolve over.
 *
 * Its own module because it is the seam two commands got wrong in
 * opposite directions, and because a consumer test cannot pin it: both
 * `eval` and `artifact` fall back to the default artifact, so a
 * candidate set that silently loses the built-ins still produces a
 * plausible run and a plausible printout.
 *
 * `eval` did not consult `builtinArtifacts` at all -- resolution sat
 * behind `if (opts.artifacts)`, so without a directory it sent the
 * default while echoing the operator's provider and model back at them.
 * The shipped variants are compiled into `builtins.generated.ts`, so
 * `haiku45-2` and `sonnet5-3` -- the prompts production actually sends
 * -- had never once been measured by the command built to measure them.
 *
 * `artifact` did consult them, and then concatenated the directory on
 * top. Point it at `packages/llm/prompts/`, the very files the builtins
 * are generated FROM, and the resolver sees `haiku45-2` twice and
 * refuses as ambiguous. A comment there claimed order settled it;
 * `resolveArtifact` compares specificity and knows nothing of order, so
 * the claim was never true.
 */
import type { PromptArtifact, PromptSurface } from "@barwise/llm";
import {
  builtinArtifacts,
  defaultExtractionArtifact,
  defaultReviewArtifact,
  loadArtifactsFromDir,
} from "@barwise/llm";
import { resolve } from "node:path";

/**
 * Everything shipped, plus anything in `dir`, the directory winning on
 * a version collision.
 *
 * De-duplicating by version is what makes "a local variant wins" true:
 * a directory entry sharing a builtin's version IS that builtin, edited.
 * Two variants at equal specificity under DIFFERENT versions stay
 * ambiguous and still throw, because that is a real question only the
 * operator can settle.
 */
export function artifactCandidates(dir?: string): PromptArtifact[] {
  const local = dir ? loadArtifactsFromDir(resolve(dir)) : [];
  const overridden = new Set(local.map((a) => a.version));
  return [...builtinArtifacts.filter((a) => !overridden.has(a.version)), ...local];
}

/**
 * Pick an artifact by name instead of by provider/model match: the
 * `--artifact-version` selector (barwise-882). `"default"` names the
 * surface's default artifact -- the arm that was previously reachable
 * only by shadowing every builtin with match-less copies, which
 * confounded default-versus-variant with model-versus-model for any
 * operator who did not know the trick. An unknown version throws
 * BEFORE a client exists, naming what would have matched, because a
 * typo that reaches a provider costs a sweep.
 *
 * Shared by `eval` and `artifact` so the two commands cannot answer
 * the same question differently -- the barwise-850/851 lesson.
 */
export function artifactByVersion(
  candidates: readonly PromptArtifact[],
  surface: PromptSurface,
  version: string,
): PromptArtifact {
  if (version === "default") {
    return surface === "review" ? defaultReviewArtifact : defaultExtractionArtifact;
  }
  const matches = candidates.filter((a) => a.surface === surface && a.version === version);
  if (matches.length === 1) return matches[0]!;
  const available = candidates
    .filter((a) => a.surface === surface)
    .map((a) => a.version)
    .sort();
  throw new Error(
    matches.length === 0
      ? `No ${surface} artifact has version "${version}".`
        + ` Available: default, ${available.join(", ")}.`
      : `Version "${version}" is ambiguous: ${matches.length} ${surface} artifacts carry it.`,
  );
}
