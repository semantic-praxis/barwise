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
 * (docs/specs/iri-identity.spec.md, decision 3).
 */
const KEPT_ASCII = /[A-Za-z0-9\-_~!$&'()*+,;=@]/;

/**
 * The local name an element's name becomes in format 4.0: the name in
 * Unicode NFC, as RFC 3987 advises, so names that print alike share an id;
 * case kept; each run of whitespace one `_`; and every character an IRI
 * path segment cannot hold, or that barwise reserves (`:` and `.`),
 * percent-encoded as UTF-8. The one normalizer, so the migration, the
 * validation that previews it, and every later creation agree on what a
 * name's id is.
 *
 * `localName("Customer places Order")` is `Customer_places_Order`;
 * `localName("v1.2 Order")` is `v1%2E2_Order`.
 */
export function localName(name: string): string {
  return words(name)
    .map((word) => [...word].map((ch) => keeps(ch) ? ch : encode(ch)).join(""))
    .join("_");
}

/**
 * Whether `localName` changes `name` beyond NFC and its whitespace, so
 * the id holds percent-encoded characters a reader will not recognise.
 */
export function localNameEncodes(name: string): boolean {
  return localName(name) !== words(name).join("_");
}

function words(name: string): string[] {
  return name.normalize("NFC").trim().split(/\s+/u).filter((w) => w !== "");
}

function keeps(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return cp <= 0x7f ? KEPT_ASCII.test(ch) : isUcschar(cp);
}

/**
 * RFC 3987 `ucschar`, less the bidirectional formatting characters its
 * section 4.1 says must not appear in an IRI.
 */
function isUcschar(cp: number): boolean {
  if (cp >= 0xa0 && cp <= 0xd7ff) {
    return !(cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e)
      || (cp >= 0x2066 && cp <= 0x2069));
  }
  if ((cp >= 0xf900 && cp <= 0xfdcf) || (cp >= 0xfdf0 && cp <= 0xffef)) return true;
  if (cp >= 0x10000 && cp <= 0xeffff) {
    if (cp >= 0xe0000 && cp <= 0xe0fff) return false;
    return (cp & 0xffff) <= 0xfffd;
  }
  return false;
}

/**
 * Percent-encode one code point as UTF-8. A lone surrogate, which UTF-8
 * cannot carry, takes its three-byte form, so two different lone
 * surrogates keep two different ids rather than both becoming U+FFFD.
 */
function encode(ch: string): string {
  const cp = ch.codePointAt(0)!;
  const bytes = cp < 0x80
    ? [cp]
    : cp < 0x800
    ? [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
    : cp < 0x10000
    ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
    : [
      0xf0 | (cp >> 18),
      0x80 | ((cp >> 12) & 0x3f),
      0x80 | ((cp >> 6) & 0x3f),
      0x80 | (cp & 0x3f),
    ];
  return bytes.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}
