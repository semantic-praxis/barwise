/**
 * Tests for the id-minting seam and the pure UUIDv7 kernel
 * (uuid7-identifiers spec WS1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { generateId, setIdGenerator, uuidv7FromParts } from "../../src/model/id.js";
import { OrmModel } from "../../src/model/OrmModel.js";

const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  setIdGenerator(undefined);
});

describe("uuidv7FromParts", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const zeros = bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  it("is deterministic and carries version 7 and the RFC variant", () => {
    const id = uuidv7FromParts(0x017f22e279b0, zeros);
    expect(id).toBe(uuidv7FromParts(0x017f22e279b0, zeros));
    expect(id[14]).toBe("7"); // version nibble
    expect("89ab").toContain(id[19]!); // variant bits 10xx
  });

  it("embeds the timestamp in the leading 48 bits", () => {
    const ms = 1_700_000_000_123;
    const id = uuidv7FromParts(ms, zeros);
    const embedded = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(embedded).toBe(ms);
  });

  it("orders lexicographically by timestamp, then by rand_a counter", () => {
    const older = uuidv7FromParts(1000, bytes(0x0f, 0xff, 0, 0, 0, 0, 0, 0, 0, 0));
    const newer = uuidv7FromParts(1001, zeros);
    expect(older < newer).toBe(true);

    const first = uuidv7FromParts(1000, bytes(0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0));
    const second = uuidv7FromParts(1000, bytes(0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(first < second).toBe(true);
  });

  it("rejects out-of-range timestamps and short random input", () => {
    expect(() => uuidv7FromParts(-1, zeros)).toThrow();
    expect(() => uuidv7FromParts(2 ** 48, zeros)).toThrow();
    expect(() => uuidv7FromParts(1.5, zeros)).toThrow();
    expect(() => uuidv7FromParts(1000, bytes(0, 0, 0))).toThrow();
  });
});

describe("generateId seam", () => {
  it("defaults to v4 random uuids", () => {
    expect(generateId()).toMatch(V4_SHAPE);
  });

  it("routes minting through an installed generator, and restores", () => {
    let n = 0;
    setIdGenerator(() => `id-${++n}`);
    expect(generateId()).toBe("id-1");

    const model = new OrmModel({ name: "Seam" });
    const ot = model.addObjectType({ name: "Thing", kind: "entity", referenceMode: "id" });
    expect(ot.id).toBe("id-2");

    setIdGenerator(undefined);
    expect(generateId()).toMatch(V4_SHAPE);
  });

  it("never overrides an explicitly supplied id", () => {
    setIdGenerator(() => "should-not-appear");
    const model = new OrmModel({ name: "Seam" });
    const ot = model.addObjectType({
      name: "Thing",
      kind: "entity",
      referenceMode: "id",
      id: "explicit-id",
    });
    expect(ot.id).toBe("explicit-id");
  });
});
