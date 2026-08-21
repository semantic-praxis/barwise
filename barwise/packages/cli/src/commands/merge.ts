/**
 * barwise merge <base> <incoming>
 *
 * Merges an incoming model into a base model, accepting additions and
 * modifications and rejecting removals (docs/specs/cli-surface-parity.spec.md).
 *
 * The sibling of `barwise diff`: the same comparison, read in the other
 * direction. Merge reached only the MCP surface until now, the narrowest
 * reach of any shipped capability
 * (docs/unwired-capability-audit-2026-08-20.md).
 *
 * Unlike the MCP tool, this does not write back to the base file. That
 * is defensible for an agent handed both paths and surprising for a
 * command a human typed, so the merged model goes to stdout and
 * `--output` is how you ask for a file.
 */

import { OrmYamlSerializer } from "@barwise/core";
import { diffModels, mergeAndValidate } from "@barwise/core/diff";
import type { Command } from "commander";
import { loadModel, writeOutput } from "../workspace/io.js";

const serializer = new OrmYamlSerializer();

export function registerMergeCommand(program: Command): void {
  program
    .command("merge")
    .description("Merge an incoming ORM model into a base model")
    .argument("<base>", "Path to base .orm.yaml file")
    .argument("<incoming>", "Path to incoming .orm.yaml file")
    .option("--output <file>", "Write the merged model to a file instead of stdout")
    .option("--format <format>", "Output format (yaml or json)", "yaml")
    .action(
      (
        base: string,
        incoming: string,
        opts: { output?: string; format: string; },
      ) => {
        try {
          const baseModel = loadModel(base);
          // The incoming model may reference base types without
          // redefining them, the same allowance the MCP tool makes.
          const incomingModel = loadModel(incoming, { lenient: true });
          const diff = diffModels(baseModel, incomingModel);

          if (!diff.hasChanges) {
            if (opts.format === "json") {
              process.stdout.write(
                JSON.stringify({ hasChanges: false, valid: true, diagnostics: [] }, null, 2)
                  + "\n",
              );
              return;
            }
            process.stdout.write("No changes to merge.\n");
            return;
          }

          // Non-interactive policy, matching the MCP tool and
          // `import transcript`: take what was added or changed, never
          // act on a removal. A removal the user meant is a deliberate
          // edit, not something a merge should infer.
          const accepted = new Set<number>();
          for (let i = 0; i < diff.deltas.length; i++) {
            const d = diff.deltas[i]!;
            if (d.kind === "added" || d.kind === "modified") accepted.add(i);
          }

          const result = mergeAndValidate(baseModel, incomingModel, diff.deltas, accepted);

          if (!result.isValid || !result.model) {
            // Nothing is written on a structural error, to stdout or to
            // --output. A broken model on disk is worse than no model.
            if (opts.format === "json") {
              process.stdout.write(
                JSON.stringify(
                  {
                    hasChanges: true,
                    valid: false,
                    diagnostics: result.diagnostics.map((d) => ({
                      severity: d.severity,
                      ruleId: d.ruleId,
                      message: d.message,
                    })),
                  },
                  null,
                  2,
                ) + "\n",
              );
            } else {
              process.stderr.write(
                `Merge produced ${result.diagnostics.length} structural error(s); `
                  + `nothing was written.\n`,
              );
              for (const d of result.diagnostics) {
                process.stderr.write(`  ${d.ruleId}: ${d.message}\n`);
              }
            }
            process.exitCode = 1;
            return;
          }

          const yaml = serializer.serialize(result.model);

          if (opts.format === "json") {
            process.stdout.write(
              JSON.stringify({ hasChanges: true, valid: true, yaml, diagnostics: [] }, null, 2)
                + "\n",
            );
            return;
          }

          writeOutput(yaml, opts.output);
          if (opts.output) {
            const count = accepted.size;
            process.stderr.write(`Merged ${count} change(s) into ${opts.output}.\n`);
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
