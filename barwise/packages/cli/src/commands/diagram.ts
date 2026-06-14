/**
 * barwise diagram <file>
 *
 * Generates an SVG diagram from an ORM model. Given an
 * .orm-project.yaml manifest, generates one SVG per domain.
 */

import { generateDiagram } from "@barwise/diagram";
import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isProjectFile, loadModel, writeOutput } from "../helpers/io.js";
import { loadProject } from "../helpers/projectLoader.js";

export function registerDiagramCommand(program: Command): void {
  program
    .command("diagram")
    .description("Generate an SVG diagram from an ORM model or project")
    .argument("<file>", "Path to .orm.yaml or .orm-project.yaml file")
    .option("--output <path>", "Write SVG to file (model) or directory (project)")
    .option(
      "--domain <context>",
      "For a project, diagram only this one domain (writes a single SVG)",
    )
    .action(
      async (file: string, opts: { output?: string; domain?: string; }) => {
        // Print deprecation notice to stderr.
        process.stderr.write(
          "Note: 'barwise diagram' is deprecated. Use 'barwise export --format svg' instead (when available).\n\n",
        );

        try {
          if (isProjectFile(file)) {
            if (opts.domain) {
              await diagramDomain(file, opts.domain, opts.output);
            } else {
              await diagramProject(file, opts.output);
            }
          } else {
            const model = loadModel(file);
            const result = await generateDiagram(model);
            writeOutput(result.svg, opts.output);
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}

/**
 * Generate a single SVG for one named domain of a project. The SVG is
 * written like an ordinary model diagram (to `--output` or stdout).
 */
async function diagramDomain(
  file: string,
  context: string,
  output?: string,
): Promise<void> {
  const { project, problems } = loadProject(file);
  for (const problem of problems) {
    process.stderr.write(`Warning: ${problem}\n`);
  }

  const domain = project.getDomain(context);
  if (!domain) {
    const available = project.domains.map((d) => d.context).join(", ");
    process.stderr.write(
      `Error: project has no domain "${context}". Available: ${available}.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (!domain.model) {
    process.stderr.write(
      `Error: domain "${context}" could not be loaded; see warnings above.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const result = await generateDiagram(domain.model);
  writeOutput(result.svg, output);
}

/**
 * Generate one SVG per domain in a project, written as
 * `<outputDir>/<context>.svg`. An output directory is required because
 * a project produces multiple SVGs.
 */
async function diagramProject(file: string, outputDir?: string): Promise<void> {
  if (!outputDir) {
    process.stderr.write(
      "Error: diagramming a project requires --output <dir>.\n",
    );
    process.exitCode = 1;
    return;
  }

  const { project, problems } = loadProject(file);
  for (const problem of problems) {
    process.stderr.write(`Warning: ${problem}\n`);
  }

  mkdirSync(outputDir, { recursive: true });
  const written: string[] = [];
  for (const domain of project.domains) {
    if (!domain.model) continue;
    const result = await generateDiagram(domain.model);
    const outPath = join(outputDir, `${domain.context}.svg`);
    writeFileSync(outPath, result.svg, "utf-8");
    written.push(outPath);
  }

  if (written.length === 0) {
    process.stderr.write("Error: no domain models could be diagrammed.\n");
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`Wrote ${written.length} diagram(s):\n`);
  for (const path of written) {
    process.stderr.write(`  ${path}\n`);
  }
}
