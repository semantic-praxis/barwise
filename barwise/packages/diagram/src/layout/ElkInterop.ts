import ELKModule from "elkjs";
import type { ELK } from "elkjs";

// elkjs has CJS/ESM interop quirks: the default export may be the
// constructor directly or wrapped in a `.default` property.
const ELKConstructor = (
  typeof ELKModule === "function"
    ? ELKModule
    : (ELKModule as unknown as { default: new() => ELK; }).default
) as unknown as new() => ELK;

let elkInstance: ELK | undefined;

/**
 * Lazily construct and reuse a single ELK instance.
 *
 * ELK runs a Web Worker internally; sharing one instance avoids paying
 * that setup cost on every pass of the multi-pass layout.
 */
export function getElk(): ELK {
  if (!elkInstance) {
    elkInstance = new ELKConstructor();
  }
  return elkInstance;
}
