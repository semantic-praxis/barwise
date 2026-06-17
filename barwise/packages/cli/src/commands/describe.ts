/**
 * barwise describe <source>
 *
 * Query the ORM model for domain context. Returns structured information about
 * entities, fact types, and constraints, with optional focus filtering.
 */

import { describeDomain } from "@barwise/core/describe";
import type { Command } from "commander";
import { loadModel } from "../helpers/io.js";

export function registerDescribeCommand(program: Command): void {
  program
    .command("describe")
    .description("Describe domain model with optional focus")
    .argument("<source>", "Path to .orm.yaml file")
    .option("--focus <name>", "Focus on specific entity, fact type, or constraint type")
    .option("--verbose", "Show full detail (all entities, fact types, constraints, populations)")
    .option("--json", "Output as JSON instead of human-readable text")
    .action(
      async (source: string, opts: { focus?: string; verbose?: boolean; json?: boolean; }) => {
        try {
          const model = loadModel(source);
          const description = describeDomain(model, {
            focus: opts.focus,
            includePopulations: true,
          });

          if (opts.json) {
            // JSON output: full structured data
            process.stdout.write(JSON.stringify(description, null, 2) + "\n");
          } else if (opts.verbose) {
            // Verbose text output: full detail
            process.stdout.write(description.summary + "\n\n");

            if (description.entityTypes.length > 0) {
              process.stdout.write("Entity Types:\n");
              for (const entity of description.entityTypes) {
                process.stdout.write(`  ${entity.name} (${entity.kind})\n`);
                if (entity.definition) {
                  process.stdout.write(`    ${entity.definition}\n`);
                }
                if (entity.referenceMode) {
                  process.stdout.write(`    Reference Mode: ${entity.referenceMode}\n`);
                }
              }
              process.stdout.write("\n");
            }

            if (description.factTypes.length > 0) {
              process.stdout.write("Fact Types:\n");
              for (const ft of description.factTypes) {
                process.stdout.write(`  ${ft.primaryReading}\n`);
                process.stdout.write(
                  `    Arity: ${ft.arity}, Constraints: ${ft.constraintCount}\n`,
                );
              }
              process.stdout.write("\n");
            }

            if (description.constraints.length > 0) {
              process.stdout.write("Constraints:\n");
              for (const c of description.constraints) {
                process.stdout.write(`  [${c.type}] ${c.verbalization}\n`);
              }
              process.stdout.write("\n");
            }

            if (description.populations && description.populations.length > 0) {
              process.stdout.write("Populations:\n");
              for (const p of description.populations) {
                process.stdout.write(`  ${p.factTypeName}: ${p.instanceCount} instances\n`);
              }
            }
          } else {
            // Default: human-readable summary (already formatted)
            process.stdout.write(description.summary + "\n");
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
