/**
 * `OrmModel` to an Ossie ontology document, plus every loss the document
 * could not carry (`docs/specs/ossie-ontology-format.spec.md`, WS2).
 *
 * The rules are the inverse of `mapOssieToOrm`, and each is held to what
 * that importer reads back: a construct is written only in a shape it
 * would read as the same thing, and anything else is a loss -- a line in
 * the document's comment block, and, for a constraint with roles, a
 * `constraintSpecs` entry. Deterministic: the same model writes the same
 * document.
 */
import {
  type ConceptualDataTypeName,
  type Constraint,
  type ConstraintInView,
  type ConstraintSpec,
  type FactType,
  isOverSubtypes,
  type ObjectType,
  type OrmModel,
  roleIdsOf,
} from "@barwise/core";
import { ConstraintVerbalizer } from "@barwise/core/verbalization";
import { buildConstraintSpec } from "../constraintSpec.js";
import { snakeCase } from "../naming.js";
import {
  DERIVATION_ITEM_SEPARATOR,
  DERIVED_BY_NOTE_PREFIX,
  REQUIRES_NOTE_PREFIX,
} from "./mapOssieToOrm.js";
import {
  isOssieBuiltinValueType,
  OSSIE_ANY,
  OSSIE_BUILTIN_VALUE_TYPES,
  OSSIE_VERSION,
  type OssieBuiltinValueType,
  type OssieConcept,
  type OssieDocument,
  type OssieRelationship,
} from "./OssieTypes.js";
import {
  IDENT_PATTERN,
  readMandatoryShape,
  readValueShapes,
  writeBounds,
  writeEnumeration,
} from "./requiresShapes.js";

export interface OssieWriteResult {
  readonly document: OssieDocument;
  /** One line per construct not written, for the document's comment block. */
  readonly losses: readonly string[];
  readonly constraintSpecs: readonly ConstraintSpec[];
}

/** The built-in each barwise data type is written as; the second field marks a loss. */
const DATA_TYPES: Record<ConceptualDataTypeName, readonly [OssieBuiltinValueType, boolean]> = {
  text: ["String", false],
  integer: ["Integer", false],
  decimal: ["Decimal", false],
  float: ["Float", false],
  boolean: ["Boolean", false],
  date: ["Date", false],
  datetime: ["DateTime", false],
  money: ["Decimal", true],
  timestamp: ["DateTime", true],
  auto_counter: ["Integer", true],
  time: ["String", true],
  binary: ["String", true],
  uuid: ["String", true],
  other: ["String", true],
};

/** One fact type as it is written: its role order and where it is declared. */
interface Written {
  readonly ft: FactType;
  /** Barwise role indexes in written order; position 0 is the declaring concept. */
  readonly order: readonly number[];
  readonly name: string;
  /** Role keys in written order: the concept for position 0, then name or player. */
  readonly keys: readonly string[];
  /** Ossie role names, in written order from position 1; undefined where not named. */
  readonly roleNames: readonly (string | undefined)[];
}

export function writeOssie(model: OrmModel): OssieWriteResult {
  const losses: string[] = [];
  const specs: ConstraintSpec[] = [];
  const verbalizer = new ConstraintVerbalizer();
  const lose = (element: string, what: string): void => {
    losses.push(`${element}: ${what}`.replace(/\s+/g, " ").trim());
  };
  const loseConstraint = (inView: ConstraintInView, element: string, what: string): void => {
    lose(element, what);
    if (roleIdsOf(inView[0]).length > 0 && !isOverSubtypes(inView[0])) {
      specs.push(buildConstraintSpec(inView, model, verbalizer));
    }
  };

  const names = conceptNames(model, lose);
  const nameOf = (id: string): string => names.written.get(id)!;
  const isBuiltin = (id: string): boolean => names.builtins.has(id);

  // Which internal constraints are written, by id; every other is a loss.
  const covered = new Set<string>();
  const written: Written[] = [];
  const usedNames = new Map<string, Set<string>>();
  for (const ft of model.factTypes) {
    const order = roleOrder(ft, model, isBuiltin);
    if (!order) {
      lose(
        `fact type ${ft.name}`,
        "every role is played by a built-in, so no concept can declare it",
      );
      continue;
    }
    const declaring = ft.roles[order[0]!]!.playerId;
    const declaringName = nameOf(declaring);
    const relName = relationshipName(
      ft,
      model.getObjectType(declaring)!.name,
      usedNames,
      declaringName,
    );
    if (relName.renamed) {
      lose(`fact type ${ft.name}`, `written as relationship ${declaringName}.${relName.name}`);
    }
    const { keys, roleNames } = roleKeys(ft, order, declaringName, model, nameOf);
    written.push({ ft, order, name: relName.name, keys, roleNames });
  }

  // identify_by, decided before relationships are written so a covered
  // far-role uniqueness is not reported.
  const identifyBy = new Map<string, string[]>();
  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    const pid = model.preferredIdentifierOf(ot.id);
    if (pid !== undefined) {
      const w = written.find((x) => x.ft.internalConstraints.some((c) => c.id === pid));
      const c = w?.ft.internalConstraints.find((k) => k.id === pid);
      if (w && c && isSingleIdentifier(w, c, ot.id)) {
        identifyBy.set(ot.id, [w.name]);
        covered.add(pid);
      } else {
        lose(ot.name, "its preferred identifier is not one Ossie's identify_by can name");
      }
      continue;
    }
    for (const ext of model.constraints) {
      if (ext.type !== "external_uniqueness" || covered.has(ext.id!)) continue;
      const rels = compositeIdentifier(ext.roleIds, ot.id, written);
      if (rels) {
        identifyBy.set(ot.id, rels);
        covered.add(ext.id!);
        break;
      }
    }
  }

  // Relationships, grouped under their declaring concepts.
  const relationships = new Map<string, OssieRelationship[]>();
  const mandatory = new Map<string, string[]>();
  for (const w of written) {
    const declaring = w.ft.roles[w.order[0]!]!.playerId;
    const rel = writeRelationship(w, nameOf, covered, lose, loseConstraint, (relName) => {
      if (model.getObjectType(declaring)?.kind === "entity") {
        mandatory.set(declaring, [...(mandatory.get(declaring) ?? []), relName]);
        return true;
      }
      return false;
    });
    relationships.set(declaring, [...(relationships.get(declaring) ?? []), rel]);
  }

  // External constraints not written as an identifier.
  for (const ext of model.constraints) {
    if (covered.has(ext.id!)) continue;
    loseConstraint(
      [ext, undefined],
      `constraint ${ext.id}`,
      `${ext.type} is not expressible in Ossie`,
    );
  }

  const supertypes = subtypeLinks(model, nameOf, identifyBy, lose);

  const ontology: OssieConcept[] = [];
  for (const ot of model.objectTypes) {
    if (isBuiltin(ot.id)) continue;
    ontology.push(writeConcept(ot, {
      model,
      name: nameOf(ot.id),
      relationships: relationships.get(ot.id) ?? [],
      identifyBy: identifyBy.get(ot.id),
      mandatory: mandatory.get(ot.id) ?? [],
      supertypes: supertypes.get(ot.id),
      lose,
    }));
  }

  for (const p of model.populations) lose(`population ${p.id}`, "Ossie has no populations");
  for (const o of model.objectifiedFactTypes) {
    lose(`objectification ${o.id}`, "Ossie has no objectification");
  }
  for (const d of model.definitions) lose(`definition ${d.term}`, "Ossie has no glossary");
  if (model.domainContext) lose("model", `domain context ${model.domainContext} not written`);

  if (ontology.length === 0) {
    // The schema requires one concept, and the importer refuses none; a
    // document the format cannot hold is refused, not written invalid.
    throw new Error(
      `Model "${model.name}" has no concept to declare; an Ossie ontology needs at least one.`,
    );
  }

  const { description, requires } = splitNote(model.note);
  for (const line of requires.filter((r) => r.trim() === "")) {
    lose("model", `empty note line not written: ${line}`);
  }
  const document: OssieDocument = {
    version: OSSIE_VERSION,
    name: model.name,
    ...(description ? { description } : {}),
    ...(requires.filter((r) => r.trim() !== "").length > 0
      ? { requires: requires.filter((r) => r.trim() !== "") }
      : {}),
    ontology,
  };
  return { document, losses, constraintSpecs: specs };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

interface ConceptNames {
  readonly written: ReadonlyMap<string, string>;
  /** Value types written as the built-in they are named for. */
  readonly builtins: ReadonlySet<string>;
}

/**
 * The name each object type is written under. A value type named like a
 * built-in, with that built-in's data type and nothing else, is the
 * built-in; any other name the importer could not read back -- one holding
 * `{`, `}` or `:`, a built-in's or `Any`, or one already taken -- is renamed.
 */
function conceptNames(model: OrmModel, lose: (e: string, w: string) => void): ConceptNames {
  const written = new Map<string, string>();
  const builtins = new Set<string>();
  const taken = new Set<string>();
  for (const ot of model.objectTypes) {
    if (isPlainBuiltin(ot)) {
      written.set(ot.id, ot.name);
      builtins.add(ot.id);
    }
  }
  for (const ot of model.objectTypes) {
    if (builtins.has(ot.id)) continue;
    let name = ot.name.replace(/[{}:]/g, "_");
    while (isOssieBuiltinValueType(name) || name === OSSIE_ANY || taken.has(name)) name += "_";
    taken.add(name);
    written.set(ot.id, name);
    if (name !== ot.name) lose(ot.name, `written as ${name}, a name Ossie can read back`);
  }
  return { written, builtins };
}

function isPlainBuiltin(ot: ObjectType): boolean {
  return ot.kind === "value" && isOssieBuiltinValueType(ot.name)
    && ot.dataType?.name === OSSIE_BUILTIN_VALUE_TYPES[ot.name]
    && ot.dataType.length === undefined && ot.dataType.scale === undefined
    && !ot.definition && !ot.valueConstraint && !ot.note && ot.defaultValue === undefined
    && ot.aliases.length === 0 && !ot.independent && !ot.sourceContext && !ot.cardinality;
}

/** Letters, digits and `_` only, not starting with a digit: what `Entity.rel` parses. */
function identifier(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "_";
}

function relationshipName(
  ft: FactType,
  declaringOriginal: string,
  used: Map<string, Set<string>>,
  declaringName: string,
): { name: string; renamed: boolean; } {
  const prefix = `${declaringOriginal}.`;
  const own = ft.name.startsWith(prefix) ? ft.name.slice(prefix.length) : undefined;
  let base = own !== undefined && IDENT_PATTERN.test(own)
    ? own
    : identifier(
      (own ?? ft.name).split(/[^A-Za-z0-9]+/).filter(Boolean).join("_").toLowerCase(),
    );
  const seen = used.get(declaringName) ?? new Set<string>();
  let name = base;
  for (let n = 2; seen.has(name); n++) name = `${base}_${n}`;
  seen.add(name);
  used.set(declaringName, seen);
  base = name;
  // A name the importer wrote (`Concept.rel`) that had to change is a loss;
  // a native barwise name has no Ossie spelling to keep, and is not one.
  return { name: base, renamed: own !== undefined && own !== base };
}

/**
 * Role keys in written order. The first role is the declaring concept and
 * is never named. A later role is named where Ossie needs it -- its player
 * plays another role too, or its barwise name differs from its player's --
 * and never by a key another role holds.
 */
function roleKeys(
  ft: FactType,
  order: readonly number[],
  declaringName: string,
  model: OrmModel,
  nameOf: (id: string) => string,
): { keys: string[]; roleNames: (string | undefined)[]; } {
  const players = order.map((i) => nameOf(ft.roles[i]!.playerId));
  const keys = [declaringName];
  const roleNames: (string | undefined)[] = [];
  for (let p = 1; p < order.length; p++) {
    const role = ft.roles[order[p]!]!;
    const player = players[p]!;
    const original = model.getObjectType(role.playerId)!.name;
    const shared = players.filter((x) => x === player).length > 1;
    const wanted = role.name !== original ? identifier(role.name) : undefined;
    if (!shared && wanted === undefined && !keys.includes(player)) {
      keys.push(player);
      roleNames.push(undefined);
      continue;
    }
    let name = wanted && !keys.includes(wanted) && wanted !== player ? wanted : `${player}_${p}`;
    while (keys.includes(name)) name += "_";
    keys.push(name);
    roleNames.push(name);
  }
  return { keys, roleNames };
}

// ---------------------------------------------------------------------------
// Role order (the spec's precedence, first rule that applies)
// ---------------------------------------------------------------------------

function roleOrder(
  ft: FactType,
  model: OrmModel,
  isBuiltin: (id: string) => boolean,
): number[] | undefined {
  const n = ft.roles.length;
  const all = ft.roles.map((_, i) => i);
  const first = (i: number): number[] => [i, ...all.filter((j) => j !== i)];
  const singles = ft.internalConstraints
    .filter((c) => c.type === "internal_uniqueness" && c.roleIds.length === 1)
    .map((c) =>
      ft.roles.findIndex((r) => r.id === (c as { roleIds: readonly string[]; }).roleIds[0])
    );
  let order = all;
  let lastFixed = false;

  // `X.rel`: X is the longest player name the fact type name begins with,
  // followed by a dot, so a concept named with a dot is found whole.
  let xRole = -1;
  let xLength = -1;
  ft.roles.forEach((r, i) => {
    const player = model.getObjectType(r.playerId)?.name ?? "";
    if (ft.name.startsWith(`${player}.`) && player.length > xLength) {
      xRole = i;
      xLength = player.length;
    }
  });
  if (xRole >= 0) {
    order = first(xRole);
  } else if (n === 2 && identifierRole(ft, model) !== undefined) {
    order = first(1 - identifierRole(ft, model)!);
  } else if (n === 2 && new Set(singles).size === 1) {
    order = first(singles[0]!);
  } else if (n >= 3) {
    const wide = ft.internalConstraints.find((c) =>
      c.type === "internal_uniqueness" && c.roleIds.length === n - 1
    );
    if (wide && wide.type === "internal_uniqueness") {
      const uncovered = ft.roles.findIndex((r) => !wide.roleIds.includes(r.id));
      order = [...all.filter((j) => j !== uncovered), uncovered];
      lastFixed = true;
    }
  }

  if (isBuiltin(ft.roles[order[0]!]!.playerId)) {
    const movable = lastFixed ? order.slice(0, -1) : order;
    const j = movable.find((i) => !isBuiltin(ft.roles[i]!.playerId));
    if (j === undefined) return undefined;
    order = [j, ...order.filter((i) => i !== j)];
  }
  return order;
}

/** The role index of a binary's far role when it holds an entity's preferred identifier. */
function identifierRole(ft: FactType, model: OrmModel): number | undefined {
  for (const c of ft.internalConstraints) {
    if (c.type !== "internal_uniqueness" || c.roleIds.length !== 1) continue;
    const far = ft.roles.findIndex((r) => r.id === c.roleIds[0]);
    const near = ft.roles[1 - far];
    if (near && model.preferredIdentifierOf(near.playerId) === c.id) return far;
  }
  return undefined;
}

function isSingleIdentifier(w: Written, c: Constraint, entityId: string): boolean {
  if (c.type !== "internal_uniqueness" || c.roleIds.length !== 1 || w.order.length !== 2) {
    return false;
  }
  const [near, far] = w.order.map((i) => w.ft.roles[i]!);
  return near!.playerId === entityId && far!.id === c.roleIds[0] && far!.playerId !== entityId;
}

/** The relationships of an external uniqueness in the importer's composite shape, or undefined. */
function compositeIdentifier(
  roleIds: readonly string[],
  entityId: string,
  written: readonly Written[],
): string[] | undefined {
  const rels: string[] = [];
  for (const roleId of roleIds) {
    const w = written.find((x) => x.order.length === 2 && x.ft.roles[x.order[1]!]!.id === roleId);
    if (!w) return undefined;
    const [near, far] = w.order.map((i) => w.ft.roles[i]!);
    if (near!.playerId !== entityId || far!.playerId === entityId || rels.includes(w.name)) {
      return undefined;
    }
    rels.push(w.name);
  }
  return rels.length > 0 ? rels : undefined;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

function writeRelationship(
  w: Written,
  nameOf: (id: string) => string,
  covered: Set<string>,
  lose: (e: string, what: string) => void,
  loseConstraint: (inView: ConstraintInView, e: string, what: string) => void,
  addMandatory: (relName: string) => boolean,
): OssieRelationship {
  const { ft, order } = w;
  const element = `fact type ${ft.name}`;
  const position = (roleId: string): number =>
    order.indexOf(ft.roles.findIndex((r) => r.id === roleId));
  const n = order.length;

  let multiplicity: OssieRelationship["multiplicity"];
  const ucs = ft.internalConstraints.filter((c) => c.type === "internal_uniqueness");
  const on = (positions: readonly number[]) =>
    ucs.find((c) =>
      c.type === "internal_uniqueness" && c.roleIds.length === positions.length
      && c.roleIds.every((r) => positions.includes(position(r)))
    );
  const one0 = n === 2 ? on([0]) : undefined;
  const one1 = n === 2 ? on([1]) : undefined;
  if (one0 && one1) {
    multiplicity = "OneToOne";
    covered.add(one0.id!).add(one1.id!);
  } else if (n >= 2) {
    const head = on(order.slice(0, -1).map((_, p) => p));
    if (head) {
      multiplicity = "ManyToOne";
      covered.add(head.id!);
    }
  }

  if (ucs.length === 0) {
    lose(element, "has no uniqueness; Ossie's set semantics give it one spanning every role");
  }
  for (const c of ft.internalConstraints) {
    if (covered.has(c.id!)) continue;
    if (c.type === "internal_uniqueness" && (c.roleIds.length === n || n === 1)) continue; // implied
    if (c.type === "mandatory" && position(c.roleId) === 0 && addMandatory(w.name)) continue;
    loseConstraint([c, ft], element, `${c.type} is not expressible in Ossie`);
  }

  const readings = ft.readings.map((r) => reading(r.template, w, nameOf, element, lose));
  const { requires, derivedBy: noteDerivedBy, rest } = splitNoteLines(ft.note);
  for (const line of rest) lose(element, `note line not written: ${line}`);
  for (const line of noteDerivedBy) lose(element, `note line not written: derived_by: ${line}`);
  const derivation = ft.derivation;
  if (derivation?.kind === "semiderived") {
    lose(element, "semiderived rule written as fully derived");
  }
  if (derivation?.storage === "derived_and_stored") {
    lose(element, "stored derivation written as on request");
  }

  const roles = order.slice(1).map((i, p) => ({
    concept: nameOf(ft.roles[i]!.playerId),
    ...(w.roleNames[p] !== undefined ? { name: w.roleNames[p]! } : {}),
  }));
  return {
    name: w.name,
    ...(ft.definition ? { description: ft.definition } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(multiplicity ? { multiplicity } : {}),
    ...(derivation ? { derived_by: splitDerivation(derivation.expression) } : {}),
    ...(requires.length > 0 ? { requires } : {}),
    verbalizes: readings,
  };
}

/**
 * A barwise reading template as an Ossie verbalization: `{n}` becomes the
 * placeholder for the role at that index, and any other brace text is
 * written with parentheses so the importer does not read it as a role.
 */
function reading(
  template: string,
  w: Written,
  nameOf: (id: string) => string,
  element: string,
  lose: (e: string, what: string) => void,
): string {
  // Split at role positions: even parts are text, odd parts are indexes.
  const parts = template.split(/\{(\d+)\}/);
  let braced = false;
  const out = parts.map((part, i) => {
    if (i % 2 === 0) {
      const plain = part.replace(/\{/g, "(").replace(/\}/g, ")");
      if (plain !== part) braced = true;
      return plain;
    }
    const p = w.order.indexOf(Number(part));
    if (p === 0) return `{${w.keys[0]}}`;
    const player = nameOf(w.ft.roles[w.order[p]!]!.playerId);
    const name = w.roleNames[p - 1];
    return name !== undefined ? `{${player}:${name}}` : `{${player}}`;
  });
  if (braced) lose(element, `reading "${template}" has brace text, written with parentheses`);
  return out.join("");
}

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

interface ConceptContext {
  readonly model: OrmModel;
  readonly name: string;
  readonly relationships: readonly OssieRelationship[];
  readonly identifyBy: readonly string[] | undefined;
  readonly mandatory: readonly string[];
  readonly supertypes: { names: string[]; derivedBy?: string[]; } | undefined;
  readonly lose: (e: string, what: string) => void;
}

function writeConcept(ot: ObjectType, ctx: ConceptContext): OssieConcept {
  const { lose, name } = ctx;
  if (ot.aliases.length > 0) lose(ot.name, `aliases ${ot.aliases.join(", ")} not written`);
  if (ot.independent) lose(ot.name, "independence not written");
  if (ot.cardinality) lose(ot.name, "population cardinality not written");
  if (ot.sourceContext) lose(ot.name, `source context ${ot.sourceContext} not written`);
  const { requires: noteRequires, derivedBy: noteDerivedBy, rest } = splitNoteLines(ot.note);
  for (const line of rest) lose(ot.name, `note line not written: ${line}`);

  const base = {
    concept: name,
    ...(ot.definition ? { description: ot.definition } : {}),
  };
  if (ot.kind === "value") {
    if (ot.defaultValue !== undefined) {
      lose(ot.name, `default value ${ot.defaultValue} not written`);
    }
    const [builtin, lossy] = ot.dataType
      ? DATA_TYPES[ot.dataType.name]
      : (["String", true] as const);
    if (!ot.dataType) lose(ot.name, "no data type; written as String");
    else if (lossy) lose(ot.name, `data type ${ot.dataType.name} written as ${builtin}`);
    if (ot.dataType?.length !== undefined || ot.dataType?.scale !== undefined) {
      lose(ot.name, "data type length or scale not written");
    }
    const constraintItems = valueConstraintItems(ot, name, lose);
    const requires = [...constraintItems];
    const intended = readValueShapes(name, constraintItems);
    for (const line of noteRequires) {
      // Kept only if, read back after the constraint's own items, it stays
      // text and leaves the constraint as it is; else it would merge into
      // the constraint or replace it.
      const after = readValueShapes(name, [...requires, line]);
      if (sameShapes(after, intended) && after.unrecognized.includes(line)) requires.push(line);
      else {lose(
          ot.name,
          `note line not written, it would read back as a constraint: requires: ${line}`,
        );}
    }
    return {
      ...base,
      type: "ValueType",
      extends: [builtin],
      ...(noteDerivedBy.length > 0 ? { derived_by: noteDerivedBy } : {}),
      ...(requires.length > 0 ? { requires } : {}),
      ...(ctx.relationships.length > 0 ? { relationships: [...ctx.relationships] } : {}),
    };
  }

  const identified = ctx.identifyBy !== undefined;
  const identifiedBySupertype = ctx.model.subtypeFacts.some((sf) =>
    sf.subtypeId === ot.id && sf.providesIdentification
  );
  if (!identified && !identifiedBySupertype) {
    lose(ot.name, `no identifier Ossie can state; reference mode ${ot.referenceMode} not written`);
  }
  // The importer reads a single identifier's name back as the reference
  // mode, and gives a composite one `<snake_name>_id`; any other is lost.
  const readBack = ctx.identifyBy?.length === 1 ? ctx.identifyBy[0] : `${snakeCase(name)}_id`;
  if (identified && ot.referenceMode !== readBack) {
    lose(ot.name, `reference mode ${ot.referenceMode} not written`);
  }
  // A subtype's derived_by is its subtype facts' defining rule on import,
  // so note lines there would become one; the importer only writes them
  // into the note of an entity with no supertype.
  const hasSupertypes = (ctx.supertypes?.names.length ?? 0) > 0;
  if (hasSupertypes) {
    for (const line of noteDerivedBy) lose(ot.name, `note line not written: derived_by: ${line}`);
  }
  const derivedBy = hasSupertypes ? ctx.supertypes?.derivedBy ?? [] : noteDerivedBy;
  const ownRelationships = new Set(ctx.relationships.map((r) => r.name));
  const requires = [...ctx.mandatory.map((rel) => `${name}.${rel}`)];
  for (const line of noteRequires) {
    const rel = readMandatoryShape(name, line);
    if (rel !== undefined && ownRelationships.has(rel)) {
      lose(
        ot.name,
        `note line not written, it would read back as a mandatory role: requires: ${line}`,
      );
    } else requires.push(line);
  }
  return {
    ...base,
    type: "EntityType",
    ...(ctx.supertypes && ctx.supertypes.names.length > 0 ? { extends: ctx.supertypes.names } : {}),
    ...(derivedBy.length > 0 ? { derived_by: derivedBy } : {}),
    ...(ctx.identifyBy ? { identify_by: [...ctx.identifyBy] } : {}),
    ...(requires.length > 0 ? { requires } : {}),
    ...(ctx.relationships.length > 0 ? { relationships: [...ctx.relationships] } : {}),
  };
}

/** A value type's value constraint as `requires` items, when the importer would read it back. */
function valueConstraintItems(
  ot: ObjectType,
  name: string,
  lose: (e: string, what: string) => void,
): string[] {
  if (ot.kind !== "value" || !ot.valueConstraint) return [];
  const { values, ranges = [] } = ot.valueConstraint;
  if (values.length > 0 && ranges.length === 0) {
    const item = writeEnumeration(name, values);
    if (item) return [item];
  } else if (values.length === 0 && ranges.length === 1) {
    const items = writeBounds(name, ranges[0]!);
    if (items) return items;
  }
  lose(ot.name, "value constraint is not a shape Ossie's requires can state");
  return [];
}

/**
 * Each entity's supertypes in subtype-fact order, and the one defining
 * rule a concept can carry. A flag or rule the importer would not rebuild
 * is a loss.
 */
function subtypeLinks(
  model: OrmModel,
  nameOf: (id: string) => string,
  identifyBy: ReadonlyMap<string, readonly string[]>,
  lose: (e: string, what: string) => void,
): Map<string, { names: string[]; derivedBy?: string[]; }> {
  const out = new Map<string, { names: string[]; derivedBy?: string[]; }>();
  for (const sf of model.subtypeFacts) {
    const entry = out.get(sf.subtypeId) ?? { names: [] };
    const sub = model.getObjectType(sf.subtypeId)!.name;
    const expected = entry.names.length === 0 && !identifyBy.has(sf.subtypeId);
    if (sf.providesIdentification !== expected) {
      lose(
        `${sub} -> ${model.getObjectType(sf.supertypeId)!.name}`,
        "identification through the supertype not written as it is",
      );
    }
    const items = sf.definingRule ? splitDerivation(sf.definingRule.expression) : [];
    if (entry.names.length === 0) {
      entry.derivedBy = items;
    } else if ((entry.derivedBy ?? []).join("\n") !== items.join("\n")) {
      // The importer gives one concept-level derived_by to every subtype
      // fact, so supertypes whose rules differ -- one with a rule, one
      // without included -- cannot come back as they were.
      lose(sub, "its subtype facts' defining rules differ; only the first is written");
    }
    if (sf.definingRule?.kind === "semiderived") {
      lose(sub, "semiderived defining rule written as fully derived");
    }
    if (sf.definingRule?.storage === "derived_and_stored") {
      lose(sub, "stored defining rule written as on request");
    }
    entry.names.push(nameOf(sf.supertypeId));
    out.set(sf.subtypeId, entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function sameShapes(
  a: { values: readonly string[]; ranges: readonly unknown[]; },
  b: { values: readonly string[]; ranges: readonly unknown[]; },
): boolean {
  return JSON.stringify([a.values, a.ranges]) === JSON.stringify([b.values, b.ranges]);
}

function splitDerivation(expression: string): string[] {
  return expression.split(DERIVATION_ITEM_SEPARATOR).filter((e) => e.trim().length > 0);
}

function splitNoteLines(note: string | undefined): {
  requires: string[];
  derivedBy: string[];
  rest: string[];
} {
  const requires: string[] = [];
  const derivedBy: string[] = [];
  const rest: string[] = [];
  for (const line of (note ?? "").split("\n")) {
    // An empty item is refused by the importer, so a bare prefix is a loss.
    if (line.startsWith(REQUIRES_NOTE_PREFIX) && line.slice(REQUIRES_NOTE_PREFIX.length).trim()) {
      requires.push(line.slice(REQUIRES_NOTE_PREFIX.length));
    } else if (
      line.startsWith(DERIVED_BY_NOTE_PREFIX) && line.slice(DERIVED_BY_NOTE_PREFIX.length).trim()
    ) {
      derivedBy.push(line.slice(DERIVED_BY_NOTE_PREFIX.length));
    } else if (line.trim().length > 0) rest.push(line);
  }
  return { requires, derivedBy, rest };
}

/** The model note as the ontology's description and its `requires` lines. */
function splitNote(note: string | undefined): { description?: string; requires: string[]; } {
  const lines = (note ?? "").split("\n");
  const requires = lines
    .filter((l) => l.startsWith(REQUIRES_NOTE_PREFIX))
    .map((l) => l.slice(REQUIRES_NOTE_PREFIX.length));
  const description = lines.filter((l) => !l.startsWith(REQUIRES_NOTE_PREFIX)).join("\n").trim();
  return { ...(description ? { description } : {}), requires };
}
