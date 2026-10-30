/**
 * A format 3.0 document, stated once as Effect Schemas: the header, every
 * element kind, and the document that holds them
 * (docs/specs/effect-adoption.spec.md, 1r, R4).
 *
 * R1 to R3 stated object types, constraints and fact types; this states the
 * rest -- subtype facts, objectifications, populations and their instances,
 * definitions and diagrams -- and the model's header, and composes them.
 * With it, every key of a 3.0 file has a decoder, and the 3.0 loader runs
 * this alone: ajv leaves the 3.0 path (R4). What decoding cannot see stays
 * where it was, run on the decoded value after decoding: ids repeated
 * across elements, references between elements, and the lenient option.
 *
 * As for the others, the Schemas are written in the file's own keys and
 * make no transformation, and each element's mapping gives the config
 * today's `deserialize*` function gives the model.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Definition } from "../model/Definition.js";
import type { DiagramLayout } from "../model/DiagramLayout.js";
import type { ObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { FactInstanceConfig, PopulationConfig } from "../model/Population.js";
import type { SubtypeFactConfig } from "../model/SubtypeFact.js";
import {
  constraintRecord,
  type DecodedExternalConstraint,
  ExternalConstraintsFile,
} from "./constraint.js";
import { type DecodeProblems, decoderFor, runDecode } from "./decoder.js";
import { DerivationFile, derivationRule } from "./derivation.js";
import { type DecodedFactType, factTypeConfig, FactTypeFile } from "./factType.js";
import { Flag, Integer, Name, nonEmpty, notBlank, Text } from "./leaves.js";
import { type DecodedObjectType, ObjectTypeFile, toRecord } from "./objectType.js";
import { type ElementLabel, elementOf } from "./problems.js";

// -- Leaves -----------------------------------------------------------------

/** How a message names an element by one of its fields, else by its noun. */
const labelBy = (noun: string, key: string, labelled?: string) => (raw: unknown): ElementLabel => {
  const value = raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>)[key]
    : undefined;
  return typeof value === "string" && value !== ""
    ? { label: `${labelled ?? noun} "${value}"`, identity: value }
    : { label: `${noun} with no ${key}`, identity: "" };
};

/** Annotate a struct as an element named by one field. */
const element = (noun: string, key: string, labelled?: string) =>
  elementOf({ noun, badTag: "", describe: labelBy(noun, key, labelled) });

// -- The remaining elements -------------------------------------------------

const SubtypeFactFile = Schema.Struct({
  id: nonEmpty(""),
  subtype: nonEmpty(""),
  supertype: nonEmpty(""),
  provides_identification: Schema.optionalKey(Flag),
  defining_rule: Schema.optionalKey(DerivationFile),
}).annotate(element("Subtype fact", "id"));

const ObjectifiedFactTypeFile = Schema.Struct({
  id: nonEmpty(""),
  fact_type: nonEmpty(""),
  object_type: nonEmpty(""),
}).annotate(element("Objectified fact type", "id"));

const FactInstanceFile = Schema.Struct({
  id: nonEmpty(""),
  role_values: Schema.Record(Schema.String, Text),
}).annotate(element("Fact instance", "id"));

const PopulationFile = Schema.Struct({
  id: nonEmpty(""),
  fact_type: nonEmpty(""),
  description: Schema.optionalKey(Text),
  sample: Schema.optionalKey(Flag),
  instances: Schema.Array(FactInstanceFile),
}).annotate(
  elementOf({
    noun: "Population",
    badTag: "",
    describe: labelBy("Population", "id"),
    locates: true,
  }),
);

const DefinitionFile = Schema.Struct({
  // Not blank, as `addDefinition` refuses a blank term or text: refused
  // here, the problem is reported with the file's others.
  term: notBlank(""),
  definition: notBlank(""),
  context: Schema.optionalKey(Text),
}).annotate(element("Definition", "term", "Definition of"));

type Orientation = DiagramLayout["orientations"][string];
/** A total record, so an orientation added to the model fails to compile here. */
const ORIENTATION_MEMBERS: Record<Orientation, true> = { horizontal: true, vertical: true };
const ORIENTATIONS = Object.keys(ORIENTATION_MEMBERS) as Orientation[];

const DiagramFile = Schema.Struct({
  // Not blank, as `addDiagramLayout` refuses a blank name.
  name: notBlank(""),
  elements: Schema.optionalKey(Schema.Array(nonEmpty(" (an element)"))),
  positions: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Struct({ x: Integer, y: Integer })),
  ),
  orientations: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Literals(ORIENTATIONS).annotate({
        message: `must be ${ORIENTATIONS.map((o) => `"${o}"`).join(" or ")}.`,
      }),
    ),
  ),
}).annotate(element("Diagram", "name"));

// -- The model and the document ---------------------------------------------

/**
 * The model's namespace, as the file's schema states it: a scheme, then no
 * space, ending in `/` or `#`. The model's constructor checks the IRI
 * again when the model is built, after decoding, as it does today; the
 * decoder states only what the schema states (a drift test holds the two
 * patterns together).
 */
export const NAMESPACE_FILE_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\S*[/#]$/;
const Namespace = Text.check(
  Schema.makeFilter((iri: string) => NAMESPACE_FILE_PATTERN.test(iri), {
    message: "must be an absolute IRI ending in / or #.",
  }),
);

const ModelFile = Schema.Struct({
  name: Name,
  domain_context: Schema.optionalKey(nonEmpty("")),
  namespace: Schema.optionalKey(Namespace),
  note: Schema.optionalKey(Text),
  object_types: Schema.optionalKey(Schema.Array(ObjectTypeFile)),
  fact_types: Schema.optionalKey(Schema.Array(FactTypeFile)),
  constraints: Schema.optionalKey(ExternalConstraintsFile),
  subtype_facts: Schema.optionalKey(Schema.Array(SubtypeFactFile)),
  objectified_fact_types: Schema.optionalKey(Schema.Array(ObjectifiedFactTypeFile)),
  populations: Schema.optionalKey(Schema.Array(PopulationFile)),
  definitions: Schema.optionalKey(Schema.Array(DefinitionFile)),
  diagrams: Schema.optionalKey(Schema.Array(DiagramFile)),
}).annotate(
  elementOf({
    noun: "Model",
    badTag: "",
    describe: (raw) => {
      const name = (raw as { name?: unknown; } | null)?.name;
      return typeof name === "string" && name.trim() !== ""
        ? { label: `Model "${name.trim()}"`, identity: name.trim() }
        : { label: "The model", identity: "" };
    },
  }),
);

/** A 3.0 document: its version, and its model. */
export const DocumentFile = Schema.Struct({
  orm_version: Schema.Literal("3.0").annotate({ message: 'must be "3.0".' }),
  model: ModelFile,
});

/** A decoded file document: exactly what the file states. */
export type DocumentFileValue = (typeof DocumentFile)["Type"];

// -- To the model's configs ---------------------------------------------------

/** A population and its instances, as the loader adds them. */
export interface DecodedPopulation {
  readonly config: PopulationConfig;
  readonly instances: readonly FactInstanceConfig[];
}

/** A decoded 3.0 document: each element as the config the model takes. */
export interface DecodedDocument {
  readonly header: {
    readonly name: string;
    readonly domainContext?: string;
    readonly namespace?: string;
    readonly note?: string;
  };
  readonly objectTypes: readonly DecodedObjectType[];
  readonly factTypes: readonly DecodedFactType[];
  readonly constraints: readonly DecodedExternalConstraint[];
  readonly subtypeFacts: readonly SubtypeFactConfig[];
  readonly objectifiedFactTypes: readonly ObjectifiedFactTypeConfig[];
  readonly populations: readonly DecodedPopulation[];
  readonly definitions: readonly Definition[];
  readonly diagrams: readonly DiagramLayout[];
}

/** The configs a decoded document stands for, as today's `deserialize*` functions build them. */
export function documentConfigs(file: DocumentFileValue): DecodedDocument {
  const m = file.model;
  return {
    header: {
      name: m.name,
      ...(m.domain_context !== undefined ? { domainContext: m.domain_context } : {}),
      ...(m.namespace !== undefined ? { namespace: m.namespace } : {}),
      ...(m.note !== undefined ? { note: m.note } : {}),
    },
    objectTypes: (m.object_types ?? []).map(toRecord),
    factTypes: (m.fact_types ?? []).map(factTypeConfig),
    constraints: (m.constraints ?? []).map(constraintRecord),
    subtypeFacts: (m.subtype_facts ?? []).map((sf) => ({
      id: sf.id,
      subtypeId: sf.subtype,
      supertypeId: sf.supertype,
      providesIdentification: sf.provides_identification ?? true,
      ...(sf.defining_rule !== undefined ? { definingRule: derivationRule(sf.defining_rule) } : {}),
    })),
    objectifiedFactTypes: (m.objectified_fact_types ?? []).map((o) => ({
      id: o.id,
      factTypeId: o.fact_type,
      objectTypeId: o.object_type,
    })),
    populations: (m.populations ?? []).map((p) => ({
      config: {
        id: p.id,
        factTypeId: p.fact_type,
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.sample !== undefined ? { sample: p.sample } : {}),
      },
      instances: p.instances.map((i) => ({ id: i.id, roleValues: { ...i.role_values } })),
    })),
    definitions: (m.definitions ?? []).map((d) => ({
      term: d.term,
      definition: d.definition,
      ...(d.context !== undefined ? { context: d.context } : {}),
    })),
    diagrams: (m.diagrams ?? []).map((d) => ({
      name: d.name,
      ...(d.elements !== undefined ? { elements: [...d.elements] } : {}),
      positions: Object.fromEntries(
        Object.entries(d.positions ?? {}).map(([k, p]) => [k, { x: p.x, y: p.y }]),
      ),
      orientations: { ...(d.orientations ?? {}) },
    })),
  };
}

// -- Decoding ---------------------------------------------------------------

const decodeFile = decoderFor(DocumentFile);

/** Decode a 3.0 document: every element's configs, or every problem in the file. */
export function decodeDocument(doc: unknown): Effect.Effect<DecodedDocument, DecodeProblems> {
  return decodeFile(doc).pipe(Effect.map(documentConfigs));
}

/** The synchronous boundary: the decoded document, or every problem thrown at once. */
export function runDocumentDecode(doc: unknown): DecodedDocument {
  return runDecode(decodeDocument(doc));
}
