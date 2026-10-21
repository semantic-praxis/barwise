/**
 * Commander program definition for the barwise CLI.
 *
 * Each command group is registered from its own module, and loaded only
 * when it is needed (docs/specs/cli-lazy-command-loading.spec.md).
 */

import { Command } from "commander";
import { installApiKeyRefusal } from "./commands/apiKeyFlag.js";

interface CommandEntry {
  /** The top-level command the module registers. */
  readonly name: string;
  /** Loads the module and registers its command on `program`. */
  readonly register: (program: Command, version: string) => Promise<void>;
}

/**
 * Every command, in the order `barwise --help` lists them.
 *
 * Dynamic imports, never static ones: a static import here makes every
 * invocation load that command's dependencies, which is how `barwise
 * validate` came to load all eighteen (barwise-8nx).
 * `tests/commandRouting.test.ts` fails on a static import and on an entry
 * whose name is not the command its module registers.
 */
const COMMANDS: readonly CommandEntry[] = [
  {
    name: "analyze",
    register: async (p) => (await import("./commands/analyze.js")).registerAnalyzeCommand(p),
  },
  {
    name: "project",
    register: async (p) => (await import("./commands/project.js")).registerProjectCommand(p),
  },
  {
    name: "validate",
    register: async (p) => (await import("./commands/validate.js")).registerValidateCommand(p),
  },
  {
    name: "verbalize",
    register: async (p) => (await import("./commands/verbalize.js")).registerVerbalizeCommand(p),
  },
  {
    name: "describe",
    register: async (p) => (await import("./commands/describe.js")).registerDescribeCommand(p),
  },
  {
    name: "query",
    register: async (p) => (await import("./commands/query.js")).registerQueryCommand(p),
  },
  {
    name: "schema",
    register: async (p) => (await import("./commands/schema.js")).registerSchemaCommand(p),
  },
  {
    name: "export",
    register: async (p) => (await import("./commands/export.js")).registerExportCommand(p),
  },
  {
    name: "diagram",
    register: async (p) => (await import("./commands/diagram.js")).registerDiagramCommand(p),
  },
  {
    name: "diff",
    register: async (p) => (await import("./commands/diff.js")).registerDiffCommand(p),
  },
  {
    name: "migrate",
    register: async (p) => (await import("./commands/migrate.js")).registerMigrateCommand(p),
  },
  {
    name: "merge",
    register: async (p) => (await import("./commands/merge.js")).registerMergeCommand(p),
  },
  {
    name: "review",
    register: async (p) => (await import("./commands/review.js")).registerReviewCommand(p),
  },
  { name: "gym", register: async (p) => (await import("./commands/gym.js")).registerGymCommand(p) },
  {
    name: "history",
    register: async (p) => (await import("./commands/history.js")).registerHistoryCommand(p),
  },
  {
    name: "import",
    register: async (p) => (await import("./commands/import.js")).registerImportCommand(p),
  },
  {
    name: "lineage",
    register: async (p) => (await import("./commands/lineage.js")).registerLineageCommand(p),
  },
  // Takes the version because a recorded eval row states what built it,
  // and this is the only place the version is known without reaching
  // for `import.meta`.
  {
    name: "prompt",
    register: async (p, version) =>
      (await import("./commands/prompt.js")).registerPromptCommand(p, version),
  },
  {
    name: "llm-usage",
    register: async (p) => (await import("./commands/llmUsage.js")).registerLlmUsageCommand(p),
  },
];

/** The command names, in registration order. */
export const COMMAND_NAMES: readonly string[] = COMMANDS.map((c) => c.name);

/**
 * The command the arguments run, when that is certain.
 *
 * The first argument, if it names a command. Anything else -- no arguments,
 * `--help`, `--version`, `help <command>`, an unknown name, an option
 * before the name -- returns undefined, and the caller registers every
 * command, which is the path help, suggestions and errors have always
 * taken. An option before the name is not skipped: `-h validate` prints
 * the root help, and with only `validate` registered that help would list
 * one command.
 */
export function commandNameIn(args: readonly string[]): string | undefined {
  const first = args[0];
  return first !== undefined && COMMAND_NAMES.includes(first) ? first : undefined;
}

// Version is supplied by the caller so this shared module stays free of
// `import.meta` (which the CJS bundle cannot use): the tsc bin entry
// reads it from package.json, the bundle entry takes the injected value.
export async function createProgram(version = "0.0.0-dev", only?: string): Promise<Command> {
  const program = new Command();

  // Before any command body can see it. `--api-key` is declared on five
  // commands so the failure can name its replacement, and refused here so no
  // command -- including ones not yet written -- ever reads a credential out
  // of argv (docs/specs/keyless-model-access.spec.md). A root hook, so it
  // covers a command registered alone exactly as one registered with all.
  installApiKeyRefusal(program);
  program
    .name("barwise")
    .description("ORM 2 modeling tool for data engineers and architects")
    .version(version);

  const chosen = COMMANDS.filter((c) => c.name === only);
  for (const command of chosen.length > 0 ? chosen : COMMANDS) {
    await command.register(program, version);
  }

  return program;
}
