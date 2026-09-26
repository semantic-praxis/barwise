/**
 * Tests for the id-minting seam, the pure UUIDv7 kernel
 * (uuid7-identifiers spec WS1), and the generator factory over injected
 * sources (uuid7-generator-factory spec). The factory's ordering cases
 * run on a fake clock: the real one never reaches 4,097 ids in a
 * millisecond or steps backwards on demand, which is why the surface
 * tests that preceded this could not cover them.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createUuidv7Generator,
  generateId,
  setIdGenerator,
  uuidv7FromParts,
  type Uuidv7Sources,
} from "../../src/model/id.js";
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

describe("createUuidv7Generator", () => {
  const V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  /** Leading 48 bits, as the Unix millisecond timestamp they encode. */
  const encodedMs = (id: string) => parseInt(id.slice(0, 8) + id.slice(9, 13), 16);

  /**
   * A clock the test moves by hand, and a byte source that records every
   * request and answers with a fresh, distinct buffer each time.
   */
  function fakeSources(startMs: number) {
    const clock = { ms: startMs, reads: 0 };
    const byteRequests: number[] = [];
    let fill = 0;
    const sources: Uuidv7Sources = {
      now: () => {
        clock.reads++;
        return clock.ms;
      },
      randomBytes: (n) => {
        byteRequests.push(n);
        fill = (fill + 1) & 0xff;
        return new Uint8Array(n).fill(fill);
      },
    };
    return { clock, byteRequests, sources };
  }

  it("mints the exact v7 id uuidv7FromParts gives for the clock, a zero counter and the bytes", () => {
    const { sources } = fakeSources(1_700_000_000_123);
    const id = createUuidv7Generator(sources)();
    expect(id).toMatch(V7_SHAPE);
    // First byte source call fills with 1; the counter overwrites bytes 0-1.
    const expected = new Uint8Array(10).fill(1);
    expected[0] = 0;
    expected[1] = 0;
    expect(id).toBe(uuidv7FromParts(1_700_000_000_123, expected));
  });

  it("reads the clock once and asks for 10 random bytes once per id (R1)", () => {
    const { clock, byteRequests, sources } = fakeSources(1000);
    const next = createUuidv7Generator(sources);
    expect(clock.reads).toBe(0);
    expect(byteRequests).toEqual([]);
    const ids = Array.from({ length: 5 }, () => next());
    expect(clock.reads).toBe(5);
    expect(byteRequests).toEqual([10, 10, 10, 10, 10]);
    // Fresh randomness each time: rand_b differs across ids.
    expect(new Set(ids.map((id) => id.slice(19))).size).toBe(5);
  });

  it("does not write into the buffer the byte source returned", () => {
    const shared = new Uint8Array(10).fill(0xaa);
    const next = createUuidv7Generator({ now: () => 1000, randomBytes: () => shared });
    next();
    next();
    expect(Array.from(shared)).toEqual(new Array(10).fill(0xaa));
  });

  it("orders ids minted in the same millisecond by the rand_a counter (R2)", () => {
    const { sources } = fakeSources(1000);
    const next = createUuidv7Generator(sources);
    const ids = Array.from({ length: 3 }, () => next());
    expect([...ids].sort()).toEqual(ids);
    expect(ids.map(encodedMs)).toEqual([1000, 1000, 1000]);
    expect(ids.map((id) => id.slice(15, 18))).toEqual(["000", "001", "002"]);
  });

  it("advances the encoded timestamp instead of wrapping past 4,096 ids in one millisecond (R2)", () => {
    const { sources } = fakeSources(1000);
    const next = createUuidv7Generator(sources);
    const ids = Array.from({ length: 5000 }, () => next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5000);
    expect(encodedMs(ids[4095]!)).toBe(1000);
    expect(ids[4095]!.slice(15, 18)).toBe("fff");
    expect(encodedMs(ids[4096]!)).toBe(1001);
    expect(ids[4096]!.slice(15, 18)).toBe("000");
  });

  it("keeps the last timestamp and keeps counting when the clock steps back (R3)", () => {
    const { clock, sources } = fakeSources(5000);
    const next = createUuidv7Generator(sources);
    const before = [next(), next()];
    clock.ms = 4990;
    const after = [next(), next()];
    const ids = [...before, ...after];
    expect([...ids].sort()).toEqual(ids);
    expect(after.map(encodedMs)).toEqual([5000, 5000]);

    // Once the wall clock passes the last timestamp, it is used again.
    clock.ms = 5001;
    const resumed = next();
    expect(encodedMs(resumed)).toBe(5001);
    expect(resumed > ids.at(-1)!).toBe(true);
  });

  it("gives each generator its own counter", () => {
    const a = createUuidv7Generator(fakeSources(1000).sources);
    const b = createUuidv7Generator(fakeSources(1000).sources);
    a();
    a();
    expect(a().slice(15, 18)).toBe("002");
    expect(b().slice(15, 18)).toBe("000");
  });

  it("routes through generateId once installed", () => {
    setIdGenerator(createUuidv7Generator(fakeSources(1000).sources));
    const id = generateId();
    expect(id).toMatch(V7_SHAPE);
    expect(encodedMs(id)).toBe(1000);
  });
});
