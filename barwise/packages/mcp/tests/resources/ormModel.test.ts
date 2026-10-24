/**
 * The orm-model://{+path} resource (barwise-8n5): the path in the URI is the
 * file read, the model comes back deserialized as JSON, and a missing file
 * is an error rather than an empty model.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerOrmModelResource } from "../../src/resources/ormModel.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

type Read = (
  uri: URL,
  variables: Record<string, string | string[]>,
) => Promise<{ contents: { uri: string; mimeType: string; text: string; }[]; }>;

function capture(): Read {
  let read: Read | undefined;
  registerOrmModelResource({
    registerResource: (_name: string, _template: unknown, _meta: unknown, handler: Read) => {
      read = handler;
    },
  } as never);
  return read!;
}

describe("orm-model resource", () => {
  const read = capture();
  const path = `${fixtures}/simple.orm.yaml`;

  it("reads the file the URI names and returns the deserialized model", async () => {
    const uri = new URL(`orm-model://${path}`);
    const { contents } = await read(uri, { path });
    expect(contents).toHaveLength(1);
    expect(contents[0]!.uri).toBe(uri.href);
    expect(contents[0]!.mimeType).toBe("application/json");
    // The document a save writes, so every element is there: the model's
    // own fields are Maps, which JSON.stringify writes as {}.
    const doc = JSON.parse(contents[0]!.text);
    expect(doc.model.name).toBe("Simple Test");
    expect(doc.model.object_types).toHaveLength(2);
    expect(doc.model.fact_types).toHaveLength(1);
  });

  it("rejects a path that names no file", async () => {
    const missing = `${fixtures}/no-such-model.orm.yaml`;
    await expect(read(new URL(`orm-model://${missing}`), { path: missing })).rejects.toThrow();
  });
});
