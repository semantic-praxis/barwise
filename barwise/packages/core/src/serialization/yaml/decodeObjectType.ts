import {
  buildObjectType,
  type CardinalityRange,
  CONCEPTUAL_DATA_TYPE_NAMES,
  type ConceptualDataTypeName,
  type DataTypeDef,
  type DecodeResult,
  identifyObjectType,
  type ObjectTypeConfig,
  type ObjectTypeKind,
  type ObjectTypeProblem,
  objectTypeRuleProblems,
  VALUE_ONLY_FIELDS,
  type ValueConstraintDef,
  type ValueRange,
} from "../../model/ObjectType.js";

/**
 * Every config field and its YAML spelling: the one statement of which
 * fields an object type has in a file.
 *
 * `satisfies` makes the compiler check it against `ObjectTypeConfig` both
 * ways, so a config field with no YAML name fails to compile, and
 * `tests/serialization/decodeObjectType.test.ts` checks the YAML names
 * against the JSON Schema's `object_type` properties. The decoder refuses a
 * key not listed here, which is the schema's `additionalProperties: false`.
 */
export const OBJECT_TYPE_YAML_FIELDS = {
  id: "id",
  name: "name",
  kind: "kind",
  referenceMode: "reference_mode",
  definition: "definition",
  sourceContext: "source_context",
  valueConstraint: "value_constraint",
  dataType: "data_type",
  aliases: "aliases",
  independent: "independent",
  defaultValue: "default_value",
  note: "note",
  cardinality: "cardinality",
} as const satisfies Record<keyof ObjectTypeConfig, string>;

type Field = keyof ObjectTypeConfig;
type Doc = Readonly<Record<string, unknown>>;

const KNOWN_FIELDS: ReadonlySet<string> = new Set(Object.values(OBJECT_TYPE_YAML_FIELDS));
const DATA_TYPE_NAMES: ReadonlySet<string> = new Set(CONCEPTUAL_DATA_TYPE_NAMES);

function isRecord(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return isInteger(v) && v >= 0;
}

/** How a wrong value reads in a message: what the reader wrote, briefly. */
function shown(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "a mapping";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

/**
 * How the shape stage reports. `refuse` records a problem against a field
 * and marks the field so no rule reports it again; `malformed` is `refuse`
 * for a value of the wrong shape, naming the path inside the field.
 */
interface Reporter {
  readonly subject: string;
  readonly refuse: (field: Field, message: string) => void;
  readonly malformed: (field: Field, path: string, requirement: string, got: unknown) => void;
}

/** Refuse each key of `v` outside `allowed`; true when there were none. */
function onlyKeys(
  v: Doc,
  allowed: readonly string[],
  field: Field,
  path: string,
  what: string,
  r: Reporter,
): boolean {
  let clean = true;
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) {
      r.malformed(field, `${path}.${key}`, `is not ${what}`, v[key]);
      clean = false;
    }
  }
  return clean;
}

/**
 * Turn one parsed YAML object type into an `ObjectType`, or into every
 * problem with it.
 *
 * Two stages, both collecting rather than stopping. The shape stage checks
 * what only a file can get wrong -- types, the data type enum, unknown
 * keys, everything the JSON Schema's `object_type` definition states -- and
 * reads the entry into a config. The rule stage is `objectTypeRuleProblems`,
 * the rules `createObjectType` applies to a config built in code, so the two
 * entry points cannot disagree about what an object type may be. A field
 * the shape stage refused is not checked again by a rule, so one mistake is
 * reported once.
 *
 * `newId` is the only source of a fresh id. It is called once, and only for
 * an entry with no `id` that decodes cleanly; the decoder never reads the
 * process-wide generator, so the caller decides where ids come from.
 */
export function decodeObjectType(doc: unknown, newId: () => string): DecodeResult {
  if (!isRecord(doc)) {
    return {
      ok: false,
      problems: [{
        objectType: "",
        field: "",
        message: `An object type must be a mapping of fields, not ${shown(doc)}.`,
      }],
    };
  }

  const kind: ObjectTypeKind | undefined = doc.kind === "entity" || doc.kind === "value"
    ? doc.kind
    : undefined;
  const { objectType, subject } = identifyObjectType(doc.name, doc.id, kind);
  const problems: ObjectTypeProblem[] = [];
  const unsound = new Set<Field>();
  const refuse = (field: Field, message: string) => {
    unsound.add(field);
    problems.push({ objectType, field: OBJECT_TYPE_YAML_FIELDS[field], message });
  };
  const r: Reporter = {
    subject,
    refuse,
    malformed: (field, path, requirement, got) =>
      refuse(field, `${subject}: \`${path}\` ${requirement}, not ${shown(got)}.`),
  };

  for (const key of Object.keys(doc)) {
    if (!KNOWN_FIELDS.has(key)) {
      problems.push({
        objectType,
        field: key,
        message: `${subject} has an unknown field \`${key}\`.`,
      });
    }
  }

  if (doc.id !== undefined && (typeof doc.id !== "string" || doc.id === "")) {
    r.malformed("id", "id", "must be a non-empty string", doc.id);
  }
  if (kind === undefined) {
    if (doc.kind === undefined) refuse("kind", `${subject} must have a \`kind\`: entity or value.`);
    else r.malformed("kind", "kind", "must be entity or value", doc.kind);
  }

  const optionalString = (field: Field): string | undefined => {
    const yamlField = OBJECT_TYPE_YAML_FIELDS[field];
    const v = doc[yamlField];
    if (v === undefined || typeof v === "string") return v;
    r.malformed(field, yamlField, "must be a string", v);
    return undefined;
  };

  // An empty reference mode on an entity type is left to the rule, which
  // says it must have one; on anything else the schema's `minLength`
  // refuses it here.
  let referenceMode: string | undefined;
  const rawReferenceMode = doc.reference_mode;
  if (rawReferenceMode !== undefined) {
    if (typeof rawReferenceMode !== "string") {
      r.malformed("referenceMode", "reference_mode", "must be a string", rawReferenceMode);
    } else if (rawReferenceMode === "" && kind !== "entity") {
      r.malformed("referenceMode", "reference_mode", "must be a non-empty string", "");
    } else {
      referenceMode = rawReferenceMode;
    }
  }

  let aliases: string[] | undefined;
  if (doc.aliases !== undefined) {
    if (Array.isArray(doc.aliases) && doc.aliases.every((a) => typeof a === "string" && a !== "")) {
      aliases = doc.aliases as string[];
    } else {
      r.malformed("aliases", "aliases", "must be a list of non-empty strings", doc.aliases);
    }
  }

  let independent: boolean | undefined;
  if (doc.independent !== undefined) {
    if (typeof doc.independent === "boolean") independent = doc.independent;
    else r.malformed("independent", "independent", "must be true or false", doc.independent);
  }

  // On an entity type the value-only fields are carried through unread: the
  // rule refuses them by presence and tells the reader to remove them, and
  // checking their contents would only add problems in a field to delete.
  // They never reach a built object type, because a problem stops the build.
  const valueOnly: {
    -readonly [K in (typeof VALUE_ONLY_FIELDS)[number][0]]?: ObjectTypeConfig[K];
  } = {};
  if (kind === "entity") {
    for (const [field] of VALUE_ONLY_FIELDS) {
      const raw = doc[OBJECT_TYPE_YAML_FIELDS[field]];
      if (raw !== undefined) Object.assign(valueOnly, { [field]: raw });
    }
  } else {
    if (doc.data_type !== undefined) valueOnly.dataType = decodeDataType(doc.data_type, r);
    if (doc.value_constraint !== undefined) {
      valueOnly.valueConstraint = decodeValueConstraint(doc.value_constraint, r);
    }
    valueOnly.defaultValue = optionalString("defaultValue");
  }

  const config = {
    ...(doc.id !== undefined && !unsound.has("id") ? { id: doc.id as string } : {}),
    // Not shape-checked: the rule refuses anything that is not a name, and
    // says so naming the object type by its id.
    name: doc.name as string,
    ...(kind !== undefined ? { kind } : {}),
    referenceMode,
    definition: optionalString("definition"),
    sourceContext: optionalString("sourceContext"),
    aliases,
    independent,
    note: optionalString("note"),
    cardinality: doc.cardinality === undefined ? undefined : decodeCardinality(doc.cardinality, r),
    ...valueOnly,
  };

  for (const p of objectTypeRuleProblems(config, unsound)) {
    problems.push({ ...p, field: OBJECT_TYPE_YAML_FIELDS[p.field as Field] });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: buildObjectType({ ...config, kind: kind! }, newId) };
}

function decodeDataType(v: unknown, r: Reporter): DataTypeDef | undefined {
  if (!isRecord(v)) {
    r.malformed("dataType", "data_type", "must be a mapping with a `name`", v);
    return undefined;
  }
  let sound = onlyKeys(
    v,
    ["name", "length", "scale"],
    "dataType",
    "data_type",
    "a data type field",
    r,
  );
  if (typeof v.name !== "string" || !DATA_TYPE_NAMES.has(v.name)) {
    r.malformed(
      "dataType",
      "data_type.name",
      `must be one of ${CONCEPTUAL_DATA_TYPE_NAMES.join(", ")}`,
      v.name,
    );
    sound = false;
  }
  for (const key of ["length", "scale"] as const) {
    if (v[key] !== undefined && !isNonNegativeInteger(v[key])) {
      r.malformed("dataType", `data_type.${key}`, "must be a non-negative integer", v[key]);
      sound = false;
    }
  }
  if (!sound) return undefined;
  return {
    name: v.name as ConceptualDataTypeName,
    ...(v.length !== undefined ? { length: v.length as number } : {}),
    ...(v.scale !== undefined ? { scale: v.scale as number } : {}),
  };
}

/**
 * The cardinality's shape. A negative minimum and a maximum below the
 * minimum are well shaped and wrong, so they pass through to the rule,
 * which reports them as it does for a config built in code.
 */
function decodeCardinality(v: unknown, r: Reporter): CardinalityRange | undefined {
  if (!isRecord(v)) {
    r.malformed("cardinality", "cardinality", "must be a mapping with `min` and `max`", v);
    return undefined;
  }
  let sound = onlyKeys(v, ["min", "max"], "cardinality", "cardinality", "a cardinality field", r);
  if (!isInteger(v.min)) {
    r.malformed("cardinality", "cardinality.min", "must be an integer", v.min);
    sound = false;
  }
  if (v.max !== "unbounded" && !isNonNegativeInteger(v.max)) {
    r.malformed(
      "cardinality",
      "cardinality.max",
      "must be a non-negative integer or unbounded",
      v.max,
    );
    sound = false;
  }
  return sound ? { min: v.min as number, max: v.max as number | "unbounded" } : undefined;
}

/**
 * The value constraint's shape. One with neither values nor ranges -- `{}`,
 * or `values: []` alone -- is well shaped and empty, so it reaches the
 * rule, which reports it as `createObjectType` always has.
 */
function decodeValueConstraint(v: unknown, r: Reporter): ValueConstraintDef | undefined {
  if (!isRecord(v)) {
    r.malformed("valueConstraint", "value_constraint", "must be a mapping", v);
    return undefined;
  }
  let sound = onlyKeys(
    v,
    ["values", "ranges"],
    "valueConstraint",
    "value_constraint",
    "a value constraint field",
    r,
  );
  const { values, ranges } = v;
  if (
    values !== undefined
    && (!Array.isArray(values) || !values.every((x) => typeof x === "string"))
  ) {
    r.malformed("valueConstraint", "value_constraint.values", "must be a list of strings", values);
    sound = false;
  }
  // Beside the other list, an empty one is refused rather than read as
  // "none", as the schema's `minItems` does.
  const emptyBeside = (key: "values" | "ranges", other: "values" | "ranges") => {
    r.refuse(
      "valueConstraint",
      `${r.subject}: \`value_constraint.${key}\` must not be empty; omit it to allow only the ${other}.`,
    );
    sound = false;
  };
  if (Array.isArray(values) && values.length === 0 && ranges !== undefined) {
    emptyBeside("values", "ranges");
  }
  const decodedRanges: ValueRange[] = [];
  if (ranges !== undefined) {
    if (!Array.isArray(ranges)) {
      r.malformed("valueConstraint", "value_constraint.ranges", "must be a list of ranges", ranges);
      sound = false;
    } else if (ranges.length === 0) {
      emptyBeside("ranges", "values");
    } else {
      ranges.forEach((range, i) => {
        const decoded = decodeRange(range, `value_constraint.ranges[${i}]`, r);
        if (decoded === undefined) sound = false;
        else decodedRanges.push(decoded);
      });
    }
  }
  if (!sound) return undefined;
  const list = Array.isArray(values) ? [...(values as string[])] : [];
  return decodedRanges.length > 0 ? { values: list, ranges: decodedRanges } : { values: list };
}

function decodeRange(v: unknown, path: string, r: Reporter): ValueRange | undefined {
  if (!isRecord(v)) {
    r.malformed("valueConstraint", path, "must be a mapping with `min` or `max`", v);
    return undefined;
  }
  let sound = onlyKeys(
    v,
    ["min", "max", "min_inclusive", "max_inclusive"],
    "valueConstraint",
    path,
    "a range field",
    r,
  );
  if (v.min === undefined && v.max === undefined) {
    r.malformed("valueConstraint", path, "must have a `min` or a `max`", v);
    sound = false;
  }
  for (const key of ["min", "max"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "string") {
      r.malformed("valueConstraint", `${path}.${key}`, "must be a string", v[key]);
      sound = false;
    }
  }
  for (const key of ["min_inclusive", "max_inclusive"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "boolean") {
      r.malformed("valueConstraint", `${path}.${key}`, "must be true or false", v[key]);
      sound = false;
    }
  }
  if (!sound) return undefined;
  // Only a `false` flag is kept: an inclusive bound is the default, and the
  // serializer writes only the exclusive one.
  return {
    ...(v.min !== undefined ? { min: v.min as string } : {}),
    ...(v.max !== undefined ? { max: v.max as string } : {}),
    ...(v.min_inclusive === false ? { minInclusive: false } : {}),
    ...(v.max_inclusive === false ? { maxInclusive: false } : {}),
  };
}
