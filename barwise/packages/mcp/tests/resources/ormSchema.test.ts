/**
 * The orm-schema://json-schema resource (barwise-8n5): it serves core's
 * model schema, byte for byte as JSON, so a client validating against it
 * validates against what the loader enforces.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { registerOrmSchemaResource } from "../../src/resources/ormSchema.js";

type Read = (
  uri: URL,
) => Promise<{ contents: { uri: string; mimeType: string; text: string; }[]; }>;

function capture(): { uri: string; read: Read; } {
  let captured: { uri: string; read: Read; } | undefined;
  registerOrmSchemaResource({
    registerResource: (_name: string, uri: string, _meta: unknown, read: Read) => {
      captured = { uri, read };
    },
  } as never);
  return captured!;
}

describe("orm-schema resource", () => {
  it("serves core's orm-model schema at orm-schema://json-schema", async () => {
    const { uri, read } = capture();
    expect(uri).toBe("orm-schema://json-schema");
    const { contents } = await read(new URL(uri));
    expect(contents).toHaveLength(1);
    expect(contents[0]!.uri).toBe(uri);
    expect(contents[0]!.mimeType).toBe("application/json");
    const core = JSON.parse(
      readFileSync(new URL("../../../core/schemas/orm-model.schema.json", import.meta.url), "utf8"),
    );
    expect(JSON.parse(contents[0]!.text)).toEqual(core);
  });
});
