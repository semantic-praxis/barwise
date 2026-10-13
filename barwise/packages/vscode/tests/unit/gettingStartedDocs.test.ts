/**
 * The editor names the user docs cite, against what package.json declares.
 *
 * The docs tell a reader to run **Barwise: Validate Model**, type
 * `#barwiseExport` or `@barwise /import`, and set `barwise.llmProvider`.
 * Each of those is a copy of a `contributes` entry. Before this test the
 * copies had drifted with nothing to notice: the extension README listed
 * `ORM: New Project` and four more titles that no longer existed, and
 * examples/README.md walked a reader through an `ORM: Import Transcript`
 * command that had been folded into **Barwise: Import...** (barwise-jk7,
 * docs/specs/getting-started-guides.spec.md).
 *
 * Bold `Barwise: ...` / `ORM: ...` text is read as a palette title; the docs
 * write palette entries that way and nothing else.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const DOCS = [
  "GETTING_STARTED.md",
  "README.md",
  "barwise/docs/getting-started/cli.md",
  "barwise/docs/getting-started/vscode.md",
  "barwise/docs/getting-started/mcp.md",
  "barwise/docs/MCP.md",
  "barwise/examples/README.md",
  "barwise/packages/vscode/README.md",
];

interface Contributes {
  commands: { command: string; title: string; category?: string; }[];
  configuration: { properties: Record<string, unknown>; } | {
    properties: Record<string, unknown>;
  }[];
  languageModelTools: { toolReferenceName?: string; }[];
  chatParticipants: { commands?: { name: string; }[]; }[];
}

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { contributes: Contributes; };
const c = pkg.contributes;

const titles = new Set(c.commands.map((k) => (k.category ? `${k.category}: ${k.title}` : k.title)));
const commandIds = new Set(c.commands.map((k) => k.command));
const settings = new Set(
  [c.configuration].flat().flatMap((block) => Object.keys(block.properties)),
);
const toolRefs = new Set(c.languageModelTools.map((t) => t.toolReferenceName));
const chatCommands = new Set(
  c.chatParticipants.flatMap((p) => p.commands ?? []).map((k) => k.name),
);

interface Cite {
  readonly where: string;
  readonly name: string;
}

function cites(pattern: RegExp): Cite[] {
  return DOCS.flatMap((file) =>
    readFileSync(`${REPO_ROOT}${file}`, "utf8")
      .split("\n")
      .flatMap((line, i) =>
        [...line.matchAll(pattern)].map((m) => ({ where: `${file}:${i + 1}`, name: m[1]! }))
      )
  );
}

function unknown(found: Cite[], known: Set<string | undefined>): string[] {
  return found.filter((f) => !known.has(f.name)).map((f) => `${f.where}: ${f.name}`);
}

describe("VS Code names in the user docs", () => {
  it("palette titles exist", () => {
    const found = cites(/\*\*((?:Barwise|ORM): [^*]+)\*\*/g);
    expect(found.length).toBeGreaterThan(20);
    expect(unknown(found, titles)).toEqual([]);
  });

  it("# tool references exist", () => {
    const found = cites(/`#(barwise[A-Za-z]+)`/g);
    expect(found.length).toBeGreaterThan(20);
    expect(unknown(found, toolRefs)).toEqual([]);
  });

  it("@barwise slash commands exist", () => {
    const found = cites(/`@barwise \/([a-z-]+)`/g);
    expect(found.length).toBeGreaterThan(0);
    expect(unknown(found, chatCommands)).toEqual([]);
  });

  it("barwise.* settings and command ids exist", () => {
    const found = cites(/`(barwise\.[A-Za-z]+)`/g);
    expect(found.length).toBeGreaterThan(10);
    expect(unknown(found, new Set([...settings, ...commandIds]))).toEqual([]);
  });
});
