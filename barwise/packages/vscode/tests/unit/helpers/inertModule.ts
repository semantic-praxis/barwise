/**
 * An inert stand-in for a module the unit tier cannot load (`vscode`, the
 * language client): any property is another stand-in, calls and `new`
 * return one, and nothing is a thenable. Pass it to `vi.mock` as
 * `vi.mock("vscode", async () => (await import("./helpers/inertModule.js")).inertModule())`.
 */
/** One inert value: any property, call or construction is another. */
export const inertValue = (): unknown =>
  new Proxy(function() {}, {
    get: (_t, key) => {
      if (key === "then") return undefined; // not a thenable
      if (key === Symbol.toPrimitive) return () => "";
      return inertValue();
    },
    apply: () => inertValue(),
    construct: () => inertValue() as object,
  });

/**
 * A module namespace must be an object, not the callable stand-in. `has`
 * answers yes because vitest checks each named import against it.
 */
export const inertModule = (): object =>
  new Proxy({}, {
    get: (_t, key) => (key === "then" ? undefined : inertValue()),
    has: (_t, key) => key !== "then",
  });
