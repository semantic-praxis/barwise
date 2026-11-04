/**
 * barwise diff <file1> <file2>
 *
 * Computes the diff between two ORM models and prints the deltas.
 */

import {
  type DeclaredRename,
  deltaLabel,
  deltaToJson,
  diffModels,
  ELEMENT_MATCHINGS,
  type ModelDelta,
  pairingNote,
  type SynonymCandidate,
} from "@barwise/core/diff";
import type { Command } from "commander";
import { loadModel } from "../workspace/io.js";

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Compare two ORM model files")
    .argument("<base>", "Path to base .orm.yaml file")
    .argument("<incoming>", "Path to incoming .orm.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--no-synonyms", "Hide synonym candidates")
    .option(
      "--matching <mode>",
      "How elements pair: id-first (a shared id is one element) or content "
        + "(ids say nothing; for models whose ids are unrelated but may coincide)",
      "id-first",
    )
    .option(
      "--rename <kind:old=new>",
      "Pair a renamed element the diff cannot recognize because it also changed: "
        + "object-type:<old>=<new> or fact-type:<old>=<new> (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(
      async (
        base: string,
        incoming: string,
        opts: { format: string; synonyms: boolean; matching: string; rename: string[]; },
      ) => {
        try {
          const matching = ELEMENT_MATCHINGS.find((m) => m === opts.matching);
          if (matching === undefined) {
            throw new Error(
              `--matching must be ${ELEMENT_MATCHINGS.join(" or ")}, `
                + `not ${JSON.stringify(opts.matching)}.`,
            );
          }
          // Before the files load, as --matching is: a usage mistake is
          // reported as one, not hidden behind a file error.
          const renames = opts.rename.map(parseRename);
          const baseModel = loadModel(base);
          const incomingModel = loadModel(incoming);
          const diff = diffModels(baseModel, incomingModel, { matching, renames });

          if (opts.format === "json") {
            process.stdout.write(
              JSON.stringify(
                {
                  hasChanges: diff.hasChanges,
                  deltas: diff.deltas
                    .filter((d) => d.kind !== "unchanged")
                    .map(deltaToJson),
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
            const note = pairingNote(delta);
            if (note) process.stdout.write(`    ${note}\n`);

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

const RENAME_KINDS = { "object-type": "objectType", "fact-type": "factType" } as const;

/** `object-type:Old=New` or `fact-type:Old=New`, split at the first `:` and `=`. */
function parseRename(value: string): DeclaredRename {
  const colon = value.indexOf(":");
  const equals = value.indexOf("=", colon + 1);
  const spelled = value.slice(0, colon);
  // Own keys only: `constructor` or `toString` would otherwise read a
  // kind off the prototype.
  const kind = Object.hasOwn(RENAME_KINDS, spelled)
    ? RENAME_KINDS[spelled as keyof typeof RENAME_KINDS]
    : undefined;
  if (colon < 0 || equals < 0 || kind === undefined) {
    throw new Error(
      `--rename must be object-type:<old>=<new> or fact-type:<old>=<new>, not ${
        JSON.stringify(value)
      }.`,
    );
  }
  const from = value.slice(colon + 1, equals);
  const to = value.slice(equals + 1);
  if (from === "" || to === "") {
    throw new Error(`--rename names both the old and the new name: ${JSON.stringify(value)}.`);
  }
  return { target: { kind, name: from }, to };
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
