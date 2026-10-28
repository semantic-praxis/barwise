/**
 * The pinned Ossie ontology schema at run time, and the fields a document
 * carries that it does not define (`docs/specs/ossie-unknown-fields.spec.md`).
 *
 * `parseOssie` checks only the fields the mapper reads, so without this a
 * field the schema does not define -- a typo, or one upstream added under
 * the same development version string -- imported with nothing said. The
 * schema already states which fields exist (`additionalProperties: false`
 * on every object it closes), so ajv reads that here rather than barwise
 * restating it: a moved pin moves the answer with it.
 *
 * Only `additionalProperties` errors are read. Every other violation is
 * either refused by `parseOssie` (a field the mapper reads) or sits in a
 * subtree the mapper drops whole with a warning (the spec's Out of scope).
 */
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import ontologySchema from "../../schemas/ossie/ontology.json" with { type: "json" };
import ossieCoreSchema from "../../schemas/ossie/ossie-schema.json" with { type: "json" };
import { OSSIE_VERSION } from "./OssieTypes.js";

/** The URL `ontology.json`'s `$ref`s name for the core schema, on Ossie's moving `main`. */
const OSSIE_CORE_SCHEMA_URL =
  "https://raw.githubusercontent.com/apache/ossie/main/core-spec/ossie-schema.json";

/**
 * Compile the pinned `ontology.json` on `ajv`, with the core schema served
 * from the vendored copy under the URL its `$ref`s name, so validation
 * needs no network and cannot drift from the pin. The caller configures
 * `ajv`: the export test compiles strictly with an `iri` format, the
 * importer leniently.
 */
export function compileOssieSchema(ajv: Ajv2020): ValidateFunction {
  // The core schema keeps its own `$id`; it is registered under the URL as
  // well. Deleting the `$id`, as an earlier copy of this did, would mutate
  // the imported JSON module every importer of it shares.
  ajv.addSchema(ossieCoreSchema, OSSIE_CORE_SCHEMA_URL);
  return ajv.compile(ontologySchema);
}

let importValidator: ValidateFunction | undefined;

/**
 * Not strict: strict mode checks how a schema is written, not the document,
 * so at run time it could only turn a re-pinned schema it dislikes into an
 * error on every import. The export test compiles strictly, so CI still
 * sees such a schema. No format is read, so none is validated. Compiled
 * on first use (about 75 ms) and kept: most processes import no Ossie.
 */
function validator(): ValidateFunction {
  importValidator ??= compileOssieSchema(
    new Ajv2020({ allErrors: true, strict: false, validateFormats: false }),
  );
  return importValidator;
}

/**
 * One warning per field in `raw` (the parsed document, before any of it is
 * read) that the pinned schema does not define. The order is ajv's: fixed
 * for a given document, an object's own unknown keys before its children's.
 */
export function unknownOssieFields(raw: unknown): string[] {
  const validate = validator();
  if (validate(raw)) return [];
  return (validate.errors ?? [])
    .filter((e) => e.keyword === "additionalProperties")
    .map((e) => {
      const field = (e.params as { additionalProperty: string; }).additionalProperty;
      return `${renderPath(raw, e.instancePath, field)}: the Ossie ${OSSIE_VERSION} schema `
        + `defines no such field; ignored.`;
    });
}

/**
 * A JSON pointer as the path `parseOssie`'s refusals write: `concept <name>`
 * for a path under `ontology[i]`, else from the root. Each segment is read
 * against the document, so an index into a list (`[0]`) and a key that
 * happens to be numeric (`["0"]`) cannot be confused.
 */
function renderPath(raw: unknown, pointer: string, field: string): string {
  const segments = pointer === "" ? [] : pointer.slice(1).split("/").map(decodeSegment);
  let at = raw;
  let path = "";
  for (const [i, segment] of segments.entries()) {
    if (Array.isArray(at)) {
      const index = Number(segment);
      const item: unknown = at[index];
      const conceptName = i === 1 && segments[0] === "ontology" ? nameOf(item) : undefined;
      path = conceptName === undefined ? `${path}[${index}]` : `concept ${conceptName}`;
      at = item;
    } else {
      path += key(segment, path === "");
      at = (at as Record<string, unknown>)[segment];
    }
  }
  return path + key(field, path === "");
}

/** The concept a component names; `parseOssie` has already refused one without. */
function nameOf(component: unknown): string | undefined {
  const name = (component as { concept?: unknown; } | undefined)?.concept;
  return typeof name === "string" ? name : undefined;
}

function key(name: string, first: boolean): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `[${JSON.stringify(name)}]`;
  return first ? name : `.${name}`;
}

/** RFC 6901: `~1` is `/`, then `~0` is `~`. */
function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
