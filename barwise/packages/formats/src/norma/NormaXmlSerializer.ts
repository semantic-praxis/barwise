/**
 * Serializes a NormaDocument (intermediate representation) into NORMA .orm
 * XML text. This is the inverse of NormaXmlParser: where the parser turns
 * XML into a NormaDocument via fast-xml-parser's XMLParser, the serializer
 * turns a NormaDocument back into XML via XMLBuilder.
 *
 * Pure: same document, same XML. No I/O, no clock, no randomness.
 *
 * The output is semantic-only: it carries no ORMDiagram shapes or positions,
 * so a model with no layout produces a complete .orm with an empty diagram
 * surface (diagram geometry is a later workstream).
 *
 * We do not embed or redistribute any NORMA source code or XSD schemas.
 * This format is derived from publicly documented information.
 */
import { XMLBuilder } from "fast-xml-parser";
import type {
  NormaConstraint,
  NormaDocument,
  NormaEntityType,
  NormaFactType,
  NormaObjectifiedType,
  NormaReadingOrder,
  NormaRingType,
  NormaRole,
  NormaSubtypeFact,
  NormaValueConstraintInline,
  NormaValueType,
} from "./NormaXmlTypes.js";

const ATTR = "@_";

/** The ORMCore namespace URI used by NORMA .orm files. */
const ORM_NS = "http://schemas.neumont.edu/ORM/2006-04/ORMCore";
const ORM_ROOT_NS = "http://schemas.neumont.edu/ORM/2006-04/ORMRoot";

type XmlNode = Record<string, unknown>;

/** Serialize a NormaDocument into a NORMA .orm XML string. */
export function serializeNormaDocument(doc: NormaDocument): string {
  const ormModel: XmlNode = {
    [`${ATTR}id`]: doc.modelId,
    [`${ATTR}Name`]: doc.modelName,
    "orm:Objects": buildObjects(doc),
    "orm:Facts": buildFacts(doc),
    "orm:Constraints": buildConstraints(doc),
  };

  const dataTypes = buildDataTypes(doc);
  if (dataTypes) {
    ormModel["orm:DataTypes"] = dataTypes;
  }

  const root: XmlNode = {
    "ormRoot:ORM2": {
      [`${ATTR}xmlns:orm`]: ORM_NS,
      [`${ATTR}xmlns:ormRoot`]: ORM_ROOT_NS,
      "orm:ORMModel": ormModel,
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    format: true,
    indentBy: "  ",
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
  });

  const body = builder.build(root) as string;
  return `<?xml version="1.0" encoding="utf-8"?>\n${body}`;
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

function buildObjects(doc: NormaDocument): XmlNode {
  const objects: XmlNode = {};
  if (doc.entityTypes.length > 0) {
    objects["orm:EntityType"] = doc.entityTypes.map(buildEntityType);
  }
  if (doc.valueTypes.length > 0) {
    objects["orm:ValueType"] = doc.valueTypes.map(buildValueType);
  }
  if (doc.objectifiedTypes.length > 0) {
    objects["orm:ObjectifiedType"] = doc.objectifiedTypes.map(buildObjectifiedType);
  }
  return objects;
}

function buildEntityType(et: NormaEntityType): XmlNode {
  const node: XmlNode = {
    [`${ATTR}id`]: et.id,
    [`${ATTR}Name`]: et.name,
  };
  if (et.referenceMode !== undefined) {
    node[`${ATTR}_ReferenceMode`] = et.referenceMode;
  }
  if (et.independent) {
    node[`${ATTR}IsIndependent`] = "true";
  }
  addPlayedRoles(node, et.playedRoleRefs);
  addDefinition(node, et.definition);
  if (et.preferredIdentifier) {
    node["orm:PreferredIdentifier"] = { [`${ATTR}ref`]: et.preferredIdentifier };
  }
  return node;
}

function buildObjectifiedType(ot: NormaObjectifiedType): XmlNode {
  const node: XmlNode = {
    [`${ATTR}id`]: ot.id,
    [`${ATTR}Name`]: ot.name,
  };
  if (ot.referenceMode !== undefined) {
    node[`${ATTR}_ReferenceMode`] = ot.referenceMode;
  }
  node["orm:NestedPredicate"] = { [`${ATTR}ref`]: ot.nestedFactTypeRef };
  addPlayedRoles(node, ot.playedRoleRefs);
  addDefinition(node, ot.definition);
  if (ot.preferredIdentifier) {
    node["orm:PreferredIdentifier"] = { [`${ATTR}ref`]: ot.preferredIdentifier };
  }
  return node;
}

function buildValueType(vt: NormaValueType): XmlNode {
  const node: XmlNode = {
    [`${ATTR}id`]: vt.id,
    [`${ATTR}Name`]: vt.name,
  };
  if (vt.independent) {
    node[`${ATTR}IsIndependent`] = "true";
  }
  addPlayedRoles(node, vt.playedRoleRefs);
  addDefinition(node, vt.definition);
  if (vt.dataTypeRef) {
    const cdt: XmlNode = {
      [`${ATTR}id`]: `${vt.id}_cdt`,
      [`${ATTR}ref`]: vt.dataTypeRef,
    };
    if (vt.dataTypeScale !== undefined) cdt[`${ATTR}Scale`] = vt.dataTypeScale;
    if (vt.dataTypeLength !== undefined) cdt[`${ATTR}Length`] = vt.dataTypeLength;
    node["orm:ConceptualDataType"] = cdt;
  }
  if (vt.valueConstraint) {
    node["orm:ValueRestriction"] = buildInlineValueRestriction(vt.id, vt.valueConstraint);
  }
  return node;
}

function buildInlineValueRestriction(
  ownerId: string,
  vc: NormaValueConstraintInline,
): XmlNode {
  return {
    "orm:ValueConstraint": {
      [`${ATTR}id`]: `${ownerId}_vc`,
      "orm:ValueRanges": buildValueRanges(vc),
    },
  };
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function buildFacts(doc: NormaDocument): XmlNode {
  const facts: XmlNode = {};
  // Map each constraint id to the element tag the parser recognizes inside
  // InternalConstraints, so each ref is emitted under the matching tag.
  const constraintTagById = new Map<string, string>();
  for (const c of doc.constraints) {
    constraintTagById.set(c.id, constraintRefTag(c));
  }
  if (doc.factTypes.length > 0) {
    facts["orm:Fact"] = doc.factTypes.map((ft) => buildFact(ft, constraintTagById));
  }
  if (doc.subtypeFacts.length > 0) {
    facts["orm:SubtypeFact"] = doc.subtypeFacts.map(buildSubtypeFact);
  }
  return facts;
}

function buildFact(ft: NormaFactType, constraintTagById: Map<string, string>): XmlNode {
  const node: XmlNode = {
    [`${ATTR}id`]: ft.id,
    [`${ATTR}_Name`]: ft.name,
    "orm:FactRoles": { "orm:Role": ft.roles.map(buildFactRole) },
    "orm:ReadingOrders": { "orm:ReadingOrder": ft.readingOrders.map(buildReadingOrder) },
  };
  addDefinition(node, ft.definition);
  if (ft.internalConstraintRefs.length > 0) {
    node["orm:InternalConstraints"] = buildInternalConstraintRefs(
      ft.internalConstraintRefs,
      constraintTagById,
    );
  }
  return node;
}

/** The InternalConstraints child tag the parser recognizes for a constraint. */
function constraintRefTag(c: NormaConstraint): string {
  switch (c.type) {
    case "uniqueness":
      return "orm:UniquenessConstraint";
    case "mandatory":
      return "orm:MandatoryConstraint";
    case "frequency":
      return "orm:FrequencyConstraint";
    case "value_constraint":
      return "orm:ValueConstraint";
    case "subset":
      return "orm:SubsetConstraint";
    case "exclusion":
      return "orm:ExclusionConstraint";
    case "equality":
      return "orm:EqualityConstraint";
    case "ring":
      return "orm:RingConstraint";
  }
}

function buildFactRole(role: NormaRole): XmlNode {
  return {
    [`${ATTR}id`]: role.id,
    [`${ATTR}Name`]: role.name,
    [`${ATTR}_IsMandatory`]: role.isMandatory ? "true" : "false",
    "orm:RolePlayer": { [`${ATTR}ref`]: role.playerRef },
  };
}

function buildReadingOrder(ro: NormaReadingOrder): XmlNode {
  return {
    [`${ATTR}id`]: ro.id,
    "orm:Readings": {
      "orm:Reading": ro.readings.map((r) => ({
        [`${ATTR}id`]: r.id,
        "orm:Data": r.data,
      })),
    },
    "orm:RoleSequence": roleSequence(ro.roleSequence),
  };
}

/**
 * Build a fact's InternalConstraints. Each ref is emitted under the element
 * tag the parser recognizes for that constraint kind (UniquenessConstraint,
 * MandatoryConstraint, ...), grouped by tag so multiple refs of one kind
 * become an array of <Tag ref>.
 */
function buildInternalConstraintRefs(
  refs: readonly string[],
  constraintTagById: Map<string, string>,
): XmlNode {
  const out: XmlNode = {};
  for (const ref of refs) {
    const tag = constraintTagById.get(ref) ?? "orm:UniquenessConstraint";
    const refNode = { [`${ATTR}ref`]: ref };
    const existing = out[tag];
    if (existing === undefined) {
      out[tag] = refNode;
    } else if (Array.isArray(existing)) {
      existing.push(refNode);
    } else {
      out[tag] = [existing, refNode];
    }
  }
  return out;
}

function buildSubtypeFact(sf: NormaSubtypeFact): XmlNode {
  const node: XmlNode = {
    [`${ATTR}id`]: sf.id,
    "orm:FactRoles": {
      "orm:SubtypeMetaRole": {
        [`${ATTR}id`]: sf.subtypeRoleId,
        "orm:RolePlayer": { [`${ATTR}ref`]: sf.subtypePlayerRef },
      },
      "orm:SupertypeMetaRole": {
        [`${ATTR}id`]: sf.supertypeRoleId,
        "orm:RolePlayer": { [`${ATTR}ref`]: sf.supertypePlayerRef },
      },
    },
  };
  if (!sf.providesIdentification) {
    node[`${ATTR}PreferredIdentificationPath`] = "false";
  }
  return node;
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

function buildConstraints(doc: NormaDocument): XmlNode {
  const out: XmlNode = {};
  const uniqueness: XmlNode[] = [];
  const mandatory: XmlNode[] = [];
  const frequency: XmlNode[] = [];
  const value: XmlNode[] = [];
  const subset: XmlNode[] = [];
  const exclusion: XmlNode[] = [];
  const equality: XmlNode[] = [];
  const ring: XmlNode[] = [];

  for (const c of doc.constraints) {
    switch (c.type) {
      case "uniqueness":
        uniqueness.push(buildUniqueness(c));
        break;
      case "mandatory":
        mandatory.push(buildMandatory(c));
        break;
      case "frequency":
        frequency.push(buildFrequency(c));
        break;
      case "value_constraint":
        value.push(buildValueConstraint(c));
        break;
      case "subset":
        subset.push(buildSubset(c));
        break;
      case "exclusion":
        exclusion.push(buildExclusion(c));
        break;
      case "equality":
        equality.push(buildEquality(c));
        break;
      case "ring":
        ring.push(buildRing(c));
        break;
    }
  }

  if (uniqueness.length > 0) out["orm:UniquenessConstraint"] = uniqueness;
  if (mandatory.length > 0) out["orm:MandatoryConstraint"] = mandatory;
  if (frequency.length > 0) out["orm:FrequencyConstraint"] = frequency;
  if (value.length > 0) out["orm:ValueConstraint"] = value;
  if (subset.length > 0) out["orm:SubsetConstraint"] = subset;
  if (exclusion.length > 0) out["orm:ExclusionConstraint"] = exclusion;
  if (equality.length > 0) out["orm:EqualityConstraint"] = equality;
  if (ring.length > 0) out["orm:RingConstraint"] = ring;
  return out;
}

function buildUniqueness(c: Extract<NormaConstraint, { type: "uniqueness"; }>): XmlNode {
  const node: XmlNode = {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    [`${ATTR}IsInternal`]: c.isInternal ? "true" : "false",
    [`${ATTR}IsPreferred`]: c.isPreferred ? "true" : "false",
    "orm:RoleSequence": roleSequence(c.roleRefs),
  };
  return node;
}

function buildMandatory(c: Extract<NormaConstraint, { type: "mandatory"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    [`${ATTR}IsSimple`]: c.isSimple ? "true" : "false",
    [`${ATTR}IsImplied`]: c.isImplied ? "true" : "false",
    "orm:RoleSequence": roleSequence(c.roleRefs),
  };
}

function buildFrequency(c: Extract<NormaConstraint, { type: "frequency"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    [`${ATTR}MinFrequency`]: c.min,
    [`${ATTR}MaxFrequency`]: c.max === "unbounded" ? "" : c.max,
    "orm:RoleSequence": roleSequence(c.roleRefs),
  };
}

function buildValueConstraint(c: Extract<NormaConstraint, { type: "value_constraint"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    "orm:RoleSequence": roleSequence(c.roleRefs),
    "orm:ValueRanges": buildValueRanges({ values: c.values, ranges: c.ranges }),
  };
}

function buildSubset(c: Extract<NormaConstraint, { type: "subset"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    "orm:RoleSequences": {
      "orm:RoleSequence": [roleSequence(c.subsetRoleRefs), roleSequence(c.supersetRoleRefs)],
    },
  };
}

function buildExclusion(c: Extract<NormaConstraint, { type: "exclusion"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    "orm:RoleSequences": {
      "orm:RoleSequence": c.roleSequences.map((seq) => roleSequence(seq)),
    },
  };
}

function buildEquality(c: Extract<NormaConstraint, { type: "equality"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    "orm:RoleSequences": {
      "orm:RoleSequence": c.roleSequences.map((seq) => roleSequence(seq)),
    },
  };
}

function buildRing(c: Extract<NormaConstraint, { type: "ring"; }>): XmlNode {
  return {
    [`${ATTR}id`]: c.id,
    [`${ATTR}Name`]: c.name,
    [`${ATTR}Type`]: ringTypeToNorma(c.ringType),
    "orm:RoleSequence": roleSequence(c.roleRefs),
  };
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

function buildDataTypes(doc: NormaDocument): XmlNode | undefined {
  if (doc.dataTypes.length === 0) return undefined;
  const out: XmlNode = {};
  for (const dt of doc.dataTypes) {
    const tag = `orm:${kindToTag(dt.kind)}`;
    const node = { [`${ATTR}id`]: dt.id };
    const existing = out[tag];
    if (existing === undefined) {
      out[tag] = node;
    } else if (Array.isArray(existing)) {
      existing.push(node);
    } else {
      out[tag] = [existing, node];
    }
  }
  return out;
}

/** "variable_length_text" -> "VariableLengthTextDataType". */
function kindToTag(kind: string): string {
  const pascal = kind
    .split("_")
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join("");
  return `${pascal}DataType`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function addPlayedRoles(node: XmlNode, refs: readonly string[]): void {
  if (refs.length === 0) return;
  node["orm:PlayedRoles"] = {
    "orm:Role": refs.map((ref) => ({ [`${ATTR}ref`]: ref })),
  };
}

function addDefinition(node: XmlNode, definition: string | undefined): void {
  if (!definition) return;
  node["orm:Definitions"] = {
    "orm:Definition": { "orm:DefinitionText": definition },
  };
}

/** Build a <RoleSequence> with one <Role ref> per role id. */
function roleSequence(refs: readonly string[]): XmlNode {
  return { "orm:Role": refs.map((ref) => ({ [`${ATTR}ref`]: ref })) };
}

/**
 * Build a <ValueRanges> from enumerated values and ranges. Enumerated values
 * become single-point ranges (MinValue === MaxValue, both inclusive), mirroring
 * how the parser recovers them.
 */
function buildValueRanges(
  vc: {
    values: readonly string[];
    ranges?: readonly {
      min?: string;
      max?: string;
      minInclusive?: boolean;
      maxInclusive?: boolean;
    }[];
  },
): XmlNode {
  const ranges: XmlNode[] = [];
  for (const v of vc.values) {
    ranges.push({ [`${ATTR}MinValue`]: v, [`${ATTR}MaxValue`]: v });
  }
  for (const r of vc.ranges ?? []) {
    const node: XmlNode = {};
    if (r.min !== undefined) node[`${ATTR}MinValue`] = r.min;
    if (r.max !== undefined) node[`${ATTR}MaxValue`] = r.max;
    if (r.minInclusive === false) node[`${ATTR}MinInclusion`] = "Open";
    if (r.maxInclusive === false) node[`${ATTR}MaxInclusion`] = "Open";
    ranges.push(node);
  }
  return { "orm:ValueRange": ranges };
}

function ringTypeToNorma(ringType: NormaRingType): string {
  // The parser normalizes by lowercasing and stripping separators; emit a
  // canonical PascalCase token that survives that normalization.
  switch (ringType) {
    case "purely_reflexive":
      return "PurelyReflexive";
    default:
      return ringType.charAt(0).toUpperCase() + ringType.slice(1);
  }
}
