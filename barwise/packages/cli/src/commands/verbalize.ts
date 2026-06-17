/**
 * barwise verbalize <file>
 *
 * Loads an .orm.yaml file and generates FORML verbalizations
 * for all fact types and constraints.
 */

import { type Counterexample, generateCounterexamples } from "@barwise/core/counterexample";
import { Verbalizer } from "@barwise/core/verbalization";
import type { Command } from "commander";
import {
  formatCounterexamples,
  formatVerbalizations,
  formatVerbalizationsJson,
} from "../helpers/format.js";
import { loadModel } from "../helpers/io.js";

export function registerVerbalizeCommand(program: Command): void {
  program
    .command("verbalize")
    .description("Generate FORML verbalizations for an ORM model")
    .argument("<file>", "Path to .orm.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--fact-type <name>", "Verbalize a specific fact type only")
    .option(
      "--counterexamples",
      "Also show the minimal population each constraint rules out",
    )
    .action(
      async (
        file: string,
        opts: { format: string; factType?: string; counterexamples?: boolean; },
      ) => {
        try {
          const model = loadModel(file);
          const verbalizer = new Verbalizer();

          let verbalizations;
          let factTypeId: string | undefined;
          if (opts.factType) {
            const ft = model.getFactTypeByName(opts.factType);
            if (!ft) {
              process.stderr.write(
                `Error: Fact type "${opts.factType}" not found in model.\n`,
              );
              process.exitCode = 1;
              return;
            }
            factTypeId = ft.id;
            verbalizations = verbalizer.verbalizeFactType(ft.id, model);
          } else {
            verbalizations = verbalizer.verbalizeModel(model);
          }

          let counterexamples: readonly Counterexample[] = [];
          if (opts.counterexamples) {
            counterexamples = generateCounterexamples(model).filter(
              (c) => factTypeId === undefined || c.factTypeId === factTypeId,
            );
          }

          if (opts.format === "json") {
            if (opts.counterexamples) {
              process.stdout.write(
                JSON.stringify(
                  {
                    verbalizations: verbalizations.map((v) => ({
                      category: v.category,
                      text: v.text,
                      sourceElementId: v.sourceElementId,
                    })),
                    counterexamples: counterexamples.map((c) => ({
                      factTypeId: c.factTypeId,
                      constraintType: c.constraintType,
                      text: c.text,
                    })),
                  },
                  null,
                  2,
                ) + "\n",
              );
            } else {
              process.stdout.write(
                formatVerbalizationsJson(verbalizations) + "\n",
              );
            }
          } else {
            let out = formatVerbalizations(verbalizations);
            if (counterexamples.length > 0) {
              out += "\n\n" + formatCounterexamples(counterexamples);
            }
            process.stdout.write(out + "\n");
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
