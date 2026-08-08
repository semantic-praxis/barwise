import type { PromptArtifact, PromptSurface } from "./PromptArtifact.js";

export interface ArtifactQuery {
  readonly surface: PromptSurface;
  readonly provider?: string;
  readonly model?: string;
}

/**
 * Select the declared variant for a (surface, provider, model) target.
 *
 * Resolution is explicit: a variant applies only when every field of
 * its `match` block holds for the query. The most specific applicable
 * variant wins (a modelPrefix match outweighs a provider match); two
 * applicable variants of equal specificity are an authoring error and
 * throw. Returns undefined when no variant applies -- callers fall
 * back to the surface's default artifact.
 */
export function resolveArtifact(
  artifacts: readonly PromptArtifact[],
  query: ArtifactQuery,
): PromptArtifact | undefined {
  const applicable = artifacts
    .filter((a) => a.surface === query.surface && a.match !== undefined)
    .filter((a) => matches(a, query))
    .map((a) => ({ artifact: a, specificity: specificity(a) }));

  if (applicable.length === 0) return undefined;

  const top = Math.max(...applicable.map((c) => c.specificity));
  const winners = applicable.filter((c) => c.specificity === top);
  if (winners.length > 1) {
    const described = winners.map((c) => describe(c.artifact)).join("; ");
    throw new Error(
      `Ambiguous prompt artifacts for surface "${query.surface}"`
        + ` (provider=${query.provider ?? "-"}, model=${query.model ?? "-"}): ${described}.`
        + ` Narrow the match blocks so exactly one variant wins.`,
    );
  }
  return winners[0]!.artifact;
}

function matches(artifact: PromptArtifact, query: ArtifactQuery): boolean {
  const match = artifact.match!;
  if (match.provider !== undefined && match.provider !== query.provider) {
    return false;
  }
  if (
    match.modelPrefix !== undefined
    && !(query.model !== undefined && query.model.startsWith(match.modelPrefix))
  ) {
    return false;
  }
  return true;
}

function specificity(artifact: PromptArtifact): number {
  const match = artifact.match!;
  return (match.provider !== undefined ? 1 : 0)
    + (match.modelPrefix !== undefined ? 2 : 0);
}

function describe(artifact: PromptArtifact): string {
  const match = artifact.match!;
  return `version ${artifact.version} (provider=${match.provider ?? "-"},`
    + ` modelPrefix=${match.modelPrefix ?? "-"})`;
}
