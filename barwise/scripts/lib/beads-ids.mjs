/**
 * New issue ids for beads-crud: a random suffix, never the highest local
 * number plus one (beads-random-ids.spec.md, barwise-w1u).
 *
 * The counter read the LOCAL tracker, which is stale on every branch
 * behind main, so two open branches minted the same id for different
 * issues -- five times that we know of. A random suffix needs no shared
 * state. All-digit suffixes are skipped so a random id can never equal a
 * sequential one, old or new.
 */
import { randomInt } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const SUFFIX_LENGTH = 3;
export const MAX_TRIES = 100;

function randomSuffix() {
  let s = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/**
 * `<base><sep><suffix>` not already in `taken`, or null after MAX_TRIES.
 * `draw` is injectable so the retry limit can be tested.
 */
export function mintId(base, sep, taken, draw = randomSuffix) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const s = draw();
    if (/^[0-9]+$/.test(s)) continue;
    const id = `${base}${sep}${s}`;
    if (!taken.has(id)) return id;
  }
  return null;
}
