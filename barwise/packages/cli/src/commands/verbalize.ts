/**
 * barwise verbalize <file>
 *
 * Generates FORML verbalizations for an `.orm.yaml` model, or -- given a
 * `.orm-project.yaml` -- for each domain (or one chosen with `--domain`).
 */

import type { OrmModel } from "@barwise/core";
import { type Counterexample, generateCounterexamples } from "@barwise/core/counterexample";
import { Verbalizer } from "@barwise/core/verbalization";
import type { Command } from "commander";
import { resolveDomainModels } from "../helpers/domainModels.js";
import {
  formatCounterexamples,
  formatVerbalizations,
  formatVerbalizationsJson,
} from "../helpers/format.js";

interface VerbalizeOptions {
  format: string;
  factType?: string;
  counterexamples?: boolean;
  domain?: string;
}

export function registerVerbalizeCommand(program: Command): void {
  program
    .command("verbalize")
    .description("Generate FORML verbalizations for an ORM model")
    .argument("<file>", "Path to .orm.yaml or .orm-project.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--fact-type <name>", "Verbalize a specific fact type only")
    .option(
      "--counterexamples",
      "Also show the minimal population each constraint rules out",
    )
    .option("--domain <context>", "For a project, verbalize only this one domain")
    .action(async (file: string, opts: VerbalizeOptions) => {
      try {
        const { resolved, problems } = resolveDomainModels(file, opts.domain);
        for (const p of problems) process.stderr.write(`Warning: ${p}\n`);

        const verbalizer = new Verbalizer();
        const multi = resolved.length > 1;

        // A single model keeps the original "fact type not found" hard error;
        // across a project's domains a missing fact type just skips a domain.
        if (!multi && opts.factType && !resolved[0]!.model.getFactTypeByName(opts.factType)) {
          process.stderr.write(`Error: Fact type "${opts.factType}" not found in model.\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === "json") {
          if (!multi) {
            process.stdout.write(singleJson(verbalizer, resolved[0]!.model, opts) + "\n");
            return;
          }
          const blocks = resolved.map(({ context, model }) => ({
            domain: context,
            ...jsonPayload(verbalizer, model, opts),
          }));
          process.stdout.write(JSON.stringify(blocks, null, 2) + "\n");
          return;
        }

        const parts = resolved.map(({ context, model }) => {
          const body = textBody(verbalizer, model, opts);
          return multi && context ? `== ${context} ==\n\n${body}` : body;
        });
        process.stdout.write(parts.join("\n\n") + "\n");
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/** Verbalizations (and optional counterexamples) for one model. */
function compute(verbalizer: Verbalizer, model: OrmModel, opts: VerbalizeOptions) {
  let factTypeId: string | undefined;
  let verbalizations;
  if (opts.factType) {
    const ft = model.getFactTypeByName(opts.factType);
    verbalizations = ft ? verbalizer.verbalizeFactType(ft.id, model) : [];
    factTypeId = ft?.id;
  } else {
    verbalizations = verbalizer.verbalizeModel(model);
  }

  let counterexamples: readonly Counterexample[] = [];
  if (opts.counterexamples) {
    counterexamples = generateCounterexamples(model).filter(
      (c) => factTypeId === undefined || c.factTypeId === factTypeId,
    );
  }
  return { verbalizations, counterexamples };
}

function textBody(verbalizer: Verbalizer, model: OrmModel, opts: VerbalizeOptions): string {
  const { verbalizations, counterexamples } = compute(verbalizer, model, opts);
  let out = formatVerbalizations(verbalizations);
  if (counterexamples.length > 0) {
    out += "\n\n" + formatCounterexamples(counterexamples);
  }
  return out;
}

function jsonPayload(verbalizer: Verbalizer, model: OrmModel, opts: VerbalizeOptions): object {
  const { verbalizations, counterexamples } = compute(verbalizer, model, opts);
  if (!opts.counterexamples) {
    return JSON.parse(formatVerbalizationsJson(verbalizations)) as object;
  }
  return {
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
  };
}

/** Single-model JSON output, byte-for-byte as the pre-project command emitted. */
function singleJson(verbalizer: Verbalizer, model: OrmModel, opts: VerbalizeOptions): string {
  const { verbalizations, counterexamples } = compute(verbalizer, model, opts);
  if (!opts.counterexamples) {
    return formatVerbalizationsJson(verbalizations);
  }
  return JSON.stringify(
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
  );
}
