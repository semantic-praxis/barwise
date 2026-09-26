/**
 * Element id minting (uuid7-identifiers and uuid7-generator-factory specs).
 *
 * Core mints default ids through `generateId()`, an explicit
 * registration seam: with no generator installed it falls back to
 * `randomUUID()` (v4 -- no clock read, so bare library use stays
 * deterministic-gate clean), and each surface entry point (CLI, MCP
 * server, VS Code activation) installs a UUIDv7 generator at startup so
 * fresh ids sort in mint order and carry an approximate creation time.
 *
 * Approximate, not exact: the encoded timestamp is a logical one. When
 * more than 4,096 ids are minted in one millisecond, or the wall clock
 * steps backwards, the generator keeps counting from the last timestamp
 * it used rather than wrap or go back (RFC 9562 section 6.2), so an id
 * can read slightly later than the moment it was minted. Sort order is
 * the guarantee; the embedded time is a close estimate.
 *
 * Everything but the ambient sources lives here: the pure bit layout
 * `uuidv7FromParts` and the counter in `createUuidv7Generator`, which
 * reads the clock and randomness only through functions a surface hands
 * it. That is the one-layer-out rule applied to arguments rather than
 * packages: core holds the logic, the surface holds `Date.now`.
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
 * rand_a field -- `createUuidv7Generator` puts a monotonic counter there so mint
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

/** The ambient sources a UUIDv7 generator reads, supplied by the caller. */
export interface Uuidv7Sources {
  /** Unix milliseconds: `Date.now` at a surface, a fake clock in tests. */
  readonly now: () => number;
  /** `n` fresh random bytes: `node:crypto`'s `randomBytes` at a surface. */
  readonly randomBytes: (n: number) => Uint8Array;
}

/** The largest value the 12-bit rand_a counter holds. */
const MAX_COUNTER = 0xfff;

/**
 * Build a UUIDv7 generator over injected sources; install it with
 * `setIdGenerator(createUuidv7Generator({ now: Date.now, randomBytes }))`.
 *
 * Each call reads `now()` once and `randomBytes(10)` once. A 12-bit
 * counter in rand_a orders ids minted in the same millisecond. Two cases
 * would break sort order if handled naively, and both keep the last
 * timestamp instead (RFC 9562 section 6.2):
 *
 * - more than 4,096 ids in one millisecond: the counter would wrap to 0
 *   and sort the next id first, so the encoded timestamp advances by one;
 * - the clock steps backwards (NTP, a manual change, VM resume): encoding
 *   the earlier time would sort the new id before older ones, so the
 *   generator keeps the last timestamp and keeps counting.
 *
 * The counter state lives in the returned closure, so two generators are
 * independent.
 */
export function createUuidv7Generator(sources: Uuidv7Sources): IdGenerator {
  let lastMs = -1;
  let counter = 0;
  return () => {
    const wallMs = sources.now();
    // A copy, so the counter splice never writes into a buffer the
    // source might hand out again.
    const random = Uint8Array.from(sources.randomBytes(10));
    if (wallMs > lastMs) {
      lastMs = wallMs;
      counter = 0;
    } else if (counter < MAX_COUNTER) {
      counter++;
    } else {
      lastMs++;
      counter = 0;
    }
    random[0] = (counter >> 8) & 0x0f;
    random[1] = counter & 0xff;
    return uuidv7FromParts(lastMs, random);
  };
}
