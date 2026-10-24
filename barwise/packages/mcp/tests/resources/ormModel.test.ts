/**
 * The orm-model://{+path} resource (barwise-8n5): the path in the URI is the
 * file read, the model comes back as the document a save would write, and a
 * missing file is an error rather than an empty model.
 *
 * The path is taken from the URI the way the SDK takes it -- its own
 * `UriTemplate` matching the URI's string form -- so a path the URI encodes
 * (a space, a non-ASCII letter) is tested as a client would send it.
 */
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
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

/** Read a file path through the resource, as a client's URI reaches it. */
function readPath(read: Read, path: string) {
  const uri = new URL(`orm-model://${path}`);
  const variables = new UriTemplate("orm-model://{+path}").match(uri.toString());
  if (!variables) throw new Error(`the template does not match ${uri}`);
  return read(uri, variables);
}

describe("orm-model resource", () => {
  const read = capture();
  const dir = mkdtempSync(join(tmpdir(), "orm model é-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the file the URI names and returns every element", async () => {
    const { contents } = await readPath(read, `${fixtures}/simple.orm.yaml`);
    expect(contents).toHaveLength(1);
    expect(contents[0]!.mimeType).toBe("application/json");
    // The document a save writes, so every element is there: the model's
    // own fields are Maps, which JSON.stringify writes as {}.
    const doc = JSON.parse(contents[0]!.text);
    expect(doc.model.name).toBe("Simple Test");
    expect(doc.model.object_types).toHaveLength(2);
    expect(doc.model.fact_types).toHaveLength(1);
  });

  it("reads a path the URI percent-encodes (a space, an accented letter)", async () => {
    const path = join(dir, "shop model.orm.yaml");
    copyFileSync(`${fixtures}/simple.orm.yaml`, path);
    const { contents } = await readPath(read, path);
    expect(JSON.parse(contents[0]!.text).model.name).toBe("Simple Test");
  });

  it("rejects a path that names no file, naming the file", async () => {
    const missing = `${fixtures}/no-such-model.orm.yaml`;
    await expect(readPath(read, missing)).rejects.toMatchObject({
      code: "ENOENT",
      message: expect.stringContaining("no-such-model.orm.yaml"),
    });
  });
});
