/**
 * Smoke test for the UUIDv7 id-generator installer (uuid7-identifiers
 * spec WS2): once installed, fresh ids are v7-shaped and sort in mint
 * order, including within one millisecond via the rand_a counter.
 */
import { generateId, setIdGenerator } from "@barwise/core";
import { afterEach, describe, expect, it } from "vitest";
import { installUuidv7IdGenerator } from "../../src/workspace/idGenerator.js";

const V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  setIdGenerator(undefined);
});

describe("installUuidv7IdGenerator", () => {
  it("mints v7 ids that sort in creation order", () => {
    installUuidv7IdGenerator();
    const ids = Array.from({ length: 50 }, () => generateId());
    for (const id of ids) {
      expect(id).toMatch(V7_SHAPE);
    }
    expect([...ids].sort()).toEqual(ids);
  });
});
