/**
 * barwise analyze <repo>
 *
 * Analyze a GitHub repository to extract business rules and constraints.
 * Phase 1 supports --profile-only to show the repo profile without
 * running the full analysis pipeline.
 *
 * Example:
 *   barwise analyze MyOrg/MyRepo --profile-only
 *   barwise analyze MyOrg/MyRepo --profile-only --format json
 *   barwise analyze MyOrg/MyRepo --ref v2.0.0 --profile-only
 */

import {
  formatRepoRef,
  parseRepoRef,
  profileRepository,
  registerCodeFormats,
  RepoManager,
} from "@barwise/code-analysis";
import type { RepoProfile } from "@barwise/code-analysis";
import { getImporter, type OrmModel, OrmYamlSerializer } from "@barwise/core";
import type { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { writeOutput } from "../workspace/io.js";

registerCodeFormats();

/**
 * Extract a model from the profiled repository: run the detected code
 * importer over the detected domain scope. A single detected domain
 * path narrows the scan to it; multiple paths (or none) fall back to
 * the repo root, which the importers scan recursively.
 */
async function extractModel(
  localPath: string,
  profile: RepoProfile,
  modelName: string,
): Promise<OrmModel> {
  if (!profile.importFormat) {
    throw new Error(
      "no deterministic import format detected for this repository "
        + "(use `barwise import transcript` with an LLM provider instead)",
    );
  }
  const format = getImporter(profile.importFormat);
  if (!format?.parseAsync) {
    throw new Error(`import format "${profile.importFormat}" is not registered`);
  }
  const scope = profile.domainPaths.length === 1
    ? resolve(localPath, profile.domainPaths[0]!)
    : localPath;
  const result = await format.parseAsync(scope, { modelName });
  return result.model;
}

export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze")
    .description("Analyze a GitHub repository for business rules and constraints")
    .argument("<repo>", "GitHub repository (owner/name)")
    .option("--profile-only", "Show repository profile without running full analysis")
    .option("--ref <ref>", "Branch, tag, or commit to analyze")
    .option("--depth <depth>", "Clone depth (0 for full clone)", "1")
    .option("--domain <name>", "Model name for the extracted domain")
    .option("--output <file>", "Write the extracted .orm.yaml here (default: stdout)")
    .option("--format <format>", "Output format (text or json)", "text")
    .action(
      async (
        repoArg: string,
        opts: {
          profileOnly?: boolean;
          ref?: string;
          depth: string;
          domain?: string;
          output?: string;
          format: string;
        },
      ) => {
        try {
          // A local directory analyzes in place -- no clone, no auth.
          if (existsSync(repoArg) && statSync(repoArg).isDirectory()) {
            await analyzePath(resolve(repoArg), repoArg, opts);
            return;
          }

          // Parse repo reference.
          const repo = parseRepoRef(repoArg);
          const manager = new RepoManager();

          // Check GitHub CLI auth.
          process.stderr.write("Checking GitHub authentication...\n");
          await manager.checkAuth();

          // Clone or update.
          let localPath: string;
          if (manager.exists(repo)) {
            process.stderr.write(
              `Repository ${formatRepoRef(repo)} already cloned. Pulling latest...\n`,
            );
            const commit = await manager.pull(repo);
            localPath = manager.localPath(repo);
            process.stderr.write(`Updated to ${commit.slice(0, 8)}.\n`);
          } else {
            process.stderr.write(
              `Cloning ${formatRepoRef(repo)}...\n`,
            );
            const depth = Number.parseInt(opts.depth, 10);
            localPath = await manager.clone(repo, {
              depth: Number.isNaN(depth) ? 1 : depth,
              ref: opts.ref,
            });
            const commit = await manager.head(repo);
            process.stderr.write(
              `Cloned to ${localPath} (${commit.slice(0, 8)}).\n`,
            );
          }

          await analyzePath(localPath, repoArg, opts);
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}

/** Profile a local checkout and, unless --profile-only, extract a model. */
async function analyzePath(
  localPath: string,
  repoArg: string,
  opts: {
    profileOnly?: boolean;
    domain?: string;
    output?: string;
    format: string;
  },
): Promise<void> {
  process.stderr.write("Profiling repository...\n");
  const profile = profileRepository(localPath);

  if (opts.profileOnly) {
    const rendered = opts.format === "json"
      ? formatProfileJson(profile, repoArg)
      : formatProfileText(profile, repoArg);
    process.stdout.write(rendered + "\n");
    return;
  }

  process.stderr.write(formatProfileText(profile, repoArg) + "\n\n");
  process.stderr.write("Extracting business rules...\n");
  const modelName = opts.domain ?? basename(localPath);
  const model = await extractModel(localPath, profile, modelName);
  writeOutput(new OrmYamlSerializer().serialize(model), opts.output);
  process.stderr.write(
    `Extracted ${model.objectTypes.length} object types, `
      + `${model.factTypes.length} fact types.\n`,
  );
}

/** Format a repo profile as human-readable text. */
function formatProfileText(profile: RepoProfile, repo: string): string {
  const lines: string[] = [];
  lines.push(`Repository: ${repo}`);
  lines.push("");
  lines.push(profile.summary);
  lines.push("");
  lines.push("--- Details ---");
  lines.push(`Language: ${profile.language}`);
  lines.push(`Framework: ${profile.framework?.name ?? "none"}`);
  if (profile.framework) {
    lines.push(`  Confidence: ${profile.framework.confidence}`);
    lines.push(`  Score: ${profile.framework.score}`);
    for (const signal of profile.framework.signals) {
      lines.push(`  Signal: ${signal.indicator} (${signal.weight})`);
    }
  }
  lines.push(`Build system: ${profile.buildSystem?.name ?? "none"}`);
  lines.push(`Source files: ${profile.sourceFileCount}`);
  lines.push(`Import format: ${profile.importFormat ?? "none (LLM fallback)"}`);
  if (profile.domainPaths.length > 0) {
    lines.push(`Domain paths: ${profile.domainPaths.length}`);
    for (const p of profile.domainPaths) {
      lines.push(`  ${p}`);
    }
  }
  if (profile.excludePaths.length > 0) {
    lines.push(`Exclude paths: ${profile.excludePaths.join(", ")}`);
  }
  return lines.join("\n");
}

/** Format a repo profile as JSON. */
function formatProfileJson(profile: RepoProfile, repo: string): string {
  return JSON.stringify(
    {
      repo,
      language: profile.language,
      framework: profile.framework
        ? {
          name: profile.framework.name,
          confidence: profile.framework.confidence,
          score: profile.framework.score,
          signals: profile.framework.signals.map((s) => ({
            indicator: s.indicator,
            location: s.location,
            weight: s.weight,
          })),
        }
        : null,
      buildSystem: profile.buildSystem
        ? {
          name: profile.buildSystem.name,
          buildFile: profile.buildSystem.buildFile,
        }
        : null,
      domainPaths: profile.domainPaths,
      excludePaths: profile.excludePaths,
      sourceFileCount: profile.sourceFileCount,
      importFormat: profile.importFormat,
    },
    null,
    2,
  );
}
