/**
 * The editor's language-model tools list their formats by hand in
 * package.json -- the manifest is JSON, so it cannot read the registry --
 * while the CLI and the MCP server list whatever is registered. That made
 * the enum a must-agree copy with nothing holding it: a format registered
 * in @barwise/formats was reachable from two surfaces and refused by the
 * third's input schema (found adding Apache Ossie,
 * docs/specs/ossie-ontology-format.spec.md). These hold each enum to the
 * registry the extension populates, so adding a format fails here until
 * the manifest names it.
 */
import { registerCodeFormats } from "@barwise/code-analysis";
import { listExporters, listImporters } from "@barwise/core";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

registerStandardFormats();
registerDbtFormats();
registerCodeFormats();

interface Tool {
  readonly name: string;
  readonly inputSchema?: { properties?: { format?: { enum?: readonly string[]; }; }; };
}

const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf-8"),
) as { contributes: { languageModelTools: readonly Tool[]; }; };

function formatEnum(tool: string): string[] {
  const found = manifest.contributes.languageModelTools.find((t) => t.name === tool);
  const values = found?.inputSchema?.properties?.format?.enum;
  if (!values) throw new Error(`${tool} declares no format enum`);
  return [...values].sort();
}

describe("language-model tool format enums", () => {
  it("barwise_import_model lists exactly the registered importers [adr:connector-packages#core-no-interop] [adr:connector-packages#explicit-registration]", () => {
    expect(formatEnum("barwise_import_model")).toEqual(listImporters().map((f) => f.name).sort());
  });

  it("barwise_export_model lists exactly the registered exporters [adr:connector-packages#core-no-interop] [adr:connector-packages#explicit-registration]", () => {
    expect(formatEnum("barwise_export_model")).toEqual(listExporters().map((f) => f.name).sort());
  });
});
