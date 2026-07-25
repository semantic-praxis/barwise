/**
 * Install the process-wide UUIDv7 id generator (uuid7-identifiers spec
 * WS2): fresh element ids embed their creation time and sort in
 * creation order. The ambient clock and randomness live here at the
 * surface; the bit layout is core's pure `uuidv7FromParts`. A monotonic
 * counter in the rand_a field keeps mint order and sort order aligned
 * within one millisecond.
 */
import { setIdGenerator, uuidv7FromParts } from "@barwise/core";
import { randomBytes } from "node:crypto";

export function installUuidv7IdGenerator(): void {
  let lastMs = -1;
  let counter = 0;
  setIdGenerator(() => {
    const now = Date.now();
    if (now === lastMs) {
      counter = (counter + 1) & 0xfff;
    } else {
      lastMs = now;
      counter = 0;
    }
    const bytes = randomBytes(10);
    bytes[0] = (counter >> 8) & 0x0f;
    bytes[1] = counter & 0xff;
    return uuidv7FromParts(now, bytes);
  });
}
