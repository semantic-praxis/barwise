/**
 * Low-level parser that converts NORMA .orm XML text into intermediate
 * NormaDocument objects.
 *
 * This module handles the raw XML structure and produces typed objects
 * that the NormaToOrmMapper can consume. It does not validate referential
 * integrity -- that is the mapper's responsibility.
 */
import { XMLParser } from "fast-xml-parser";
import type {
  NormaConstraint,
  NormaDataType,
  NormaDocument,
  NormaEntityType,
  NormaFactType,
  NormaMultiplicity,
  NormaObjectifiedType,
  NormaReading,
  NormaReadingOrder,
  NormaRingType,
  NormaRole,
  NormaSubtypeFact,
  NormaValueConstraintInline,
  NormaValueType,
} from "./NormaXmlTypes.js";

/**
 * Error thrown when the XML cannot be parsed or does not have the
 * expected NORMA structure.
 */
export class NormaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormaParseError";
  }
}

// The NORMA XML namespace prefix we expect after parsing.
// fast-xml-parser strips namespace URIs and uses prefixes as-is when
// configured with removeNSPrefix: true.

/**
 * Parse a NORMA .orm XML string into a NormaDocument.
 *
 * @throws NormaParseError if the XML is malformed or missing required
 *         NORMA elements.
 */
export function parseNormaXml(xml: string): NormaDocument {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    isArray: (tagName) => arrayTags.has(tagName),
    trimValues: true,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new NormaParseError(
      `Failed to parse XML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Navigate to the ORMModel element.
  const root = parsed["ORM2"] as Record<string, unknown> | undefined;
  if (!root) {
    throw new NormaParseError("Missing root ORM2 element.");
  }

  const ormModel = root["ORMModel"] as Record<string, unknown> | undefined;
  if (!ormModel) {
    throw new NormaParseError("Missing ORMModel element inside ORM2.");
  }

  const modelId = attr(ormModel, "id") ?? "";
  const modelName = attr(ormModel, "Name") ?? "Unnamed";

  // Parse each section.
  const objects = child(ormModel, "Objects") as Record<string, unknown> | undefined;
  const facts = child(ormModel, "Facts") as Record<string, unknown> | undefined;
  const constraints = child(ormModel, "Constraints") as Record<string, unknown> | undefined;
  const dataTypesSection = child(ormModel, "DataTypes") as Record<string, unknown> | undefined;

  const entityTypes = parseEntityTypes(objects);
  const valueTypes = parseValueTypes(objects);
  const objectifiedTypes = parseObjectifiedTypes(objects);
  const factTypes = parseFactTypes(facts);
  const subtypeFacts = parseSubtypeFacts(facts);
  const parsedConstraints = parseConstraints(constraints);
  const dataTypes = parseDataTypes(dataTypesSection);

  return {
    modelId,
    modelName,
    entityTypes,
    valueTypes,
    objectifiedTypes,
    factTypes,
    subtypeFacts,
    constraints: parsedConstraints,
    dataTypes,
  };
}

// ---- Tags that should always be parsed as arrays ----

const arrayTags = new Set([
  "EntityType",
  "ValueType",
  "ObjectifiedType",
  "Fact",
  "SubtypeFact",
  "ImpliedFact",
  "Role",
  "SubtypeMetaRole",
  "SupertypeMetaRole",
  "ReadingOrder",
  "Reading",
  "UniquenessConstraint",
  "MandatoryConstraint",
  "FrequencyConstraint",
  "ValueConstraint",
  "SubsetConstraint",
  "ExclusionConstraint",
  "EqualityConstraint",
  "RingConstraint",
  "ValueRange",
  "RoleSequence",
]);

// ---- Helpers ----

function attr(el: Record<string, unknown>, name: string): string | undefined {
  const v = el[`@_${name}`];
  return v != null ? String(v) : undefined;
}

function child(
  el: Record<string, unknown>,
  name: string,
): unknown {
  return el[name];
}

function asArray(val: unknown): Record<string, unknown>[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val as Record<string, unknown>[];
  return [val as Record<string, unknown>];
}

// ---- Object Type Parsing ----

function parseEntityTypes(
  objects: Record<string, unknown> | undefined,
): NormaEntityType[] {
  if (!objects) return [];
  return asArray(objects["EntityType"]).map((et) => {
    const playedRoles = child(et, "PlayedRoles") as Record<string, unknown> | undefined;
    const prefId = child(et, "PreferredIdentifier") as Record<string, unknown> | undefined;
    const defs = parseDefinitionText(et);

    return {
      id: attr(et, "id") ?? "",
      name: attr(et, "Name") ?? "",
      referenceMode: attr(et, "_ReferenceMode"),
      preferredIdentifier: prefId ? attr(prefId, "ref") : undefined,
      playedRoleRefs: parseRoleRefs(playedRoles),
      definition: defs,
    };
  });
}

function parseValueTypes(
  objects: Record<string, unknown> | undefined,
): NormaValueType[] {
  if (!objects) return [];
  return asArray(objects["ValueType"]).map((vt) => {
    const playedRoles = child(vt, "PlayedRoles") as Record<string, unknown> | undefined;
    const defs = parseDefinitionText(vt);
    const valueRestriction = child(vt, "ValueRestriction") as Record<string, unknown> | undefined;
    const cdt = child(vt, "ConceptualDataType") as Record<string, unknown> | undefined;

    const lengthStr = cdt ? attr(cdt, "Length") : undefined;
    const scaleStr = cdt ? attr(cdt, "Scale") : undefined;
    const dtLength = lengthStr ? parseInt(lengthStr, 10) : undefined;
    const dtScale = scaleStr ? parseInt(scaleStr, 10) : undefined;

    return {
      id: attr(vt, "id") ?? "",
      name: attr(vt, "Name") ?? "",
      playedRoleRefs: parseRoleRefs(playedRoles),
      definition: defs,
      valueConstraint: valueRestriction
        ? parseValueRestriction(valueRestriction)
        : undefined,
      dataTypeRef: cdt ? attr(cdt, "ref") : undefined,
      dataTypeLength: dtLength !== undefined && !isNaN(dtLength) ? dtLength : undefined,
      dataTypeScale: dtScale !== undefined && !isNaN(dtScale) ? dtScale : undefined,
    };
  });
}

function parseObjectifiedTypes(
  objects: Record<string, unknown> | undefined,
): NormaObjectifiedType[] {
  if (!objects) return [];
  return asArray(objects["ObjectifiedType"]).map((ot) => {
    const nested = child(ot, "NestedPredicate") as Record<string, unknown> | undefined;
    const playedRoles = child(ot, "PlayedRoles") as Record<string, unknown> | undefined;
    const prefId = child(ot, "PreferredIdentifier") as Record<string, unknown> | undefined;
    const defs = parseDefinitionText(ot);

    return {
      id: attr(ot, "id") ?? "",
      name: attr(ot, "Name") ?? "",
      nestedFactTypeRef: nested ? (attr(nested, "ref") ?? "") : "",
      referenceMode: attr(ot, "_ReferenceMode"),
      preferredIdentifier: prefId ? attr(prefId, "ref") : undefined,
      playedRoleRefs: parseRoleRefs(playedRoles),
      definition: defs,
    };
  });
}

function parseRoleRefs(
  playedRoles: Record<string, unknown> | undefined,
): string[] {
  if (!playedRoles) return [];
  return asArray(playedRoles["Role"]).map(
    (r) => attr(r, "ref") ?? "",
  );
}

function parseDefinitionText(
  el: Record<string, unknown>,
): string | undefined {
  const defs = child(el, "Definitions") as Record<string, unknown> | undefined;
  if (!defs) return undefined;
  const defn = child(defs, "Definition") as Record<string, unknown> | undefined;
  if (!defn) return undefined;
  const text = child(defn, "DefinitionText");
  return text != null ? String(text) : undefined;
}

function parseValueRestriction(
  vr: Record<string, unknown>,
): NormaValueConstraintInline | undefined {
  // ValueConstraint is in arrayTags, so it parses as an array.
  const vcs = asArray(vr["ValueConstraint"]);
  const vc = vcs.length > 0 ? vcs[0] : undefined;
  if (!vc) return undefined;
  const ranges = child(vc, "ValueRanges") as Record<string, unknown> | undefined;
  if (!ranges) return undefined;

  const values: string[] = [];
  for (const range of asArray(ranges["ValueRange"])) {
    const minVal = attr(range, "MinValue");
    const maxVal = attr(range, "MaxValue");
    // For enumerated values, MinValue === MaxValue.
    if (minVal !== undefined && minVal === maxVal) {
      values.push(minVal);
    }
  }
  return values.length > 0 ? { values } : undefined;
}

// ---- Fact Type Parsing ----

function parseFactTypes(
  facts: Record<string, unknown> | undefined,
): NormaFactType[] {
  if (!facts) return [];
  // Only parse <Fact>, skip <SubtypeFact> and <ImpliedFact>.
  return asArray(facts["Fact"]).map((ft) => {
    const factRoles = child(ft, "FactRoles") as Record<string, unknown> | undefined;
    const readingOrders = child(ft, "ReadingOrders") as Record<string, unknown> | undefined;
    const internalConstraints = child(ft, "InternalConstraints") as
      | Record<string, unknown>
      | undefined;
    const defs = parseDefinitionText(ft);

    return {
      id: attr(ft, "id") ?? "",
      name: attr(ft, "_Name") ?? "",
      roles: parseRoles(factRoles),
      readingOrders: parseReadingOrders(readingOrders),
      internalConstraintRefs: parseInternalConstraintRefs(internalConstraints),
      definition: defs,
    };
  });
}

function parseRoles(
  factRoles: Record<string, unknown> | undefined,
): NormaRole[] {
  if (!factRoles) return [];
  return asArray(factRoles["Role"]).map((r) => {
    const playerEl = child(r, "RolePlayer") as Record<string, unknown> | undefined;
    return {
      id: attr(r, "id") ?? "",
      name: attr(r, "Name") ?? "",
      playerRef: playerEl ? (attr(playerEl, "ref") ?? "") : "",
      isMandatory: attr(r, "_IsMandatory") === "true",
      multiplicity: parseMultiplicity(attr(r, "_Multiplicity")),
    };
  });
}

function parseMultiplicity(raw: string | undefined): NormaMultiplicity {
  switch (raw) {
    case "ZeroToOne":
      return "ZeroToOne";
    case "ZeroToMany":
      return "ZeroToMany";
    case "ExactlyOne":
      return "ExactlyOne";
    case "OneToMany":
      return "OneToMany";
    default:
      return "Unspecified";
  }
}

function parseReadingOrders(
  readingOrders: Record<string, unknown> | undefined,
): NormaReadingOrder[] {
  if (!readingOrders) return [];
  return asArray(readingOrders["ReadingOrder"]).map((ro) => {
    const readings = child(ro, "Readings") as Record<string, unknown> | undefined;
    const roleSeq = firstRoleSequence(ro);

    return {
      id: attr(ro, "id") ?? "",
      readings: parseReadings(readings),
      roleSequence: roleSeq ? parseRoleSequenceRefs(roleSeq) : [],
    };
  });
}

function parseReadings(
  readings: Record<string, unknown> | undefined,
): NormaReading[] {
  if (!readings) return [];
  return asArray(readings["Reading"]).map((r) => ({
    id: attr(r, "id") ?? "",
    data: String(child(r, "Data") ?? ""),
  }));
}

function parseRoleSequenceRefs(
  roleSeq: Record<string, unknown> | undefined,
): string[] {
  if (!roleSeq) return [];
  return asArray(roleSeq["Role"]).map((r) => attr(r, "ref") ?? "");
}

/**
 * Extract the first RoleSequence from a constraint element.
 * Since RoleSequence is in arrayTags, it always parses as an array.
 */
function firstRoleSequence(
  el: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const seqs = asArray(el["RoleSequence"]);
  return seqs.length > 0 ? seqs[0] : undefined;
}

function parseInternalConstraintRefs(
  ic: Record<string, unknown> | undefined,
): string[] {
  if (!ic) return [];
  const refs: string[] = [];
  for (
    const tag of [
      "UniquenessConstraint",
      "MandatoryConstraint",
      "FrequencyConstraint",
      "RingConstraint",
      "ValueConstraint",
      "SubsetConstraint",
      "ExclusionConstraint",
      "EqualityConstraint",
    ]
  ) {
    for (const el of asArray(ic[tag])) {
      const ref = attr(el, "ref");
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

// ---- Subtype Fact Parsing ----

function parseSubtypeFacts(
  facts: Record<string, unknown> | undefined,
): NormaSubtypeFact[] {
  if (!facts) return [];
  return asArray(facts["SubtypeFact"]).map((sf) => {
    const factRoles = child(sf, "FactRoles") as Record<string, unknown> | undefined;
    const providesId = attr(sf, "PreferredIdentificationPath") !== "false";

    let subtypeRoleId = "";
    let subtypePlayerRef = "";
    let supertypeRoleId = "";
    let supertypePlayerRef = "";

    if (factRoles) {
      // SubtypeMetaRole and SupertypeMetaRole
      const subtypeRoles = asArray(factRoles["SubtypeMetaRole"]);
      if (subtypeRoles.length > 0) {
        const sr = subtypeRoles[0]!;
        subtypeRoleId = attr(sr, "id") ?? "";
        const player = child(sr, "RolePlayer") as Record<string, unknown> | undefined;
        subtypePlayerRef = player ? (attr(player, "ref") ?? "") : "";
      }

      const supertypeRoles = asArray(factRoles["SupertypeMetaRole"]);
      if (supertypeRoles.length > 0) {
        const sr = supertypeRoles[0]!;
        supertypeRoleId = attr(sr, "id") ?? "";
        const player = child(sr, "RolePlayer") as Record<string, unknown> | undefined;
        supertypePlayerRef = player ? (attr(player, "ref") ?? "") : "";
      }
    }

    return {
      id: attr(sf, "id") ?? "",
      subtypeRoleId,
      subtypePlayerRef,
      supertypeRoleId,
      supertypePlayerRef,
      providesIdentification: providesId,
    };
  });
}

// ---- Constraint Parsing ----

function parseConstraints(
  constraints: Record<string, unknown> | undefined,
): NormaConstraint[] {
  if (!constraints) return [];
  const result: NormaConstraint[] = [];

  // UniquenessConstraint
  for (const uc of asArray(constraints["UniquenessConstraint"])) {
    const roleSeqs = asArray(uc["RoleSequence"]);
    const roleRefs: string[] = [];
    for (const seq of roleSeqs) {
      roleRefs.push(...asArray(seq["Role"]).map((r) => attr(r, "ref") ?? ""));
    }
    result.push({
      type: "uniqueness",
      id: attr(uc, "id") ?? "",
      name: attr(uc, "Name") ?? "",
      isInternal: attr(uc, "IsInternal") === "true",
      isPreferred: attr(uc, "IsPreferred") === "true"
        || asArray(uc["PreferredIdentifierFor"]).length > 0,
      roleRefs,
    });
  }

  // MandatoryConstraint
  for (const mc of asArray(constraints["MandatoryConstraint"])) {
    const roleSeq = firstRoleSequence(mc);
    result.push({
      type: "mandatory",
      id: attr(mc, "id") ?? "",
      name: attr(mc, "Name") ?? "",
      isSimple: attr(mc, "IsSimple") === "true",
      isImplied: attr(mc, "IsImplied") === "true",
      roleRefs: roleSeq ? parseRoleSequenceRefs(roleSeq) : [],
    });
  }

  // FrequencyConstraint
  for (const fc of asArray(constraints["FrequencyConstraint"])) {
    const roleSeq = firstRoleSequence(fc);
    const minStr = attr(fc, "MinFrequency");
    const maxStr = attr(fc, "MaxFrequency");
    result.push({
      type: "frequency",
      id: attr(fc, "id") ?? "",
      name: attr(fc, "Name") ?? "",
      min: minStr ? parseInt(minStr, 10) : 1,
      max: maxStr ? parseInt(maxStr, 10) : "unbounded",
      roleRefs: roleSeq ? parseRoleSequenceRefs(roleSeq) : [],
    });
  }

  // ValueConstraint
  for (const vc of asArray(constraints["ValueConstraint"])) {
    const roleSeq = firstRoleSequence(vc);
    const ranges = child(vc, "ValueRanges") as Record<string, unknown> | undefined;
    const values: string[] = [];
    if (ranges) {
      for (const range of asArray(ranges["ValueRange"])) {
        const minVal = attr(range, "MinValue");
        const maxVal = attr(range, "MaxValue");
        if (minVal !== undefined && minVal === maxVal) {
          values.push(minVal);
        }
      }
    }
    result.push({
      type: "value_constraint",
      id: attr(vc, "id") ?? "",
      name: attr(vc, "Name") ?? "",
      roleRefs: roleSeq ? parseRoleSequenceRefs(roleSeq) : [],
      values,
    });
  }

  // SubsetConstraint
  for (const sc of asArray(constraints["SubsetConstraint"])) {
    const roleSequences = parseMultipleRoleSequences(sc);
    result.push({
      type: "subset",
      id: attr(sc, "id") ?? "",
      name: attr(sc, "Name") ?? "",
      subsetRoleRefs: roleSequences[0] ?? [],
      supersetRoleRefs: roleSequences[1] ?? [],
    });
  }

  // ExclusionConstraint
  for (const ec of asArray(constraints["ExclusionConstraint"])) {
    result.push({
      type: "exclusion",
      id: attr(ec, "id") ?? "",
      name: attr(ec, "Name") ?? "",
      roleSequences: parseMultipleRoleSequences(ec),
    });
  }

  // EqualityConstraint
  for (const eq of asArray(constraints["EqualityConstraint"])) {
    result.push({
      type: "equality",
      id: attr(eq, "id") ?? "",
      name: attr(eq, "Name") ?? "",
      roleSequences: parseMultipleRoleSequences(eq),
    });
  }

  // RingConstraint
  for (const rc of asArray(constraints["RingConstraint"])) {
    const roleSeq = firstRoleSequence(rc);
    const ringTypeStr = attr(rc, "Type") ?? attr(rc, "RingType") ?? "";
    result.push({
      type: "ring",
      id: attr(rc, "id") ?? "",
      name: attr(rc, "Name") ?? "",
      ringType: normalizeRingType(ringTypeStr),
      roleRefs: roleSeq ? parseRoleSequenceRefs(roleSeq) : [],
    });
  }

  return result;
}

function parseMultipleRoleSequences(
  el: Record<string, unknown>,
): string[][] {
  // NORMA wraps multi-role-sequence constraints in <RoleSequences>
  // (e.g. SubsetConstraint, ExclusionConstraint, EqualityConstraint).
  // Simpler constraints (Uniqueness, Mandatory) use <RoleSequence> directly.
  const wrapper = child(el, "RoleSequences") as Record<string, unknown> | undefined;
  const seqParent = wrapper ?? el;

  const sequences: string[][] = [];
  for (const seq of asArray(seqParent["RoleSequence"])) {
    sequences.push(asArray(seq["Role"]).map((r) => attr(r, "ref") ?? ""));
  }
  return sequences;
}

// ---- Data Type Parsing ----

/**
 * Known NORMA data type tag suffixes. The parser scans the DataTypes
 * section for any child element whose tag ends with "DataType" and
 * derives a kind string from the tag name.
 */
const knownDataTypeTags = [
  "FixedLengthTextDataType",
  "VariableLengthTextDataType",
  "LargeLengthTextDataType",
  "AutoCounterNumericDataType",
  "SignedIntegerNumericDataType",
  "UnsignedIntegerNumericDataType",
  "FloatingPointNumericDataType",
  "DecimalNumericDataType",
  "MoneyNumericDataType",
  "DateTemporalDataType",
  "DateAndTimeTemporalDataType",
  "TimeTemporalDataType",
  "TrueOrFalseLogicalDataType",
  "YesOrNoLogicalDataType",
  "RowIdOtherDataType",
  "OleObjectRawDataDataType",
  "PictureRawDataDataType",
  "AutoTimestampTemporalDataType",
  "UnsignedTinyIntegerNumericDataType",
  "UnsignedSmallIntegerNumericDataType",
  "SignedSmallIntegerNumericDataType",
  "SignedLargeIntegerNumericDataType",
  "UnsignedLargeIntegerNumericDataType",
  "DoublePrecisionFloatingPointNumericDataType",
  "SinglePrecisionFloatingPointNumericDataType",
];

/**
 * Derive a normalized kind string from a NORMA DataType tag name.
 * "VariableLengthTextDataType" -> "variable_length_text"
 */
function dataTypeTagToKind(tag: string): string {
  return tag
    .replace(/DataType$/, "")
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/_+/g, "_");
}

function parseDataTypes(
  section: Record<string, unknown> | undefined,
): NormaDataType[] {
  if (!section) return [];
  const result: NormaDataType[] = [];

  // Iterate over known data type tags. Each tag may appear once
  // (not in arrayTags) as a single element or not at all.
  for (const tag of knownDataTypeTags) {
    const el = section[tag];
    if (el == null) continue;
    // Could be a single object or array if multiple of same type.
    const elements = Array.isArray(el)
      ? (el as Record<string, unknown>[])
      : [el as Record<string, unknown>];
    for (const dt of elements) {
      const id = attr(dt, "id");
      if (id) {
        result.push({ id, kind: dataTypeTagToKind(tag) });
      }
    }
  }

  return result;
}

function normalizeRingType(raw: string): NormaRingType {
  const lower = raw.toLowerCase().replace(/[_\s]/g, "");
  const map: Record<string, NormaRingType> = {
    irreflexive: "irreflexive",
    asymmetric: "asymmetric",
    antisymmetric: "antisymmetric",
    intransitive: "intransitive",
    acyclic: "acyclic",
    symmetric: "symmetric",
    transitive: "transitive",
    purelyreflexive: "purely_reflexive",
  };
  return map[lower] ?? "irreflexive";
}
