/**
 * barwise lineage <subcommand>
 *
 * Lineage tracking and staleness detection.
 */

import { analyzeImpact, checkStaleness } from "@barwise/core/lineage";
import type { Command } from "commander";
import { dirname, resolve } from "node:path";
import { loadModel } from "../workspace/io.js";
import { readManifest } from "../workspace/lineageIo.js";

export function registerLineageCommand(program: Command): void {
  const lineage = program
    .command("lineage")
    .description("Lineage tracking and staleness detection");

  // barwise lineage status <source>
  lineage
    .command("status")
    .description("Check staleness of exported artifacts")
    .argument("<source>", "Path to .orm.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .action(async (source: string, opts: { format: string; }) => {
      try {
        const model = loadModel(source);
        const dir = dirname(resolve(source));
        const report = checkStaleness(readManifest(dir), model);

        if (opts.format === "json") {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          return;
        }

        if (!report.manifestFound) {
          process.stdout.write("No lineage manifest found.\n");
          process.stdout.write(
            "Run 'barwise export' to generate artifacts and create the manifest.\n",
          );
          return;
        }

        if (report.staleArtifacts.length === 0) {
          process.stdout.write("All artifacts are fresh.\n");
          if (report.freshArtifacts.length > 0) {
            process.stdout.write(
              `${report.freshArtifacts.length} artifact(s) up to date.\n`,
            );
          }
          return;
        }

        process.stdout.write(
          `${report.staleArtifacts.length} stale artifact(s) found:\n\n`,
        );

        for (const stale of report.staleArtifacts) {
          process.stdout.write(`  ${stale.artifact} (${stale.format})\n`);
          process.stdout.write(`    Exported: ${stale.exportedAt}\n`);
          process.stdout.write(`    Reason: ${stale.reason}\n`);
        }

        if (report.freshArtifacts.length > 0) {
          process.stdout.write(
            `\n${report.freshArtifacts.length} artifact(s) still fresh.\n`,
          );
        }

        // Exit code 1 if any artifacts are stale (useful for CI)
        process.exitCode = 1;
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  // barwise lineage impact <source> --element <id>
  lineage
    .command("impact")
    .description("Show impact of changing a model element")
    .argument("<source>", "Path to .orm.yaml file")
    .requiredOption("--element <id>", "Element ID to analyze")
    .option("--format <format>", "Output format (text or json)", "text")
    .action(
      async (source: string, opts: { element: string; format: string; }) => {
        try {
          const dir = dirname(resolve(source));
          const report = analyzeImpact(readManifest(dir), opts.element);

          if (opts.format === "json") {
            process.stdout.write(JSON.stringify(report, null, 2) + "\n");
            return;
          }

          process.stdout.write(
            `Impact analysis for element: ${report.changedElement}\n\n`,
          );

          if (report.affectedArtifacts.length === 0) {
            process.stdout.write("No artifacts depend on this element.\n");
            return;
          }

          process.stdout.write(
            `${report.affectedArtifacts.length} artifact(s) affected:\n\n`,
          );

          for (const affected of report.affectedArtifacts) {
            process.stdout.write(
              `  ${affected.artifact} (${affected.format})\n`,
            );
            process.stdout.write(`    ${affected.relationship}\n`);
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );

  // barwise lineage show <source>
  lineage
    .command("show")
    .description("Show the lineage manifest")
    .argument("<source>", "Path to .orm.yaml file")
    .option("--format <format>", "Output format (text or json)", "text")
    .action(async (source: string, opts: { format: string; }) => {
      try {
        const dir = dirname(resolve(source));
        const manifest = readManifest(dir);

        if (!manifest) {
          process.stdout.write("No lineage manifest found.\n");
          process.stdout.write(
            "Run 'barwise export' to generate artifacts and create the manifest.\n",
          );
          return;
        }

        if (opts.format === "json") {
          process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
          return;
        }

        process.stdout.write(`Lineage Manifest\n`);
        process.stdout.write(`================\n\n`);
        process.stdout.write(`Source Model: ${manifest.sourceModel}\n`);
        process.stdout.write(
          `Model Hash: ${manifest.sourceModelHash.substring(0, 16)}...\n`,
        );
        process.stdout.write(`Exports: ${manifest.exports.length}\n\n`);

        for (const exp of manifest.exports) {
          process.stdout.write(`${exp.artifact}\n`);
          process.stdout.write(`  Format: ${exp.format}\n`);
          process.stdout.write(`  Exported: ${exp.exportedAt}\n`);
          process.stdout.write(
            `  Model Hash: ${exp.modelHash.substring(0, 16)}...\n`,
          );
          process.stdout.write(`  Sources: ${exp.sources.length} element(s)\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}
