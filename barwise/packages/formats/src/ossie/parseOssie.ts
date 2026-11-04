/**
 * YAML (or JSON) text to an `OssieDocument`, plus a warning for each field
 * the pinned schema does not define.
 *
 * The checks here are the ones the mapper relies on: a field it reads has
 * the type the schema gives it, or the document is refused. A field the
 * schema does not define at all is not refused but named, by
 * `unknownOssieFields` against the pinned schema
 * (`docs/specs/ossie-unknown-fields.spec.md`), after these checks pass, so a
 * refused document reports none.
 */
import { parse as parseYaml } from "yaml";
import { unknownOssieFields } from "./ossieSchema.js";
import {
  OSSIE_VERSION,
  type OssieConcept,
  type OssieDocument,
  OssieImportError,
  type OssieRelationship,
} from "./OssieTypes.js";

export interface ParsedOssie {
  readonly document: OssieDocument;
  /** One per field the pinned schema does not define, in the order ajv reports them. */
  readonly warnings: readonly string[];
}

export function parseOssie(text: string): ParsedOssie {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new OssieImportError(
      `Not a readable Ossie document: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const doc = record(raw, "the document");

  // The version is checked before anything else, so a document written to
  // a later schema is refused by what it is, not by the first field that
  // happened to change shape (Open decision 2).
  if (doc["version"] !== OSSIE_VERSION) {
    throw new OssieImportError(
      `Ossie version ${JSON.stringify(doc["version"] ?? null)} is not supported; `
        + `barwise reads version ${OSSIE_VERSION} only.`,
    );
  }
  const name = text_(doc["name"], "name");
  const ontology = list(doc["ontology"], "ontology").map((c, i) => concept(c, `ontology[${i}]`));
  if (ontology.length === 0) throw new OssieImportError("ontology must list at least one concept.");

  const document: OssieDocument = {
    version: OSSIE_VERSION,
    name,
    ...opt("description", optText(doc["description"], "description")),
    ...opt("ai_context", doc["ai_context"]),
    ...opt("requires", optTexts(doc["requires"], "requires")),
    ontology,
    ...opt(
      "ontology_mappings",
      doc["ontology_mappings"] === undefined
        ? undefined
        : list(doc["ontology_mappings"], "ontology_mappings"),
    ),
    ...opt(
      "prefixes",
      doc["prefixes"] === undefined
        ? undefined
        : record(doc["prefixes"], "prefixes") as Record<string, string>,
    ),
  };
  return { document, warnings: unknownOssieFields(raw) };
}

function concept(raw: unknown, at: string): OssieConcept {
  const c = record(raw, at);
  const name = text_(c["concept"], `${at}.concept`);
  const where = `concept ${name}`;
  const type = c["type"];
  if (type !== "EntityType" && type !== "ValueType") {
    throw new OssieImportError(`${where}: type must be EntityType or ValueType.`);
  }
  return {
    concept: name,
    type,
    ...opt("description", optText(c["description"], `${where}.description`)),
    ...opt("extends", optTexts(c["extends"], `${where}.extends`)),
    ...opt("derived_by", optTexts(c["derived_by"], `${where}.derived_by`)),
    ...opt("identify_by", optTexts(c["identify_by"], `${where}.identify_by`)),
    ...opt("requires", optTexts(c["requires"], `${where}.requires`)),
    ...opt(
      "relationships",
      c["relationships"] === undefined
        ? undefined
        : list(c["relationships"], `${where}.relationships`).map((r, i) =>
          relationship(r, `${where}.relationships[${i}]`)
        ),
    ),
    ...opt("iri", optText(c["iri"], `${where}.iri`)),
  };
}

function relationship(raw: unknown, at: string): OssieRelationship {
  const r = record(raw, at);
  const name = text_(r["name"], `${at}.name`);
  const multiplicity = r["multiplicity"];
  if (multiplicity !== undefined && multiplicity !== "ManyToOne" && multiplicity !== "OneToOne") {
    throw new OssieImportError(`${at}: multiplicity must be ManyToOne or OneToOne.`);
  }
  const roles = r["roles"] === undefined ? undefined : list(r["roles"], `${at}.roles`).map(
    (role, i) => {
      const o = record(role, `${at}.roles[${i}]`);
      return {
        concept: text_(o["concept"], `${at}.roles[${i}].concept`),
        ...opt("name", optText(o["name"], `${at}.roles[${i}].name`)),
      };
    },
  );
  return {
    name,
    ...opt("description", optText(r["description"], `${at}.description`)),
    ...opt("roles", roles),
    ...opt("multiplicity", multiplicity as OssieRelationship["multiplicity"]),
    ...opt("derived_by", optTexts(r["derived_by"], `${at}.derived_by`)),
    ...opt("requires", optTexts(r["requires"], `${at}.requires`)),
    verbalizes: texts(r["verbalizes"], `${at}.verbalizes`),
    ...opt("iri", optText(r["iri"], `${at}.iri`)),
  };
}

/** `{ key: value }` when the value is present, `{}` when it is not. */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V; } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V; };
}

function record(raw: unknown, at: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OssieImportError(`${at} must be a mapping.`);
  }
  return raw as Record<string, unknown>;
}

function list(raw: unknown, at: string): unknown[] {
  if (!Array.isArray(raw)) throw new OssieImportError(`${at} must be a list.`);
  return raw;
}

function text_(raw: unknown, at: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new OssieImportError(`${at} must be a non-empty string.`);
  }
  return raw;
}

/**
 * An optional text field. Absent, null (`description:` left blank) and
 * empty all read as absent: refusing a whole ontology over a blank
 * description would cost more than it protects.
 */
function optText(raw: unknown, at: string): string | undefined {
  return raw === undefined || raw === null || raw === "" ? undefined : text_(raw, at);
}

function texts(raw: unknown, at: string): string[] {
  return list(raw, at).map((item, i) => text_(item, `${at}[${i}]`));
}

function optTexts(raw: unknown, at: string): string[] | undefined {
  return raw === undefined ? undefined : texts(raw, at);
}
