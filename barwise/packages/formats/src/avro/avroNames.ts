/**
 * Avro's name rule for a namespace: dot-separated segments, each
 * `[A-Za-z_][A-Za-z0-9_]*`, or the empty string for the null namespace
 * (Avro 1.11 specification, "Names"). Strict parsers reject any other
 * namespace, though Java Avro, and so a Java schema registry, does not
 * check one, which is why the exporter writes what it is given and the
 * editor, which derives a namespace from a file name, repairs its own
 * (avro-namespace-from-file-name.spec.md, barwise-1c2).
 */

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether a namespace is one Avro's specification accepts. */
export function isAvroNamespace(namespace: string): boolean {
  return namespace === "" || namespace.split(".").every((segment) => SEGMENT.test(segment));
}

/**
 * A valid Avro namespace from free text such as a file name: each segment
 * keeps its letters, digits and underscores, every other character becomes
 * an underscore, and a segment that would start with a digit or be empty
 * gains a leading underscore. Accents are dropped first, and the text is
 * read by code point, so one file name gives one namespace however the
 * file system encodes it ("café" stored as "e" plus a combining accent is
 * still "cafe"). A namespace already valid is returned unchanged. Different texts can give one namespace ("order-system" and
 * "order_system"), so a caller that repairs a name says so.
 */
export function toAvroNamespace(text: string): string {
  if (isAvroNamespace(text)) return text;
  return text
    .split(".")
    .map((segment) => {
      const cleaned = [...segment.normalize("NFKD").replace(/\p{M}/gu, "")]
        .map((ch) => /[A-Za-z0-9_]/.test(ch) ? ch : "_")
        .join("");
      return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
    })
    .join(".");
}
