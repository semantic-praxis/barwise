/**
 * JSON Pointer segments (RFC 6901), both ways, kept together so the loader's
 * paths and ajv's `instancePath` are escaped and read by one rule.
 */

/** One segment, escaped: `~` as `~0`, then `/` as `~1`. */
export function pointerSegment(key: PropertyKey): string {
  return String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}

/** A pointer's segments, unescaped: `~1` as `/`, then `~0` as `~`. */
export function pointerSegments(pointer: string): string[] {
  return pointer.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}
