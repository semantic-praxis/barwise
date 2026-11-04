/**
 * The getting-started guides cite `barwise` commands; this keeps them real.
 *
 * Every `barwise ...` invocation in the guides -- a line in a shell code
 * block, or an inline code span in prose and in the hub's workflow table --
 * is resolved against the live Commander program: each subcommand must
 * exist, and each `--flag` must be one the resolved command declares. A
 * renamed command or a dropped flag fails here, naming the file and line,
 * instead of in front of a new user (barwise-jk7,
 * docs/specs/getting-started-guides.spec.md).
 *
 * The reference pages are scanned too. Before this test they had drifted in
 * exactly this way elsewhere -- MCP.md's setup ran a package that was never
 * published, and the extension README listed palette titles that no longer
 * existed -- with nothing to notice.
 *
 * It checks names, not behaviour: positional arguments and option values are
 * skipped, and `<placeholder>` tokens are accepted wherever they appear.
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const DOCS = [
  "GETTING_STARTED.md",
  "README.md",
  "barwise/docs/getting-started/cli.md",
  "barwise/docs/getting-started/vscode.md",
  "barwise/docs/getting-started/mcp.md",
  "barwise/docs/CLI.md",
  "barwise/docs/MCP.md",
  "barwise/docs/ORM_PROJECT_GUIDE.md",
  "barwise/examples/README.md",
];

interface Invocation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Shell-ish word split: quotes group, a bare redirect or pipe ends the command. */
function words(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"[^"]*"|'[^']*'|\S+/g)) {
    const w = m[0];
    if (/^(?:\d?>>?|\||&&|;|<)$/.test(w) || /^\d?>/.test(w)) break;
    out.push(w);
  }
  return out;
}

/** Every `barwise ...` a reader could copy out of one markdown file. */
function invocations(file: string): Invocation[] {
  const lines = readFileSync(`${REPO_ROOT}${file}`, "utf8").split("\n");
  const found: Invocation[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const opener = /^\s*```(\S*)/.exec(raw);
    if (opener) {
      fence = fence === undefined ? opener[1] : undefined;
      continue;
    }
    if (fence !== undefined) {
      if (!/^(?:sh|bash|shell|console)$/.test(fence)) continue;
      const cmd = raw.replace(/^\s*\$\s+/, "").trimStart();
      if (!cmd.startsWith("barwise ")) continue;
      let text = cmd;
      while (text.endsWith("\\") && i + 1 < lines.length) {
        text = `${text.slice(0, -1)} ${lines[++i]!.trim()}`;
      }
      found.push({ file, line: i + 1, text });
      continue;
    }
    for (const m of raw.matchAll(/`(barwise(?: [^`]*)?)`/g)) {
      found.push({ file, line: i + 1, text: m[1]! });
    }
  }
  return found;
}

/** Why this invocation does not resolve, or undefined when it does. */
function unresolved(program: Command, text: string): string | undefined {
  const [, ...args] = words(text);
  let cmd = program;
  let positional = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!;
    if (/^<.*>$/.test(arg) || /^\[.*\]$/.test(arg)) {
      positional = true;
      continue;
    }
    if (arg.startsWith("-")) {
      const flag = arg.split("=")[0]!;
      if (flag === "--help" || flag === "-h") continue;
      if (cmd === program && (flag === "--version" || flag === "-V")) continue;
      const opt = cmd.options.find((o) => o.long === flag || o.short === flag);
      if (!opt) return `\`${cmd.name()}\` has no option ${flag}`;
      if ((opt.required || opt.optional) && !arg.includes("=")) k++;
      continue;
    }
    const sub = positional
      ? undefined
      : cmd.commands.find((c) => c.name() === arg || c.aliases().includes(arg));
    if (sub) {
      cmd = sub;
    } else if (cmd.commands.length > 0 && cmd.registeredArguments.length === 0) {
      return `\`${cmd.name()}\` has no subcommand ${arg}`;
    } else {
      positional = true;
    }
  }
  return undefined;
}

// Every command, as `barwise --help` would see them.
const program = await createProgram();

describe("barwise invocations in the getting-started docs", () => {
  const all = DOCS.flatMap(invocations);

  it("finds invocations in every scanned file", () => {
    // A scan that matches nothing would pass the check below vacuously.
    const empty = DOCS.filter((f) => !all.some((inv) => inv.file === f));
    expect(empty).toEqual([]);
    expect(all.length).toBeGreaterThan(100);
  });

  it("names only commands and options the CLI has", () => {
    const failures = all.flatMap((inv) => {
      const why = unresolved(program, inv.text);
      return why ? [`${inv.file}:${inv.line}: ${inv.text} -- ${why}`] : [];
    });
    expect(failures).toEqual([]);
  });

  it("rejects what it should", () => {
    // The resolver itself, against the mistakes it exists to catch.
    expect(unresolved(program, "barwise validate m.orm.yaml --no-warnings")).toBeUndefined();
    expect(unresolved(program, "barwise import model s.sql --format ddl")).toBeUndefined();
    expect(unresolved(program, "barwise validat m.orm.yaml")).toMatch(/no subcommand validat/);
    expect(unresolved(program, "barwise import modle s.sql")).toMatch(/no subcommand modle/);
    expect(unresolved(program, "barwise export m.orm.yaml --fromat ddl")).toMatch(
      /no option --fromat/,
    );
  });
});
