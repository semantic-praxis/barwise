/**
 * analyze_repository tool: clone, profile, and extract business rules
 * from a code repository (repo-analysis spec, MCP entry point).
 *
 * Cloning is a side effect, so a remote repo that is not yet cloned
 * returns `requiresConfirmation: true` and no clone happens; the AI
 * client presents that to the user and retries with `confirm: true`.
 * Local paths and already-cloned repos proceed directly.
 */
import {
  formatRepoRef,
  parseRepoRef,
  profileRepository,
  registerCodeFormats,
  RepoManager,
  type RepoProfile,
} from "@barwise/code-analysis";
import { getImporter, OrmYamlSerializer } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { boundedTextResult } from "../workspace/response.js";

registerCodeFormats();

type TextResult = { content: Array<{ type: "text"; text: string; }>; };

export interface AnalyzeRepositoryOptions {
  readonly ref?: string;
  readonly domain?: string;
  readonly profileOnly?: boolean;
  readonly confirm?: boolean;
}

export function registerAnalyzeRepositoryTool(server: McpServer): void {
  server.registerTool(
    "analyze_repository",
    {
      title: "Analyze Repository",
      description: "Clone, profile, and extract business rules from a code "
        + "repository. Accepts a GitHub org/repo or a local path. Cloning a "
        + "new remote repo requires a second call with confirm=true after "
        + "the user approves. Returns the repo profile (language, framework, "
        + "domain paths) and, unless profileOnly, the extracted .orm.yaml.",
      inputSchema: {
        repo: z.string().describe("GitHub org/repo (e.g. 'MyOrg/Foo') or local path"),
        ref: z.string().optional().describe("Branch, tag, or commit to analyze"),
        domain: z.string().optional().describe("Model name for the extracted domain"),
        profileOnly: z.boolean().optional().describe("Only profile, do not extract"),
        confirm: z.boolean().optional().describe(
          "Confirm cloning a not-yet-cloned remote repository",
        ),
      },
    },
    async ({ repo, ref, domain, profileOnly, confirm }) =>
      executeAnalyzeRepository(repo, { ref, domain, profileOnly, confirm }),
  );
}

export async function executeAnalyzeRepository(
  repoArg: string,
  options: AnalyzeRepositoryOptions = {},
): Promise<TextResult> {
  let localPath: string;
  let repoLabel = repoArg;

  if (existsSync(repoArg) && statSync(repoArg).isDirectory()) {
    localPath = resolve(repoArg);
  } else {
    const repo = parseRepoRef(repoArg);
    repoLabel = formatRepoRef(repo);
    const manager = new RepoManager();
    if (manager.exists(repo)) {
      await manager.pull(repo);
      localPath = manager.localPath(repo);
    } else if (!options.confirm) {
      return jsonResult({
        requiresConfirmation: true,
        message: `Cloning ${repoLabel} to the local repo store is required. `
          + `Ask the user to approve, then call again with confirm=true.`,
      });
    } else {
      await manager.checkAuth();
      localPath = await manager.clone(repo, { depth: 1, ref: options.ref });
    }
  }

  const profile = profileRepository(localPath);
  const profileJson = {
    repo: repoLabel,
    language: profile.language,
    framework: profile.framework?.name ?? null,
    buildSystem: profile.buildSystem?.name ?? null,
    importFormat: profile.importFormat,
    domainPaths: profile.domainPaths,
    sourceFileCount: profile.sourceFileCount,
    summary: profile.summary,
  };

  if (options.profileOnly) {
    return jsonResult({ profile: profileJson });
  }

  const model = await extractModel(localPath, profile, options.domain ?? repoLabel);
  const yaml = new OrmYamlSerializer().serialize(model);
  return boundedTextResult(
    JSON.stringify(
      {
        profile: profileJson,
        objectTypes: model.objectTypes.length,
        factTypes: model.factTypes.length,
        model: yaml,
      },
      null,
      2,
    ),
    { kind: "repo-analysis" },
  ) as TextResult;
}

async function extractModel(
  localPath: string,
  profile: RepoProfile,
  modelName: string,
) {
  if (!profile.importFormat) {
    throw new Error(
      "no deterministic import format detected for this repository "
        + "(use import_transcript with an LLM provider instead)",
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

function jsonResult(payload: unknown): TextResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
