/**
 * Element id minting (uuid7-identifiers spec).
 *
 * Core mints default ids through `generateId()`, an explicit
 * registration seam: with no generator installed it falls back to
 * `randomUUID()` (v4 -- no clock read, so bare library use stays
 * deterministic-gate clean), and each surface entry point (CLI, MCP
 * server, VS Code activation) installs a UUIDv7 generator at startup so
 * fresh ids embed their creation time and sort in creation order.
 *
 * The v7 bit layout itself is the pure `uuidv7FromParts`: deterministic
 * given a timestamp and random bytes, so it lives in core; the ambient
 * clock and randomness stay one layer out, in the installer each
 * surface wires (the same one-layer-out rule as LLM calls and I/O).
 */
import { randomUUID } from "node:crypto";

/** Produces one fresh element id per call. */
export type IdGenerator = () => string;

let installedGenerator: IdGenerator | undefined;

/**
 * Install the process-wide id generator (pass undefined to restore the
 * v4 default). Called once at surface startup, like format registration.
 */
export function setIdGenerator(generator: IdGenerator | undefined): void {
  installedGenerator = generator;
}

/** Mint a fresh element id via the installed generator, or v4 by default. */
export function generateId(): string {
  return installedGenerator ? installedGenerator() : randomUUID();
}

/**
 * Build a UUIDv7 (RFC 9562) from explicit parts: a millisecond Unix
 * timestamp (the leading 48 bits, so ids sort by creation time) and at
 * least 10 random bytes. Pure -- same inputs, same id.
 *
 * Byte usage: `random[0]` (low nibble) and `random[1]` form the 12-bit
 * rand_a field -- installers put a monotonic counter there so mint
 * order and sort order stay aligned within one millisecond -- and
 * `random[2..9]` fill the 62-bit rand_b field.
 */
export function uuidv7FromParts(unixMs: number, random: Uint8Array): string {
  if (!Number.isInteger(unixMs) || unixMs < 0 || unixMs > 0xffff_ffff_ffff) {
    throw new Error(`uuidv7FromParts: timestamp out of 48-bit range: ${unixMs}`);
  }
  if (random.length < 10) {
    throw new Error(`uuidv7FromParts: need at least 10 random bytes, got ${random.length}`);
  }

  const b = new Uint8Array(16);
  let t = unixMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | (random[0]! & 0x0f); // version 7 + rand_a high nibble
  b[7] = random[1]!; // rand_a low byte
  b[8] = 0x80 | (random[2]! & 0x3f); // variant 10 + rand_b high 6 bits
  for (let i = 0; i < 7; i++) {
    b[9 + i] = random[3 + i]!;
  }

  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${
    hex.slice(20)
  }`;
}
