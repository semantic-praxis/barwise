/**
 * A format 4.0 document as Effect Schemas (iri-identity WS6, 6b-2b-1),
 * held to `schemas/orm-model-4.0.schema.json` by
 * `tests/decode/document40SchemaDrift.test.ts`.
 *
 * 4.0 differs from 3.0 in its ids (`ids.ts`): each of the shape its rule
 * gives; a constraint's, subtype fact's or objectification's left to the
 * model when absent, with `minted_from` only beside one; and the model's
 * `imports`. Object types, fact types and constraints are built by the
 * same builders as 3.0's, from 4.0's leaves; the smaller elements are
 * stated here, because 3.0's are frozen and the two need not agree from
 * here on. The configs are the ones `documentConfigs` gives a 3.0 file.
 *
 * Nothing outside tests reads a 4.0 file yet: `planRead` still refuses
 * the version and the writer still writes 3.0, until 6b-2b-2 switches both
 * with the 3.x replay.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ExternalConstraint, InternalConstraint } from "../model/Constraint.js";
import { LOCAL_NAME_PATTERN } from "../model/name.js";
import type { ObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { SubtypeFactConfig } from "../model/SubtypeFact.js";
import { constraintKindFiles, constraintListsOf, InternalConstraintsFile } from "./constraint.js";
import { type DecodeProblems, decoderFor, runDecode } from "./decoder.js";
import { DerivationFile } from "./derivation.js";
import {
  type DecodedDocument,
  DefinitionFile,
  documentConfigs,
  type DocumentFileValue,
  element,
  labelBy,
  modelElement,
  Namespace,
  OrientationFile,
} from "./document.js";
import { type DecodedFactType, factTypeFileOf } from "./factType.js";
import { IDS_40 } from "./ids.js";
import { Flag, Integer, Name, nonEmpty, Text } from "./leaves.js";
import { objectTypeFileOf } from "./objectType.js";
import { elementOf } from "./problems.js";

const ids = IDS_40;
const ruled = <S extends Schema.Top>(struct: S): S => struct.check(ids.mintedRule as never) as S;

const lists = constraintListsOf(constraintKindFiles(ids));

const SubtypeFactFile = ruled(
  Schema.Struct({
    ...ids.minted,
    subtype: ids.objectTypeRef,
    supertype: ids.objectTypeRef,
    provides_identification: Schema.optionalKey(Flag),
    defining_rule: Schema.optionalKey(DerivationFile),
  }).annotate(element("Subtype fact", "id")),
);

const ObjectifiedFactTypeFile = ruled(
  Schema.Struct({
    ...ids.minted,
    fact_type: ids.factType,
    object_type: ids.objectTypeRef,
  }).annotate(element("Objectified fact type", "id")),
);

const FactInstanceFile = Schema.Struct({
  id: ids.instance,
  role_values: Schema.Record(ids.roleKey, Text),
}).annotate(element("Fact instance", "id"));

const PopulationFile = Schema.Struct({
  id: ids.population,
  fact_type: ids.factType,
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

const DiagramFile = Schema.Struct({
  name: nonEmpty(""),
  elements: Schema.optionalKey(Schema.Array(ids.elementInList)),
  positions: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Struct({ x: Integer, y: Integer })),
  ),
  orientations: Schema.optionalKey(
    Schema.Record(Schema.String, OrientationFile),
  ),
}).annotate(element("Diagram", "name"));

/** An alias, as `imports` keys it: a local name. */
const Alias = Schema.String.check(
  Schema.makeFilter((alias: string) => LOCAL_NAME_PATTERN.test(alias), {
    message: "must be a local name (an alias).",
  }),
);

const ModelFile = Schema.Struct({
  name: Name,
  domain_context: Schema.optionalKey(nonEmpty("")),
  namespace: Schema.optionalKey(Namespace),
  imports: Schema.optionalKey(Schema.Record(Alias, nonEmpty(""))),
  note: Schema.optionalKey(Text),
  object_types: Schema.optionalKey(Schema.Array(objectTypeFileOf(ids))),
  fact_types: Schema.optionalKey(
    Schema.Array(factTypeFileOf(ids, lists.internal as unknown as typeof InternalConstraintsFile)),
  ),
  constraints: Schema.optionalKey(lists.external),
  subtype_facts: Schema.optionalKey(Schema.Array(SubtypeFactFile)),
  objectified_fact_types: Schema.optionalKey(Schema.Array(ObjectifiedFactTypeFile)),
  populations: Schema.optionalKey(Schema.Array(PopulationFile)),
  definitions: Schema.optionalKey(Schema.Array(DefinitionFile)),
  diagrams: Schema.optionalKey(Schema.Array(DiagramFile)),
}).annotate(modelElement);

/** A 4.0 document: its version, and its model. */
export const Document40File = Schema.Struct({
  orm_version: Schema.Literal("4.0").annotate({ message: 'must be "4.0".' }),
  model: ModelFile,
});

/** A decoded 4.0 document: each element as the config the model takes. */
export interface DecodedDocument40 {
  readonly header: DecodedDocument["header"] & {
    readonly imports?: Readonly<Record<string, string>>;
  };
  readonly objectTypes: DecodedDocument["objectTypes"];
  readonly factTypes: readonly (
    & Omit<DecodedFactType, "constraints">
    & { readonly constraints: readonly InternalConstraint[]; }
  )[];
  readonly constraints: readonly ExternalConstraint[];
  readonly subtypeFacts: readonly SubtypeFactConfig[];
  readonly objectifiedFactTypes: readonly ObjectifiedFactTypeConfig[];
  readonly populations: DecodedDocument["populations"];
  readonly definitions: DecodedDocument["definitions"];
  readonly diagrams: DecodedDocument["diagrams"];
}

/**
 * The configs: 3.0's mapping, which reads only fields the two formats
 * share (`minted_from` and `imports` are not among them), with the
 * header's `imports` added. An id the file leaves out maps to an id of
 * `undefined`, which the model names as it names an absent one.
 */
function document40Configs(file: (typeof Document40File)["Type"]): DecodedDocument40 {
  // The one boundary where a 4.0 value is read as 3.0's type: every field
  // `documentConfigs` reads has the same shape in both, except an id 4.0
  // may leave out, which `DecodedDocument40` types as optional.
  const configs = documentConfigs(
    file as unknown as DocumentFileValue,
  ) as unknown as DecodedDocument40;
  const imports = file.model.imports;
  return imports === undefined
    ? configs
    : { ...configs, header: { ...configs.header, imports: { ...imports } } };
}

const decodeFile = decoderFor(Document40File);

/** Decode a 4.0 document: every element's configs, or every problem in the file. */
export function decodeDocument40(doc: unknown): Effect.Effect<DecodedDocument40, DecodeProblems> {
  return decodeFile(doc).pipe(Effect.map(document40Configs));
}

/** The synchronous boundary: the decoded document, or every problem thrown at once. */
export function runDocument40Decode(doc: unknown): DecodedDocument40 {
  return runDecode(decodeDocument40(doc));
}
