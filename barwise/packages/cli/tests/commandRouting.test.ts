/**
 * The CLI loads only the command it runs
 * (docs/specs/cli-lazy-command-loading.spec.md).
 *
 * Three things keep that true, and each has a test here: the router names a
 * command only when it is certain, every table entry registers the command
 * it claims, and `src/cli.ts` reaches command modules through dynamic
 * imports alone. The last is a source check rather than a timing, because a
 * static import is the whole regression and a timing would only notice it
 * when it was large.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_NAMES, commandNameIn, createProgram } from "../src/cli.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

describe("commandNameIn", () => {
  it.each([
    [["validate", "model.orm.yaml"], "validate"],
    [["import", "transcript", "notes.md"], "import"],
    [["llm-usage", "--format", "json"], "llm-usage"],
  ])("names the command in %j", (args, expected) => {
    expect(commandNameIn(args)).toBe(expected);
  });

  it.each([
    [[]],
    [["--help"]],
    [["--version"]],
    [["help", "validate"]],
    [["valdate", "model.orm.yaml"]],
    [["--", "validate"]],
    // The root help, which must list every command, not the one after it.
    [["-h", "validate"]],
  ])("names none for %j, so every command is registered", (args) => {
    expect(commandNameIn(args)).toBeUndefined();
  });
});

describe("createProgram", () => {
  it("registers every command, in the order --help lists them, when none is named", async () => {
    const program = await createProgram("0.0.0-test");
    expect(program.commands.map((c) => c.name())).toEqual(COMMAND_NAMES);
    expect(COMMAND_NAMES).toHaveLength(20);
  });

  it("registers every command for a name it does not know", async () => {
    const program = await createProgram("0.0.0-test", "nonesuch");
    expect(program.commands.map((c) => c.name())).toEqual(COMMAND_NAMES);
  });

  // The drift test for the table: an entry whose name is not the command
  // its module registers would route that command to the wrong module.
  it.each(COMMAND_NAMES)("registers only `%s` when it is named", async (name) => {
    const program = await createProgram("0.0.0-test", name);
    expect(program.commands.map((c) => c.name())).toEqual([name]);
  });
});

describe("src/cli.ts", () => {
  const source = readFileSync(`${SRC}cli.ts`, "utf8");

  it("imports no command module statically", () => {
    const staticCommandImports = source
      .split("\n")
      .filter((line) => /^import\s(?!type\s).*from\s+"\.\/commands\//.test(line))
      .filter((line) => !line.includes("./commands/apiKeyFlag.js"));
    expect(staticCommandImports).toEqual([]);
  });

  it("loads every module that registers a top-level command", () => {
    const registering = readdirSync(`${SRC}commands`)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /export function register\w+Command\(/.test(readFileSync(`${SRC}commands/${f}`, "utf8"))
      )
      .map((f) => f.replace(/\.ts$/, ".js"));
    const missing = registering.filter((f) => !source.includes(`import("./commands/${f}")`));
    expect(registering).toHaveLength(20);
    expect(missing).toEqual([]);
  });
});
