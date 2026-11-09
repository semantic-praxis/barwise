/**
 * Each command, started the way a user starts it, holds the formats it can
 * be asked for (docs/specs/boot-path-registration.spec.md).
 *
 * `connector-packages#explicit-registration` says a surface calls the
 * `register*Formats()` it needs. The CLI is lazy, so there is no single
 * "CLI registry": every command registers, at module load, what it reads.
 * What is held here is the outcome -- the registry after
 * `createProgram(version, <command>)` -- never the calls, since a call in
 * dead code or for the wrong connector would pass a check of calls.
 *
 * Three things differ from the rest of this package's tests, each on purpose:
 *
 * - Every command boots in a child process over the built `dist`. Module
 *   caching makes registration once-per-process, so a second boot in this
 *   process sees whatever an earlier test loaded. (cli/CLAUDE.md says to
 *   drive commands through `runCli`; that is for behaviour, and this is
 *   about what a fresh process holds.) `runCli` with `vi.resetModules()`
 *   might work, but whether vitest resets the workspace packages' `dist`
 *   (it may externalize them) is not established, and a child over built
 *   `dist` tests what ships. The only `src` import is `COMMAND_NAMES`
 *   from cli.ts, which loads no command, so coverage is unaffected.
 *   The children read `dist`: a bare `npx vitest run` after a source edit
 *   tests a stale build (turbo's `test` depends on `build`, so CI is fresh).
 * - What a command requires is derived from the command, never listed here.
 *   The four rules are in `needOf`; the spec explains why no command's
 *   `--format` option can be read back as a list.
 * - The registry readers are found by reading core's registry module, so a
 *   reader core adds later is a reader here until someone says otherwise.
 *
 * Not seen: a reader imported under an alias or through a namespace import,
 * a reader reached through a helper outside `cli/src` (in core, say), and
 * readers `registry.ts` re-exports with `export *` (named re-exports are seen).
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { COMMAND_NAMES } from "../src/cli.js";

const run = promisify(execFile);
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(PKG, "src");
const CORE_REGISTRY = resolve(PKG, "../core/src/format/registry.ts");
const WRITERS = new Set(["registerFormat", "clearFormats"]);
const CONNECTORS = ["@barwise/formats", "@barwise/dbt", "@barwise/code-analysis"];
const TAG = "[adr:connector-packages#explicit-registration]";

type Kind = "importer" | "exporter";
interface Described {
  name: string;
  importer: boolean;
  exporter: boolean;
}
interface OptionInfo {
  long?: string;
  mandatory: boolean;
  hasChoices: boolean;
}
interface CommandNode {
  name: string;
  options: OptionInfo[];
  subcommands: CommandNode[];
}
interface Boot {
  booted: Described[];
  tree: CommandNode[];
}
interface Reference {
  all: Described[];
  /** What each connector's `register*Formats` adds to an empty registry. */
  added: Record<string, Described[]>;
}

// Plain JavaScript run under `node` over dist: there is no TypeScript loader
// in the child, so what runs is what ships.
const BOOT_PROBE = `
const [{ createProgram }, core] = await Promise.all([
  import(${JSON.stringify(new URL(`file://${PKG}/dist/cli.js`).href)}),
  import("@barwise/core"),
]);
const program = await createProgram("0.0.0", process.argv[1]);
const node = (c) => ({
  name: c.name(),
  options: c.options.map((o) => ({ long: o.long, mandatory: o.mandatory, hasChoices: !!o.argChoices })),
  subcommands: c.commands.map(node),
});
const describe = (d) => ({ name: d.name, importer: !!d.importer, exporter: !!d.exporter });
console.log(JSON.stringify({ booted: core.listFormats().map(describe), tree: program.commands.map(node) }));
`;

// The reference set: what the test's own process gets by calling the three
// connectors' register functions, with the registry diff around each call
// (the connector-typed-argument rule needs it).
const REFERENCE_PROBE = `
const core = await import("@barwise/core");
const describe = (d) => ({ name: d.name, importer: !!d.importer, exporter: !!d.exporter });
const added = {};
for (const pkg of ${JSON.stringify(CONNECTORS)}) {
  const mod = await import(pkg);
  const before = new Set(core.listFormats().map((d) => d.name));
  for (const fn of Object.keys(mod).filter((k) => /^register\\w*Formats$/.test(k))) mod[fn]();
  added[pkg] = core.listFormats().filter((d) => !before.has(d.name)).map(describe);
}
console.log(JSON.stringify({ all: core.listFormats().map(describe), added }));
`;

async function probe<T>(script: string, arg = ""): Promise<T> {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script, arg], {
    cwd: PKG,
    timeout: 60_000,
  });
  return JSON.parse(stdout) as T;
}

const boots = new Map<string, Promise<Boot>>();
function bootOf(command: string): Promise<Boot> {
  if (!boots.has(command)) boots.set(command, probe<Boot>(BOOT_PROBE, command));
  return boots.get(command)!;
}

const has = (set: readonly Described[], kind: Kind, name: string): boolean =>
  set.some((d) => d.name === name && d[kind]);

// -- Reader detection ---------------------------------------------------------

/**
 * Every function or const core's registry module exports, less its writers:
 * declarations and export specifiers (re-exports), as TypeScript sees them.
 */
function readerNames(): Set<string> {
  const sf = ts.createSourceFile(
    CORE_REGISTRY,
    readFileSync(CORE_REGISTRY, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  const exported = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n)
    && (ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && exported(st) && st.name) names.push(st.name.text);
    else if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
      }
    } else if (
      ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause
      && ts.isNamedExports(st.exportClause)
    ) {
      for (const e of st.exportClause.elements) if (!e.isTypeOnly) names.push(e.name.text);
    }
  }
  return new Set(names.filter((n) => !WRITERS.has(n)));
}

/**
 * The kinds a reader can be asked for, read off its name. A name that says
 * neither (`getFormat`, `listFormats`, `formatRegistry`) is both, which is
 * the safe side: it requires more.
 */
function kindsOf(reader: string): Kind[] {
  if (/Importer/.test(reader)) return ["importer"];
  if (/Exporter|surrogate/i.test(reader)) return ["exporter"];
  return ["importer", "exporter"];
}

interface Read {
  /** Path under `src`, and the 1-based line. */
  at: string;
  reader: string;
  /** The string literal the reader is called with, when it is. */
  literal?: string;
  /** Connector packages the file imports a runtime symbol other than `register*` from. */
  connectors: string[];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(resolve(dir, e.name))
      : e.name.endsWith(".ts")
      ? [resolve(dir, e.name)]
      : []
  );
}

function readsIn(file: string, readers: ReadonlySet<string>): Read[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const connectors: string[] = [];
  const reads: Read[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const pkg = (node.moduleSpecifier as ts.StringLiteral).text;
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const runtime = !clause?.isTypeOnly && named && ts.isNamedImports(named)
        && named.elements.some((e) => !e.isTypeOnly && !/^register\w*Formats$/.test(e.name.text));
      if (runtime && CONNECTORS.includes(pkg)) connectors.push(pkg);
      return;
    }
    if (
      ts.isIdentifier(node) && readers.has(node.text)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node
        ? node.parent
        : undefined;
      const arg = call?.arguments[0];
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      reads.push({
        at: `${relative(SRC, file)}:${line}`,
        reader: node.text,
        literal: arg && ts.isStringLiteralLike(arg) ? arg.text : undefined,
        connectors,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return reads;
}

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** `commands/<x>.ts` and `commands/<x>/*.ts` belong to command `<x>`. */
function ownerOf(file: string): string | undefined {
  const m = /^commands\/([^/]+?)(?:\.ts|\/[^/]+\.ts)$/.exec(relative(SRC, file));
  const name = m && kebab(m[1]!);
  return name && COMMAND_NAMES.includes(name) ? name : undefined;
}

const READERS = readerNames();
type OwnedRead = Read & { owner: string | undefined; };
const READS: OwnedRead[] = sourceFiles(SRC).flatMap((file) =>
  readsIn(file, READERS).map((read) => ({ ...read, owner: ownerOf(file) }))
);

// -- Derivation ---------------------------------------------------------------

function leaves(n: CommandNode): CommandNode[] {
  return n.subcommands.length === 0 ? [n] : n.subcommands.flatMap(leaves);
}
function options(n: CommandNode): OptionInfo[] {
  return [...n.options, ...n.subcommands.flatMap(options)];
}

interface Need {
  /** `<kind> <name>` to why the command needs it. */
  needs: Map<string, string>;
  /** Reads no rule resolves, and literals naming no registered format, as messages. */
  problems: string[];
}

/**
 * What `command` can be asked for, from the command itself:
 *  1. a leaf subcommand named for a reference importer needs it;
 *  2. a mandatory `--format` option with no choices, on a command that
 *     reads a registry getter, takes any name of that getter's kind;
 *  3. a getter called with a string literal needs that name;
 *  4. a getter none of those resolves, in a file importing a runtime symbol
 *     from a connector, needs what that connector's registration adds.
 */
function needOf(
  command: string,
  tree: CommandNode,
  ref: Reference,
  reads: readonly OwnedRead[] = READS,
): Need {
  const needs = new Map<string, string>();
  const problems: string[] = [];
  const add = (kind: Kind, name: string, why: string): void => {
    needs.set(`${kind} ${name}`, why);
  };
  const root = tree.find((n) => n.name === command)!;

  let leafNamed = false;
  for (const leaf of leaves(root)) {
    if (has(ref.all, "importer", leaf.name)) {
      add("importer", leaf.name, "subcommand name");
      leafNamed = true;
    }
  }
  const openFormat = options(root).some((o) =>
    o.long === "--format" && o.mandatory && !o.hasChoices
  );

  for (const read of reads.filter((r) => r.owner === command)) {
    const kinds = kindsOf(read.reader);
    if (read.literal !== undefined) {
      const found = kinds.filter((kind) => has(ref.all, kind, read.literal!));
      for (const kind of found) {
        add(kind, read.literal, `${read.reader}("${read.literal}") at ${read.at}`);
      }
      if (found.length === 0) {
        problems.push(`${read.at} ${read.reader}("${read.literal}"): names no registered format`);
      }
    } else if (openFormat) {
      for (const kind of kinds) {
        for (const d of ref.all.filter((d) => d[kind])) {
          add(kind, d.name, `open --format, ${read.reader} at ${read.at}`);
        }
      }
    } else if (leafNamed && kinds.every((k) => k === "importer")) {
      // Resolved by the command's own subcommand names (rule 1): import/code.ts
      // loops over them. Never by needs other reads added.
    } else if (read.connectors.length > 0) {
      for (const pkg of read.connectors) {
        for (const kind of kinds) {
          for (const d of ref.added[pkg]!.filter((d) => d[kind])) {
            add(kind, d.name, `${pkg} argument, ${read.reader} at ${read.at}`);
          }
        }
      }
    } else {
      problems.push(`${read.at} ${read.reader}: no rule derives its need`);
    }
  }
  return { needs, problems };
}

// -- Tests --------------------------------------------------------------------

describe("what each CLI command holds once booted", () => {
  let ref: Reference;

  beforeAll(async () => {
    expect(existsSync(resolve(PKG, "dist/cli.js")), "built entry missing: dist/cli.js").toBe(true);
    ref = await probe<Reference>(REFERENCE_PROBE);
    // The reference is what every case compares against; an empty one would
    // pass them all.
    expect(ref.all.length).toBeGreaterThanOrEqual(10);
  }, 60_000);

  it.each(COMMAND_NAMES)(
    `%s holds every format it can be asked for ${TAG}`,
    async (command) => {
      const { booted, tree } = await bootOf(command);
      const { needs } = needOf(command, tree, ref);
      const missing = [...needs].filter(([key]) => {
        const [kind, name] = key.split(" ") as [Kind, string];
        return !has(booted, kind, name);
      }).map(([key, why]) => `${command}: ${key} not registered (${why})`);
      expect(missing).toEqual([]);
    },
    60_000,
  );

  it(
    `derives nothing for a command that reads no registry, and something for each that does ${TAG}`,
    async () => {
      // The zero case, and the guard on the instrument: a derivation that
      // always came back empty would make every case above pass.
      for (const command of COMMAND_NAMES) {
        const { tree } = await bootOf(command);
        const { needs } = needOf(command, tree, ref);
        const reads = READS.filter((r) => r.owner === command);
        expect(
          needs.size > 0,
          `${command}: ${reads.length} registry reads, ${needs.size} derived needs`,
        )
          .toBe(reads.length > 0);
      }
      expect(READS.filter((r) => r.owner === "validate")).toEqual([]);
    },
    120_000,
  );

  it(`resolves every registry read in cli/src to a command and a rule ${TAG}`, async () => {
    const orphans = READS.filter((r) => r.owner === undefined)
      .map((r) => `${r.at} ${r.reader}: not under a command in the lazy table`);
    const problems: string[] = [];
    for (const command of COMMAND_NAMES) {
      const { tree } = await bootOf(command);
      problems.push(...needOf(command, tree, ref).problems);
    }
    expect([...orphans, ...problems]).toEqual([]);
  }, 120_000);

  describe("the derivation itself", () => {
    const fakeRef: Reference = {
      all: [{ name: "ddl", importer: true, exporter: true }],
      added: {},
    };
    const tree: CommandNode[] = [{ name: "demo", options: [], subcommands: [] }];
    const read = (literal: string | undefined, at: string) => ({
      at,
      reader: "getExporter",
      literal,
      connectors: [] as string[],
      owner: "demo",
    });

    it(`a variable read is not resolved by an earlier literal read in the same command ${TAG}`, () => {
      const { problems } = needOf("demo", tree, fakeRef, [
        read("ddl", "commands/demo.ts:1"),
        read(undefined, "commands/demo.ts:2"),
      ]);
      expect(problems).toEqual(["commands/demo.ts:2 getExporter: no rule derives its need"]);
    });

    it(`a literal naming no registered format fails ${TAG}`, () => {
      const { problems } = needOf("demo", tree, fakeRef, [read("dll", "commands/demo.ts:1")]);
      expect(problems).toEqual([
        'commands/demo.ts:1 getExporter("dll"): names no registered format',
      ]);
    });
  });

  it(
    `the bin lists the full exporter set when asked for one that does not exist ${TAG}`,
    async () => {
      const result = await run(process.execPath, [
        resolve(PKG, "dist/index.js"),
        "export",
        "nonexistent.orm.yaml",
        "--format",
        "nonesuch",
      ]).then(
        (r) => r,
        (e: { stdout: string; stderr: string; }) => e,
      );
      const listed = /Available formats: (.+)/.exec(`${result.stdout}${result.stderr}`)?.[1];
      expect(listed?.split(", ").sort()).toEqual(
        ref.all.filter((d) => d.exporter).map((d) => d.name).sort(),
      );
    },
    60_000,
  );
});
