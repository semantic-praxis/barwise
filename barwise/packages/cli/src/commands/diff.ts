/**
 * barwise diff <file1> <file2>
 *
 * Computes the diff between two ORM models and prints the deltas.
 */

import { diffModels, type ModelDelta, type SynonymCandidate } from "@barwise/core/diff";
import type { Command } from "commander";
import { loadModel } from "../helpers/io.js";

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Compare two ORM model files")
    .argument("<base>", "Path to base .orm.yaml file")
    .argument("<incoming>", "Path to incoming .orm.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--no-synonyms", "Hide synonym candidates")
    .action(
      async (
        base: string,
        incoming: string,
        opts: { format: string; synonyms: boolean; },
      ) => {
        try {
          const baseModel = loadModel(base);
          const incomingModel = loadModel(incoming);
          const diff = diffModels(baseModel, incomingModel);

          if (opts.format === "json") {
            process.stdout.write(
              JSON.stringify(
                {
                  hasChanges: diff.hasChanges,
                  deltas: diff.deltas
                    .filter((d) => d.kind !== "unchanged")
                    .map((d) => ({
                      kind: d.kind,
                      elementType: d.elementType,
                      name: d.elementType === "definition" ? d.term : d.name,
                      breakingLevel: d.breakingLevel,
                      changeDescriptions: d.changeDescriptions,
                    })),
                  synonymCandidates: opts.synonyms
                    ? diff.synonymCandidates
                    : [],
                },
                null,
                2,
              ) + "\n",
            );
            return;
          }

          if (!diff.hasChanges) {
            process.stdout.write("No changes.\n");
            return;
          }

          const actionable = diff.deltas.filter((d) => d.kind !== "unchanged");
          const synonymLookup = opts.synonyms
            ? buildSynonymLookup(diff.synonymCandidates, diff.deltas)
            : new Map<number, string>();

          for (let i = 0; i < diff.deltas.length; i++) {
            const delta = diff.deltas[i]!;
            if (delta.kind === "unchanged") continue;

            const tag = delta.kind.toUpperCase().padEnd(8);
            const label = deltaLabel(delta);
            const level = `[${delta.breakingLevel}]`;
            process.stdout.write(`  ${tag} ${label} ${level}\n`);

            for (const change of delta.changeDescriptions) {
              process.stdout.write(`    ${change}\n`);
            }

            const synonym = synonymLookup.get(i);
            if (synonym) {
              process.stdout.write(`    ${synonym}\n`);
            }
          }

          process.stdout.write(
            `\n${actionable.length} change(s) detected.\n`,
          );
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}

function deltaLabel(delta: ModelDelta): string {
  if (delta.elementType === "definition") {
    return `Definition: ${delta.term}`;
  }
  const typeLabel = delta.elementType === "object_type" ? "Object type" : "Fact type";
  return `${typeLabel}: ${delta.name}`;
}

function buildSynonymLookup(
  candidates: readonly SynonymCandidate[],
  _deltas: readonly ModelDelta[],
): Map<number, string> {
  const lookup = new Map<number, string>();
  for (const c of candidates) {
    lookup.set(
      c.removedIndex,
      `Possible rename: see added "${c.addedName}"`,
    );
    lookup.set(
      c.addedIndex,
      `Possible rename: see removed "${c.removedName}"`,
    );
  }
  return lookup;
}
