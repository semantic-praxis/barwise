/**
 * Load-forward across the CLI (docs/adr/schema-versioning.md, decision 4;
 * docs/specs/adr-batch9-enforcers.spec.md, WS6).
 *
 * Decision 4 says an older file loads at the current version and a surface
 * writes it back only when it writes an edit. The 1.0 forward load and
 * `migrate` had tagged tests; nothing held the other commands to it, so a
 * command that began saving the model back after reading it (a "fix up"
 * pass, a cache) would have rewritten users' files with no test failing.
 *
 * The command list is read from the commander tree `createProgram`
 * builds, not copied here. Every leaf command must have a row in
 * `ROWS`, either a run on a copied 3.0 fixture or a skip with its reason,
 * so a command added later fails `the table covers exactly the registered
 * commands` until someone declares what it does to a 3.0 file.
 *
 * A run on the fixture must exit 0 and print something, then leave the
 * file's bytes alone. The success check comes first and is the point of
 * the self-checks below: a command that refused the file would leave it
 * untouched too, and pass a bytes-only test.
 *
 * Reads only `src/` of this package, so turbo's cache for this test is
 * invalidated by any package it can import.
 *
 * Not covered: VS Code's open/save path (barwise-ym8.yfi stays open for
 * it), and the 1.0 and 2.0 inputs, which `merge.test.ts`,
 * `migrate.test.ts` and core's tests hold.
 */
import { CURRENT_ORM_VERSION } from "@barwise/core";
import type { Command } from "commander";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { runCli, type RunResult } from "./workspace/run.js";

const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/pets-3x.orm.yaml",
);

/** A second, non-conflicting 3.0 model, for the commands that take two. */
const SECOND_MODEL = `orm_version: "3.0"
model:
  name: Pets
  object_types:
    - { id: ot2, name: Fish, kind: entity, reference_mode: id }
`;

interface Files {
  /** The copied 3.0 fixture the command is run on. */
  readonly file: string;
  /** A second 3.0 model in the same directory. */
  readonly other: string;
}

type Row =
  | {
    readonly args: (f: Files) => string[];
    /** Present only for a declared editing command: why it rewrites its input. */
    readonly edits?: string;
    /**
     * Bring the fixture to the current version (with `migrate`) before the
     * run. `rename` refuses a 3.0 file and names `migrate`, so its edit can
     * only be seen on a current one; its refusal is tested separately.
     */
    readonly current?: boolean;
  }
  | { readonly skip: string; };

/**
 * What each leaf command does to a 3.0 file. `edits` is the declared
 * editing set: these rewrite the file they are given, by design, and the
 * test requires that they still do. Everything else must not.
 */
const ROWS: Record<string, Row> = {
  "validate": { args: (f) => ["validate", f.file] },
  "verbalize": { args: (f) => ["verbalize", f.file] },
  "describe": { args: (f) => ["describe", f.file] },
  "query": { args: (f) => ["query", f.file, "stats"] },
  "schema": { args: (f) => ["schema", f.file] },
  "export": { args: (f) => ["export", f.file, "--format", "ddl"] },
  "diagram": { args: (f) => ["diagram", f.file] },
  "diff": { args: (f) => ["diff", f.file, f.other] },
  "merge": { args: (f) => ["merge", f.file, f.other] },
  "history": { args: (f) => ["history", f.file] },
  "lineage status": { args: (f) => ["lineage", "status", f.file] },
  "lineage impact": { args: (f) => ["lineage", "impact", f.file, "--element", "ot0"] },
  "lineage show": { args: (f) => ["lineage", "show", f.file] },
  // Scaffolding a split config reads the model and prints; the splitting
  // run needs a config naming domains and writes a new directory, not
  // this file.
  "project split": {
    args: (f) => ["project", "split", f.file, "--scaffold-config", "--domains", "a,b"],
  },
  "migrate": {
    args: (f) => ["migrate", f.file],
    edits: "its purpose: rewrites the file at the current version",
  },
  "rename": {
    args: (f) => ["rename", f.file, "--object-type", "Dog", "--to", "Hound"],
    edits: "its purpose: writes the renamed model back to the file",
    current: true,
  },

  "analyze": { skip: "takes a source repository (path or GitHub slug), not a model file" },
  "project init": { skip: "takes a project name and scaffolds new files; no model is read" },
  "review": { skip: "calls an LLM provider and needs a model API key" },
  "gym list": { skip: "reads the packaged exercise catalog; no model file" },
  "gym show": { skip: "reads the packaged exercise catalog; no model file" },
  "gym check": {
    skip: "its exit code is the verdict on the candidate, and the only passing answer to an "
      + "exercise is a 4.0 reference file, so a 3.0 fixture would exit 1 for the right reason",
  },
  "import model": { skip: "reads a foreign format (DDL, OpenAPI, Avro, Ossie), not an .orm.yaml" },
  "import norma": { skip: "reads a NORMA .orm XML file, not an .orm.yaml" },
  "import dbt": { skip: "reads a dbt project directory, not an .orm.yaml" },
  "import sql": { skip: "reads SQL, not an .orm.yaml" },
  "import typescript": { skip: "reads a source directory and may start a language server" },
  "import java": { skip: "reads a source directory and may start a language server" },
  "import kotlin": { skip: "reads a source directory and may start a language server" },
  "import transcript": { skip: "calls an LLM provider and needs a model API key" },
  "import batch": { skip: "calls LLM providers across a directory of transcripts; needs a key" },
  "prompt eval": { skip: "calls an LLM provider and needs a model API key" },
  "prompt score": {
    skip: "scores a saved extraction against the prompt eval suite; no model file",
  },
  "prompt schema": { skip: "prints a prompt surface's output schema; no model file" },
  "prompt artifact": { skip: "prints a prompt surface's artifact; no model file" },
  "prompt run": { skip: "calls an LLM provider and needs a model API key" },
  "prompt history": { skip: "reads the prompt score history; no model file" },
  "prompt rescore": { skip: "rescores saved payloads; no model file" },
  "prompt compare": { skip: "compares prompt score history entries; no model file" },
  "llm-usage": { skip: "reports over the LLM call log; no model file" },
};

/** Command paths of the commands that run something (no subcommands). */
function leafPaths(program: Command): string[] {
  const out: string[] = [];
  const walk = (cmd: Command, path: string[]): void => {
    for (const sub of cmd.commands) {
      const p = [...path, sub.name()];
      if (sub.commands.length === 0) out.push(p.join(" "));
      else walk(sub, p);
    }
  };
  walk(program, []);
  return out;
}

/**
 * What is wrong with one run of a command on the fixture, as sentences.
 * Success is judged before the bytes: a refusal also leaves them alone.
 */
export function problemsWith(
  run: RunResult,
  before: string,
  after: string,
  edits: boolean,
): string[] {
  const out: string[] = [];
  if (run.exitCode !== 0) {
    out.push(`exited ${run.exitCode}: ${(run.stderr || run.stdout).trim().slice(0, 160)}`);
  }
  if (run.stdout.trim() === "" && run.stderr.trim() === "") out.push("printed nothing");
  if (edits) {
    if (after === before) out.push("is declared as editing but left the file unchanged");
    else if (!after.startsWith(`orm_version: "${CURRENT_ORM_VERSION}"`)) {
      out.push(`wrote the file but not at version ${CURRENT_ORM_VERSION}`);
    }
  } else if (after !== before) out.push("rewrote the file but is not a declared editing command");
  return out;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fresh directory holding a copy of the fixture, committed to a git repo. */
function stage(): Files {
  const dir = mkdtempSync(join(tmpdir(), "barwise-load-forward-"));
  dirs.push(dir);
  const file = join(dir, "pets.orm.yaml");
  const other = join(dir, "second.orm.yaml");
  copyFileSync(fixture, file);
  writeFileSync(other, SECOND_MODEL);
  // `history` reads the file's git log; the commit gives it one.
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], {
      stdio: "ignore",
    });
  git("init");
  git("add", ".");
  git("commit", "-m", "fixture", "--no-gpg-sign");
  return { file, other };
}

const leaves = leafPaths(await createProgram());

describe("load-forward across the CLI", () => {
  it("the fixture is a 3.0 file, older than the current version [adr:schema-versioning#load-forward]", () => {
    // Otherwise the rows below would test a current-version file, which
    // decision 4 says nothing about.
    expect(readFileSync(fixture, "utf8").startsWith('orm_version: "3.0"')).toBe(true);
    expect(CURRENT_ORM_VERSION).not.toBe("3.0");
  });

  it("the table covers exactly the registered commands [adr:schema-versioning#load-forward]", () => {
    expect(leaves.length).toBeGreaterThan(20);
    const declared = Object.keys(ROWS);
    expect(leaves.filter((p) => !declared.includes(p)), "commands with no row").toEqual([]);
    expect(declared.filter((p) => !leaves.includes(p)), "rows for no command").toEqual([]);
  });

  it(
    "every declared run succeeds on a 3.0 file and writes it only if declared as editing [adr:schema-versioning#load-forward]",
    async () => {
      const problems: string[] = [];
      let ran = 0;
      for (const path of leaves) {
        const row = ROWS[path];
        if (row === undefined || "skip" in row) continue;
        const files = stage();
        if (row.current) expect((await runCli(["migrate", files.file])).exitCode).toBe(0);
        const before = readFileSync(files.file, "utf8");
        const run = await runCli(row.args(files));
        ran++;
        const found = problemsWith(
          run,
          before,
          readFileSync(files.file, "utf8"),
          row.edits !== undefined,
        );
        problems.push(...found.map((p) => `${path} ${p}`));
      }
      expect(ran).toBeGreaterThan(10);
      expect(problems).toEqual([]);
    },
    180_000,
  );

  it("rename refuses a 3.0 file, names migrate, and leaves it unchanged [adr:schema-versioning#load-forward]", async () => {
    // Decision 4 lets a surface write an edit to an older file; the CLI's
    // rename does not, because the rewrite would drop comments and flags
    // unreported. This pins that choice: if rename starts loading forward
    // and writing, the row above and this test change together.
    const files = stage();
    const before = readFileSync(files.file, "utf8");
    const run = await runCli(["rename", files.file, "--object-type", "Dog", "--to", "Hound"]);
    expect(run.exitCode).toBe(2);
    expect(`${run.stdout}${run.stderr}`).toContain("barwise migrate");
    expect(readFileSync(files.file, "utf8")).toBe(before);
  });

  it("the checker refuses a command that exits non-zero without touching the file [adr:schema-versioning#load-forward]", () => {
    // The stub stands for a command that rejected the 3.0 file: bytes
    // intact, so only the success check can fail it.
    const refusing: RunResult = { stdout: "", stderr: "unsupported version", exitCode: 1 };
    expect(problemsWith(refusing, "same", "same", false)).not.toEqual([]);
  });

  it("the checker refuses a read-only command that rewrites the file, and an editing one that does not [adr:schema-versioning#load-forward]", () => {
    const ok: RunResult = { stdout: "done", stderr: "", exitCode: 0 };
    expect(problemsWith(ok, "a", "b", false)).toEqual([
      "rewrote the file but is not a declared editing command",
    ]);
    expect(problemsWith(ok, "a", "a", true)).toEqual([
      "is declared as editing but left the file unchanged",
    ]);
    expect(problemsWith(ok, "a", "a", false)).toEqual([]);
  });
});

describe("load-forward commands not run on a fixture", () => {
  // Listed as skipped, with the reason in the name, so a report shows
  // what was not exercised instead of passing it.
  for (const [path, row] of Object.entries(ROWS)) {
    if ("skip" in row) it.skip(`${path}: ${row.skip}`, () => {});
  }
});
