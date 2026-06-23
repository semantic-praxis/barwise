/**
 * barwise describe <source>
 *
 * Describe an ORM model's domain context, or -- given a `.orm-project.yaml` --
 * each domain (or one chosen with `--domain`). Returns structured information
 * about entities, fact types, and constraints, with optional focus filtering.
 */

import type { OrmModel } from "@barwise/core";
import { describeDomain } from "@barwise/core/describe";
import type { Command } from "commander";
import { resolveDomainModels } from "../workspace/domainModels.js";

interface DescribeOptions {
  focus?: string;
  verbose?: boolean;
  json?: boolean;
  domain?: string;
}

export function registerDescribeCommand(program: Command): void {
  program
    .command("describe")
    .description("Describe domain model with optional focus")
    .argument("<source>", "Path to .orm.yaml or .orm-project.yaml file")
    .option("--focus <name>", "Focus on specific entity, fact type, or constraint type")
    .option("--verbose", "Show full detail (all entities, fact types, constraints, populations)")
    .option("--json", "Output as JSON instead of human-readable text")
    .option("--domain <context>", "For a project, describe only this one domain")
    .action(async (source: string, opts: DescribeOptions) => {
      try {
        const { resolved, problems } = resolveDomainModels(source, opts.domain);
        for (const p of problems) process.stderr.write(`Warning: ${p}\n`);
        const multi = resolved.length > 1;

        if (opts.json) {
          const blocks = resolved.map(({ context, model }) => {
            const description = describeDomain(model, {
              focus: opts.focus,
              includePopulations: true,
            });
            return context ? { domain: context, ...description } : description;
          });
          process.stdout.write(JSON.stringify(multi ? blocks : blocks[0], null, 2) + "\n");
          return;
        }

        resolved.forEach(({ context, model }, i) => {
          if (multi && context) {
            process.stdout.write(`${i > 0 ? "\n" : ""}== ${context} ==\n\n`);
          }
          writeDescribe(model, opts);
        });
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/** Write one model's human-readable description to stdout. */
function writeDescribe(model: OrmModel, opts: DescribeOptions): void {
  const description = describeDomain(model, { focus: opts.focus, includePopulations: true });

  if (!opts.verbose) {
    process.stdout.write(description.summary + "\n");
    return;
  }

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
      process.stdout.write(`    Arity: ${ft.arity}, Constraints: ${ft.constraintCount}\n`);
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
}
