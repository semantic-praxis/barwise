/**
 * A format 4.0 document as Effect Schemas (iri-identity WS6, 6b-2b-1),
 * held to `schemas/orm-model-4.0.schema.json` by
 * `tests/decode/document40SchemaDrift.test.ts`.
 *
 * 4.0 differs from 3.0 in its ids (`ids.ts`): each of the shape its rule
 * gives; a constraint's, subtype fact's or objectification's left to the
 * model when absent, with `minted_from` only beside one; and the model's
 * `imports`. Object types, fact types and constraints are built by the
 * same builders as 3.0's, from 4.0's leaves; subtype facts,
 * objectifications, populations, instances, diagrams and the model are
 * stated here, from 4.0's leaves. Definitions, the namespace, a diagram's
 * orientation and the model's label are 3.0's own pieces, reused: a change
 * to one of them changes both formats.
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
  smallElementConfigs,
} from "./document.js";
import { type DecodedFactType, factTypeFileOf } from "./factType.js";
import { IDS_40 } from "./ids.js";
import { Flag, Integer, Name, nonEmpty, notBlank, Text } from "./leaves.js";
import { objectTypeFileOf } from "./objectType.js";
import { type ElementLabel, elementOf } from "./problems.js";

const ids = IDS_40;

/**
 * An element 4.0 may leave unnamed, labelled by its id when it states one,
 * else by what it relates, so a problem with an id-less one still says
 * which it is.
 */
const byIdOr = (noun: string, relates: (raw: unknown) => string | undefined) =>
  elementOf({
    noun,
    badTag: "",
    describe: (raw: unknown): ElementLabel => {
      const id = raw !== null && typeof raw === "object"
        ? (raw as Record<string, unknown>).id
        : undefined;
      if (typeof id === "string" && id !== "") return { label: `${noun} "${id}"`, identity: id };
      const what = raw !== null && typeof raw === "object" ? relates(raw) : undefined;
      return what !== undefined
        ? { label: `${noun} ${what}`, identity: what }
        : { label: `${noun} with no id`, identity: "" };
    },
  });
const ruled = <S extends Schema.Top>(struct: S): S => struct.check(ids.mintedRule as never) as S;

const lists = constraintListsOf(constraintKindFiles(ids));

const SubtypeFactFile = ruled(
  Schema.Struct({
    ...ids.minted,
    subtype: ids.objectTypeRef,
    supertype: ids.objectTypeRef,
    provides_identification: Schema.optionalKey(Flag),
    defining_rule: Schema.optionalKey(DerivationFile),
  }).annotate(byIdOr("Subtype fact", (raw) => {
    const { subtype, supertype } = raw as { subtype?: unknown; supertype?: unknown; };
    return typeof subtype === "string" && typeof supertype === "string"
      ? `of "${subtype}" under "${supertype}"`
      : undefined;
  })),
);

const ObjectifiedFactTypeFile = ruled(
  Schema.Struct({
    ...ids.minted,
    fact_type: ids.factType,
    object_type: ids.objectTypeRef,
  }).annotate(byIdOr("Objectified fact type", (raw) => {
    const { fact_type } = raw as { fact_type?: unknown; };
    return typeof fact_type === "string" ? `of "${fact_type}"` : undefined;
  })),
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
  // Not blank, as `addDiagramLayout` refuses a blank name.
  name: notBlank(""),
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
  /** Each id the file states `minted_from` beside, with that key. */
  readonly mintedFrom: readonly (readonly [id: string, key: string])[];
}

/**
 * The configs. Object types, fact types and constraints go through 3.0's
 * mappings, which their shared builders make the same shape in both
 * formats but for a constraint's id, which 4.0 may leave out: that one
 * cast is the boundary, and `DecodedDocument40` types the id as optional.
 * Everything else maps through `smallElementConfigs`, typed for both.
 */
function document40Configs(file: (typeof Document40File)["Type"]): DecodedDocument40 {
  const m = file.model;
  const shared = documentConfigs({
    orm_version: "3.0",
    model: {
      name: m.name,
      ...(m.object_types !== undefined ? { object_types: m.object_types } : {}),
      ...(m.fact_types !== undefined ? { fact_types: m.fact_types } : {}),
      ...(m.constraints !== undefined ? { constraints: m.constraints } : {}),
    },
  } as unknown as DocumentFileValue);
  return {
    header: {
      name: m.name,
      ...(m.domain_context !== undefined ? { domainContext: m.domain_context } : {}),
      ...(m.namespace !== undefined ? { namespace: m.namespace } : {}),
      ...(m.note !== undefined ? { note: m.note } : {}),
      ...(m.imports !== undefined ? { imports: { ...m.imports } } : {}),
    },
    objectTypes: shared.objectTypes,
    factTypes: shared.factTypes as DecodedDocument40["factTypes"],
    constraints: shared.constraints as DecodedDocument40["constraints"],
    ...smallElementConfigs(m),
    mintedFrom: ([
      ...(m.fact_types ?? []).flatMap((ft) => ft.constraints ?? []),
      ...(m.constraints ?? []),
      ...(m.subtype_facts ?? []),
      ...(m.objectified_fact_types ?? []),
    ] as readonly { readonly id?: string; readonly minted_from?: string; }[]).flatMap((e) =>
      e.id !== undefined && e.minted_from !== undefined ? [[e.id, e.minted_from] as const] : []
    ),
  };
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
