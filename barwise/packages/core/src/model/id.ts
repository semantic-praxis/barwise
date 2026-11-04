/**
 * The one spelling of the UUIDs core builds: `derivedId`'s v8. Element ids
 * are local names in format 4.0 (iri-identity WS6), given by the model or,
 * outside one, from the element's name, so core mints no random id and
 * reads no clock: `generateId`, its installable generator and the UUIDv7
 * factory retired with 6b-4b, as the spec's Retired list has it.
 */

/**
 * The 8-4-4-4-12 hex form of 16 bytes whose version and variant bits are
 * already set.
 */
export function formatUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error(`formatUuid: need 16 bytes, got ${bytes.length}`);
  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${
    hex.slice(20)
  }`;
}
