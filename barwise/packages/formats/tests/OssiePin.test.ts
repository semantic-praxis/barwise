/**
 * The vendored Ossie schema is the bytes of the commit it names
 * (`docs/adr/ossie-interchange.md#pinned-version`;
 * `docs/specs/adr-batch9-enforcers.spec.md`, WS3).
 *
 * `schemas/ossie/pin.json` records the commit and each file's git blob id.
 * The id is recomputed from the bytes on disk, so a hand edit to a schema
 * fails here even though nothing reads the file differently; and the
 * README, which a reader goes to for the source, must name the same commit.
 * That the recorded ids are upstream's at that commit is checked once, by
 * hand, in an apache/ossie clone (`git ls-tree <commit> ontology/ontology.json
 * core-spec/ossie-schema.json`): the network is not a test input.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../schemas/ossie");
const pin = JSON.parse(readFileSync(resolve(dir, "pin.json"), "utf8")) as {
  commit: string;
  files: Record<string, string>;
};

/** What `git hash-object` prints for these bytes. */
function blobId(bytes: Buffer): string {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

describe("the pinned Ossie schema files", () => {
  it("are byte for byte the blobs pin.json records [adr:ossie-interchange#pinned-version]", () => {
    const actual = Object.fromEntries(
      Object.keys(pin.files).map((name) => [name, blobId(readFileSync(resolve(dir, name)))]),
    );
    expect(actual).toEqual(pin.files);
  });

  it("are all recorded: no vendored file sits beside the record unpinned [adr:ossie-interchange#pinned-version]", () => {
    const vendored = readdirSync(dir).filter((f) => f !== "README.md" && f !== "pin.json").sort();
    expect(vendored).toEqual(Object.keys(pin.files).sort());
  });

  it("are named by the README at the commit pin.json records, and no other [adr:ossie-interchange#pinned-version]", () => {
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    const readme = readFileSync(resolve(dir, "README.md"), "utf8");
    const commits = [...readme.matchAll(/\b[0-9a-f]{40}\b/g)].map((m) => m[0]);
    expect(commits).toEqual([pin.commit]);
  });
});
