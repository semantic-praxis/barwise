/**
 * barwise project init <name>
 * barwise project split <source.orm.yaml> --config <config.yaml>
 *
 * Scaffolds and populates multi-domain `.orm-project.yaml` projects.
 */

import {
  ModelSplitError,
  parseSplitConfig,
  scaffoldProject,
  scaffoldSplitConfig,
  splitModel,
} from "@barwise/core";
import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readFile } from "../workspace/io.js";

/** Lowercase a name into a filesystem- and context-safe slug. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "project";
}

export function registerProjectCommand(program: Command): void {
  const projectCmd = program
    .command("project")
    .description("Scaffold and manage multi-domain ORM projects");

  registerInit(projectCmd);
  registerSplit(projectCmd);
}

/** `barwise project init <name>` */
function registerInit(projectCmd: Command): void {
  projectCmd
    .command("init")
    .description("Create an empty .orm-project.yaml with the standard layout")
    .argument("<name>", "Project name")
    .option(
      "--dir <path>",
      "Directory to create the project in (default: a new ./<slug> directory)",
    )
    .action((name: string, opts: { dir?: string; }) => {
      try {
        const root = opts.dir ? resolve(opts.dir) : resolve(slugify(name));
        const manifestPath = join(root, `${slugify(name)}.orm-project.yaml`);

        if (existsSync(manifestPath)) {
          process.stderr.write(
            `Error: a project manifest already exists at ${manifestPath}.\n`,
          );
          process.exitCode = 1;
          return;
        }

        mkdirSync(join(root, "domains"), { recursive: true });
        mkdirSync(join(root, "mappings"), { recursive: true });
        writeFileSync(manifestPath, scaffoldProject(name), "utf-8");

        process.stderr.write(`Created project "${name}":\n`);
        process.stderr.write(`  ${manifestPath}\n`);
        process.stderr.write(`  ${join(root, "domains")}/\n`);
        process.stderr.write(`  ${join(root, "mappings")}/\n`);
        process.stderr.write(
          "\nAdd domain models with 'barwise project split', or place "
            + ".orm.yaml files in domains/ and list them in the manifest.\n",
        );
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/** `barwise project split <source> --config <config>` */
function registerSplit(projectCmd: Command): void {
  projectCmd
    .command("split")
    .description("Cut a monolithic .orm.yaml model into a multi-domain project")
    .argument("<source>", "Path to the .orm.yaml model to split")
    .option("--config <path>", "Path to the split config YAML")
    .option("--out <dir>", "Directory to write the project into", ".")
    .option(
      "--scaffold-config",
      "Print a starter split config for <source> instead of splitting",
    )
    .option(
      "--domains <list>",
      "Comma-separated context names (used with --scaffold-config)",
    )
    .option("--force", "Overwrite an existing manifest in the output directory")
    .action(
      (
        source: string,
        opts: {
          config?: string;
          out: string;
          scaffoldConfig?: boolean;
          domains?: string;
          force?: boolean;
        },
      ) => {
        try {
          const modelYaml = readFile(source);

          if (opts.scaffoldConfig) {
            const contexts = (opts.domains ?? "")
              .split(",")
              .map((c) => c.trim())
              .filter((c) => c.length > 0);
            process.stdout.write(scaffoldSplitConfig(modelYaml, contexts));
            return;
          }

          if (!opts.config) {
            process.stderr.write(
              "Error: --config <path> is required. Generate a starter "
                + "config with --scaffold-config --domains a,b,c.\n",
            );
            process.exitCode = 1;
            return;
          }

          const config = parseSplitConfig(readFile(opts.config));
          const result = splitModel(modelYaml, config);

          const root = resolve(opts.out);
          const manifestPath = join(root, "project.orm-project.yaml");
          if (existsSync(manifestPath) && !opts.force) {
            process.stderr.write(
              `Error: ${manifestPath} already exists. Use --force to `
                + "overwrite or --out to choose another directory.\n",
            );
            process.exitCode = 1;
            return;
          }

          for (const domain of result.domains) {
            const path = join(root, domain.fileName);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, domain.yaml, "utf-8");
          }
          for (const mapping of result.mappings) {
            const path = join(root, mapping.fileName);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, mapping.yaml, "utf-8");
          }
          mkdirSync(root, { recursive: true });
          writeFileSync(manifestPath, result.manifestYaml, "utf-8");

          process.stderr.write(
            `Split ${source} into ${result.domains.length} domain(s) and `
              + `${result.mappings.length} mapping(s):\n`,
          );
          process.stderr.write(`  ${manifestPath}\n`);
          for (const domain of result.domains) {
            process.stderr.write(`  ${join(root, domain.fileName)}\n`);
          }
          for (const mapping of result.mappings) {
            process.stderr.write(`  ${join(root, mapping.fileName)}\n`);
          }

          if (result.warnings.length > 0) {
            process.stderr.write(
              `\n${result.warnings.length} warning(s) -- review and make the `
                + "config explicit where needed:\n",
            );
            for (const warning of result.warnings) {
              process.stderr.write(`  - ${warning}\n`);
            }
          }

          process.stderr.write(
            `\nValidate the result: barwise validate ${manifestPath}\n`,
          );
        } catch (err) {
          const prefix = err instanceof ModelSplitError ? "Split error" : "Error";
          process.stderr.write(`${prefix}: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
