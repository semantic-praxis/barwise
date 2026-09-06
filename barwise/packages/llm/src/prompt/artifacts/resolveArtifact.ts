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
 * variant wins: a modelPrefix match outweighs a provider match, and
 * between two modelPrefix matches the longer prefix wins, because a
 * longer prefix that still matches is strictly more specific
 * (`claude-haiku-4-5-2026` against `claude-haiku`). Two applicable
 * variants of equal specificity -- the same fields and the same prefix
 * length -- are an authoring error and throw. Returns undefined when no
 * variant applies; callers fall back to the surface's default artifact.
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

  const top = applicable
    .map((c) => c.specificity)
    .reduce((best, s) => (compareSpecificity(s, best) > 0 ? s : best));
  const winners = applicable.filter((c) => compareSpecificity(c.specificity, top) === 0);
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

/**
 * [which fields are declared, how long the prefix is]. The first
 * component keeps the field order (modelPrefix outweighs provider); the
 * second breaks ties between prefixes. It used to be the first alone,
 * and the operator testing a per-release variant against the shipped
 * per-family one hit "Ambiguous ... narrow the match blocks" -- the one
 * thing they had already done (barwise-854).
 */
type Specificity = readonly [fields: number, prefixLength: number];

function specificity(artifact: PromptArtifact): Specificity {
  const match = artifact.match!;
  const fields = (match.provider !== undefined ? 1 : 0)
    + (match.modelPrefix !== undefined ? 2 : 0);
  return [fields, match.modelPrefix?.length ?? 0];
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

function describe(artifact: PromptArtifact): string {
  const match = artifact.match!;
  return `version ${artifact.version} (provider=${match.provider ?? "-"},`
    + ` modelPrefix=${match.modelPrefix ?? "-"})`;
}
