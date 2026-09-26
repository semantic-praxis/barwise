/**
 * Activation installs the UUIDv7 generator
 * (docs/specs/uuid7-generator-factory.spec.md).
 *
 * The generator is tested in core against a fake clock; what core cannot
 * see is that `activate()` installs it. Before the factory moved to core
 * this wiring had no test at all -- the CLI and MCP copies had one each,
 * the extension's copy none.
 *
 * `vscode` and the language client are replaced by an inert stand-in: any
 * property is a callable that returns another stand-in, so the real
 * `activate()` runs end to end without an editor, and the test reads the
 * result through core's own `generateId`. The integration suite runs in a
 * real editor but not in CI, so it cannot be the guard.
 */
import { generateId, setIdGenerator } from "@barwise/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const inert = vi.hoisted(() => {
  const make = (): unknown =>
    new Proxy(function() {}, {
      get: (_t, key) => {
        if (key === "then") return undefined; // not a thenable
        if (key === Symbol.toPrimitive) return () => "";
        return make();
      },
      apply: () => make(),
      construct: () => make() as object,
    });
  // A module namespace must be an object, not the callable stand-in.
  // `has` answers yes because vitest checks each named import against it.
  const module = (): object =>
    new Proxy({}, {
      get: (_t, key) => (key === "then" ? undefined : make()),
      has: (_t, key) => key !== "then",
    });
  return { make, module };
});

vi.mock("vscode", () => inert.module());
vi.mock("vscode-languageclient/node", () => inert.module());
vi.mock("@vscode/chat-extension-utils", () => inert.module());

const V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => setIdGenerator(undefined));

describe("activate", () => {
  it("installs the UUIDv7 id generator", async () => {
    expect(generateId()).toMatch(V4_SHAPE);
    const { activate } = await import("../../src/client/extension.js");
    activate(inert.make() as Parameters<typeof activate>[0]);
    expect(generateId()).toMatch(V7_SHAPE);
  }, 20_000); // importing the whole extension graph took 2.3s cold
});
