/**
 * rename_element tool: rename an object type, a fact type or a role, in a
 * model or across a project (iri-identity WS5b).
 *
 * An editing tool, like `merge_models`: given a file it writes back, given
 * inline YAML it returns the result. Files are written from the model, so
 * YAML comments in a rewritten file are lost (barwise-ok6). The write is
 * staged, every file before any is replaced, with the same module the CLI's
 * `rename` and `migrate` use (`workspace/stagedWrite.ts`, paired in
 * `parity.manifest.json`).
 */

import { MappingSerializer, OrmYamlSerializer } from "@barwise/core";
import { renameInModel, renameInProject, type RenameTarget } from "@barwise/core/rename";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { loadProject } from "../workspace/projectLoader.js";
import {
  isProjectSource,
  resolveSource,
  type SourceInput,
  sourcePath,
} from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";
import { type FileWrite, writeFilesAtomically } from "../workspace/stagedWrite.js";

type TextResult = { content: Array<{ type: "text"; text: string; }>; };

export interface RenameElementInput {
  readonly source: SourceInput;
  readonly domain?: string;
  readonly objectType?: string;
  readonly factType?: string;
  readonly role?: string;
  readonly rolePosition?: number;
  readonly to: string;
  readonly check?: boolean;
}

export function registerRenameTool(server: McpServer): void {
  server.registerTool(
    "rename_element",
    {
      title: "Rename ORM Element",
      // The write-back is deliberate, as for merge_models: MCP is an
      // editing surface. An agent reads this description, not MCP.md.
      description: "Rename an object type, a fact type, or a role (name it with factType "
        + "plus role or rolePosition). Every id is kept; the element's definition and the "
        + "reference mode of an entity keyed by a renamed value type follow it. Given a "
        + ".orm-project.yaml source and a domain, the rename also follows into shadows in "
        + "other domains and both sides of mapping files. Given a file, the changed files "
        + "are written back (writtenTo in the result) unless check is true; given inline "
        + "YAML, the renamed model is returned. Comments in rewritten files are lost.",
      inputSchema: {
        source: sourceInputSchema(
          "File path or inline YAML for a model, or a .orm-project.yaml path",
        ),
        domain: z.string().optional().describe(
          "For a project source: the domain that holds the element",
        ),
        objectType: z.string().optional().describe("The object type to rename"),
        factType: z.string().optional().describe(
          "The fact type to rename, or the one holding the role",
        ),
        role: z.string().optional().describe("With factType: the role to rename, by name"),
        rolePosition: z.number().int().min(0).optional().describe(
          "With factType: the role to rename, by position (0-based)",
        ),
        to: z.string().describe("The new name"),
        check: z.boolean().optional().describe("Write nothing; report what would change"),
      },
    },
    async (input) => executeRename(input),
  );
}

export function executeRename(input: RenameElementInput): TextResult {
  try {
    const target = targetOf(input);
    if (isProjectSource(input.source)) return renameProjectSource(input, target);
    if (input.domain !== undefined) {
      return json({ error: "domain is for a .orm-project.yaml source." });
    }
    return renameModelSource(input, target);
  } catch (err) {
    return json({ error: (err as Error).message });
  }
}

function targetOf(input: RenameElementInput): RenameTarget {
  if (input.role !== undefined || input.rolePosition !== undefined) {
    if (input.role !== undefined && input.rolePosition !== undefined) {
      throw new Error("Name the role by role or rolePosition, not both.");
    }
    if (input.factType === undefined || input.objectType !== undefined) {
      throw new Error("A role is named with factType and role or rolePosition.");
    }
    return { kind: "role", factType: input.factType, role: input.rolePosition ?? input.role! };
  }
  if ((input.objectType === undefined) === (input.factType === undefined)) {
    throw new Error("Name exactly one of objectType or factType.");
  }
  return input.objectType !== undefined
    ? { kind: "objectType", name: input.objectType }
    : { kind: "factType", name: input.factType! };
}

function renameModelSource(input: RenameElementInput, target: RenameTarget): TextResult {
  // Leniently, as renameInModel expects: a model with a dangling reference
  // renames, and validation reports what it reported before.
  const model = resolveSource(input.source, { lenient: true });
  const warnings = model.domainContext === undefined ? [] : [
    `The model declares domain "${model.domainContext}". If it is a domain of a project, `
    + `rename it through the .orm-project.yaml and domain instead, so its shadows and mapping `
    + `files follow.`,
  ];
  const { model: renamed, changes } = renameInModel(model, target, input.to);
  const yaml = new OrmYamlSerializer().serialize(renamed);
  const path = sourcePath(input.source);
  if (path === undefined) return json({ yaml, changes, warnings });
  return writeBack([{ path, text: yaml }], changes, warnings, input.check === true);
}

function renameProjectSource(input: RenameElementInput, target: RenameTarget): TextResult {
  if (input.domain === undefined) return json({ error: "A project source needs domain." });
  const manifest = sourcePath(input.source)!;
  // Leniently, as validate_model assembles a project, so a domain with a
  // dangling reference renames as it would on its own.
  const { project, problems } = loadProject(manifest, { lenient: true });
  if (problems.length > 0) {
    return json({
      error: "The project did not load cleanly, and a rename cannot follow into a file that "
        + `did not load: ${problems.join("; ")}`,
    });
  }
  const result = renameInProject(project, input.domain, target, input.to);
  const base = dirname(manifest);
  const models = new OrmYamlSerializer();
  const mappings = new MappingSerializer();
  const writes: FileWrite[] = result.files.map((path) => {
    const owner = result.project.domains.find((d) => d.path === path);
    if (owner) return { path: resolve(base, path), text: models.serialize(owner.model!) };
    const mapping = result.project.mappings.find((m) => m.path === path)!;
    return { path: resolve(base, path), text: mappings.serialize(mapping) };
  });
  return writeBack(writes, result.changes, [], input.check === true);
}

function writeBack(
  writes: readonly FileWrite[],
  changes: readonly string[],
  warnings: readonly string[],
  check: boolean,
): TextResult {
  const files = writes.map((w) => w.path);
  if (check) return json({ written: false, files, changes, warnings });
  writeFilesAtomically(writes);
  return json({ written: true, writtenTo: files, changes, warnings });
}

function json(body: unknown): TextResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
