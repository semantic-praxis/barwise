/**
 * The Apache Ossie ontology document, as `ontology/ontology.json` states it
 * at the pinned commit (`docs/specs/ossie-ontology-format.spec.md`).
 *
 * Every field the schema allows is listed, including the ones barwise
 * cannot carry (`iri`, `prefixes`, `ai_context`, `ontology_mappings`), so
 * the importer can name each one it drops instead of never seeing it.
 */

/** The one schema version this adapter reads and writes (Open decision 2). */
export const OSSIE_VERSION = "0.2.0.dev0";

export type OssieConceptType = "EntityType" | "ValueType";
export type OssieMultiplicity = "ManyToOne" | "OneToOne";

export interface OssieRole {
  readonly concept: string;
  readonly name?: string;
}

export interface OssieRelationship {
  readonly name: string;
  readonly description?: string;
  readonly roles?: readonly OssieRole[];
  readonly multiplicity?: OssieMultiplicity;
  readonly derived_by?: readonly string[];
  readonly requires?: readonly string[];
  readonly verbalizes: readonly string[];
  readonly iri?: string;
}

export interface OssieConcept {
  readonly concept: string;
  readonly type: OssieConceptType;
  readonly description?: string;
  readonly extends?: readonly string[];
  readonly derived_by?: readonly string[];
  readonly identify_by?: readonly string[];
  readonly requires?: readonly string[];
  readonly relationships?: readonly OssieRelationship[];
  readonly iri?: string;
}

export interface OssieDocument {
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly ai_context?: unknown;
  readonly requires?: readonly string[];
  readonly ontology: readonly OssieConcept[];
  readonly ontology_mappings?: readonly unknown[];
  readonly prefixes?: Readonly<Record<string, string>>;
}

/** Ossie's built-in value concepts and the barwise data type each is. */
export const OSSIE_BUILTIN_VALUE_TYPES = {
  Boolean: "boolean",
  Date: "date",
  DateTime: "datetime",
  Decimal: "decimal",
  Float: "float",
  Integer: "integer",
  String: "text",
} as const;

export type OssieBuiltinValueType = keyof typeof OSSIE_BUILTIN_VALUE_TYPES;

/** The built-in entity concept every entity type implicitly extends. */
export const OSSIE_ANY = "Any";

export function isOssieBuiltinValueType(name: string): name is OssieBuiltinValueType {
  return Object.hasOwn(OSSIE_BUILTIN_VALUE_TYPES, name);
}

/** Raised for a document the importer cannot read at all. */
export class OssieImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OssieImportError";
  }
}
