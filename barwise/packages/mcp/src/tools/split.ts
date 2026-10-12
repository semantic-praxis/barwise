/**
 * split_model tool: cuts one .orm.yaml model into a multi-domain project
 * -- a .orm-project.yaml manifest, one model per bounded context, and a
 * context mapping for each pair of contexts that share object types.
 *
 * The split is core's pure `splitModel`. This module adds the preview
 * summary and the write. The CLI's `project split` writes the same
 * `SplitResult` under the same refusal rule; it cannot import this module
 * (the CLI does not depend on `@barwise/mcp`), so the write loop is
 * parallel and every file name it writes is read from the result.
 */

import { type OrmModel, OrmYamlSerializer, splitModel, type SplitResult } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { readSource, type SourceInput } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

const serializer = new OrmYamlSerializer();

type TextResult = { content: Array<{ type: "text"; text: string; }>; };

export function registerSplitTool(server: McpServer): void {
  server.registerTool(
    "split_model",
    {
      title: "Split ORM Model into a Project",
      description: "Split one .orm.yaml model into a multi-domain project: a "
        + ".orm-project.yaml manifest, one .orm.yaml per bounded context under "
        + "domains/, and .map.yaml context mappings under mappings/ for object "
        + "types two contexts share. This is how to create a .orm-project.yaml "
        + "from an existing model. Get the entity names first (query_model, "
        + 'query "entities") and agree the assignment with the user. Call '
        + "without outDir to preview: nothing is written, and the result lists "
        + "each domain's entity types, the object types it shares, and every "
        + "warning (inferred placements, dropped cross-domain constraints). "
        + "Then call again with outDir to write. Refuses to overwrite existing "
        + "files unless force is true.",
      inputSchema: {
        source: sourceInputSchema("File path to the .orm.yaml model to split, or inline YAML"),
        projectName: z
          .string()
          .describe("Project name written into the generated .orm-project.yaml"),
        domains: z
          .record(z.string(), z.array(z.string()))
          .describe(
            "Each bounded-context name mapped to the entity type names it owns, "
              + 'e.g. { "auctions": ["Auction", "Bid"], "parties": ["Customer"] }. '
              + "At least two contexts. Value types can be left out: each follows "
              + "the fact types that use it. Anything that cannot be placed, and "
              + "the glossary, go to the first context.",
          ),
        outDir: z
          .string()
          .optional()
          .describe(
            "Directory to write the project into; relative paths resolve "
              + "against the server's working directory. Omit to preview.",
          ),
        force: z
          .boolean()
          .optional()
          .describe("Overwrite target files that already exist (default false)"),
      },
    },
    async ({ source, projectName, domains, outDir, force }) => {
      return executeSplit(source, projectName, domains, outDir, force);
    },
  );
}

/** What a reviewer needs to judge one domain of a split. */
interface DomainSummary {
  readonly context: string;
  /** Path relative to the project root. */
  readonly file: string;
  /** Entity types this domain owns. */
  readonly entityTypes?: readonly string[];
  readonly valueTypeCount?: number;
  /** Object types owned elsewhere and referenced here, with their owner. */
  readonly sharedObjectTypes?: ReadonlyArray<{ name: string; owner: string; }>;
  readonly factTypeCount?: number;
}

export function executeSplit(
  source: SourceInput,
  projectName: string,
  domains: Record<string, string[]>,
  outDir?: string,
  force?: boolean,
): TextResult {
  let result: SplitResult;
  try {
    result = splitModel(readSource(source), { projectName, domains });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) });
  }

  const summary = {
    projectName: projectName.trim(),
    manifest: result.manifestFileName,
    domains: result.domains.map((d) => summarize(d.context, d.fileName, d.yaml)),
    mappings: result.mappings.map((m) => m.fileName),
    warnings: result.warnings,
  };

  if (outDir === undefined || outDir.trim() === "") {
    return json({
      written: false,
      ...summary,
      next: "Nothing was written. Review the assignment and the warnings with "
        + "the user, then call again with outDir to write the project.",
    });
  }

  const root = resolve(outDir);
  const files: Array<[string, string]> = [
    ...result.domains.map((d): [string, string] => [d.fileName, d.yaml]),
    ...result.mappings.map((m): [string, string] => [m.fileName, m.yaml]),
    [result.manifestFileName, result.manifestYaml],
  ];

  // Checked before anything is written, so a refusal leaves the
  // directory exactly as it was.
  const existing = files
    .map(([name]) => join(root, name))
    .filter((path) => existsSync(path));
  if (existing.length > 0 && force !== true) {
    return json({
      error: `${existing.length} target file(s) already exist under ${root}. `
        + "Pass force: true to overwrite them, or choose another outDir.",
      existing,
    });
  }

  for (const [name, content] of files) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }

  const manifestPath = join(root, result.manifestFileName);
  return json({
    written: true,
    outDir: root,
    manifestPath,
    ...summary,
    next: `Validate the project: validate_model with source ${manifestPath}.`,
  });
}

/**
 * Summarize a generated domain file. A domain that does not deserialize
 * is already reported in the split's warnings, so it gets the bare entry
 * rather than failing the whole preview.
 */
function summarize(context: string, file: string, yaml: string): DomainSummary {
  let model: OrmModel;
  try {
    model = serializer.deserialize(yaml);
  } catch {
    return { context, file };
  }
  const owned = model.objectTypes.filter((o) => o.sourceContext === undefined);
  return {
    context,
    file,
    entityTypes: owned.filter((o) => o.kind === "entity").map((o) => o.name),
    valueTypeCount: owned.filter((o) => o.kind === "value").length,
    sharedObjectTypes: model.objectTypes
      .filter((o) => o.sourceContext !== undefined)
      .map((o) => ({ name: o.name, owner: o.sourceContext! })),
    factTypeCount: model.factTypes.length,
  };
}

function json(body: unknown): TextResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
