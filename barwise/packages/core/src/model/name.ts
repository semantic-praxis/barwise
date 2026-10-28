/**
 * The one place the element-naming rule lives: a name is required, and it
 * is stored trimmed.
 *
 * Both the class hierarchy (`ModelElement`, and every element still built
 * from it) and the sealed records WS1 is converting to (`createObjectType`)
 * enforce it, so the message existed in three places by the time
 * `ObjectType` stopped extending the class. Sharing it is what keeps the
 * two halves of the metamodel refusing the same inputs while WS1 is
 * partway through: a change here reaches both, where a fourth copy would
 * let them drift apart silently.
 */
export function requireName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error("Model element name must be a non-empty string.");
  }
  return trimmed;
}

/**
 * The ASCII characters a local name keeps as written: those an IRI path
 * segment may hold (RFC 3987 `ipchar`), less `:`, which separates an alias
 * from a name, and `.`, which separates a fact type from its role
 * (docs/specs/iri-identity.spec.md, decision 3). Letters beyond ASCII are
 * kept, as an IRI allows.
 */
const KEPT_ASCII = /[A-Za-z0-9\-_~!$&'()*+,;=@]/;

/**
 * The local name an element's name becomes in format 4.0: case kept, each
 * run of whitespace one `_`, and every character a path segment cannot
 * hold, or that barwise reserves (`:` and `.`), percent-encoded as UTF-8.
 * The one normalizer, so the migration, the validation that previews it,
 * and every later creation agree on what a name's id is.
 *
 * `localName("Customer places Order")` is `Customer_places_Order`;
 * `localName("v1.2 Order")` is `v1%2E2_Order`.
 */
export function localName(name: string): string {
  let out = "";
  for (const part of name.trim().split(/\s+/u)) {
    if (out !== "") out += "_";
    for (const ch of part) {
      const code = ch.codePointAt(0)!;
      const keep = code > 0x7f ? !isUnsafeNonAscii(code) : KEPT_ASCII.test(ch);
      out += keep ? ch : encode(ch);
    }
  }
  return out;
}

/** Control and format characters beyond ASCII, which an IRI may not hold raw. */
function isUnsafeNonAscii(code: number): boolean {
  return (code >= 0x80 && code <= 0x9f) || code === 0xfeff || (code >= 0xd800 && code <= 0xdfff);
}

function encode(ch: string): string {
  return [...new TextEncoder().encode(ch)]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}
