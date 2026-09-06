/**
 * Unit test for the ELK CJS/ESM interop shim: some bundlers resolve a
 * default import of a CJS package to the module namespace object
 * (carrying a nested `.default`) rather than unwrapping it to the
 * constructor directly. elkjs itself is well-behaved under Vitest (its
 * default export is already the constructor), so the double-wrapped
 * shape is reproduced here by mocking the module.
 */
import { describe, expect, it, vi } from "vitest";

class MockELK {
  async layout(): Promise<{ children: []; edges: []; }> {
    return { children: [], edges: [] };
  }
}

vi.mock("elkjs", () => ({ default: { default: MockELK } }));

const { getElk } = await import("../../src/layout/ElkInterop.js");

describe("getElk", () => {
  it("unwraps a .default-wrapped constructor when the top-level export isn't callable", () => {
    const elk = getElk();
    expect(elk).toBeInstanceOf(MockELK);
  });

  it("reuses the same lazily-constructed instance", () => {
    expect(getElk()).toBe(getElk());
  });
});
