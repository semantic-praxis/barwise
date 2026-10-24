/**
 * `OssieDocument` to an `OrmModel`, plus the warnings that name what the
 * model could not carry (`docs/specs/ossie-ontology-format.spec.md`, WS1).
 *
 * The document is checked whole before anything is built, so a malformed
 * one is refused with an `OssieImportError` naming the place, rather than
 * by whichever core constructor first trips over it with a message about
 * barwise internals.
 *
 * Every id comes from `generateId()`, as every importer's does but NORMA's
 * (`docs/specs/importer-role-ids.spec.md`, R1): elements are found again
 * by name -- Ossie concept names are unique, and a relationship imports as
 * `Concept.rel` -- never by an id built from one. A re-import diffs by
 * content, which diff falls back to when ids differ.
 */
import {
  type ConceptualDataTypeName,
  generateId,
  type InternalConstraint,
  isUniqueAlone,
  OrmModel,
  type RoleConfig,
  type ValueConstraintDef,
} from "@barwise/core";
import { snakeCase } from "../naming.js";
import {
  isOssieBuiltinValueType,
  OSSIE_ANY,
  OSSIE_BUILTIN_VALUE_TYPES,
  type OssieConcept,
  type OssieDocument,
  OssieImportError,
  type OssieRelationship,
} from "./OssieTypes.js";
import { readMandatoryShape, readValueShapes } from "./requiresShapes.js";

export interface OssieMapResult {
  readonly model: OrmModel;
  readonly warnings: readonly string[];
}

/** The fact type name a relationship imports as: what Ossie expressions call it. */
export function ossieFactTypeName(concept: string, relationship: string): string {
  return `${concept}.${relationship}`;
}

/** The prefix a kept, unrecognized expression carries in an element's note. */
export const REQUIRES_NOTE_PREFIX = "requires: ";

/** The prefix a kept `derived_by` expression carries in an element's note. */
export const DERIVED_BY_NOTE_PREFIX = "derived_by: ";

type Concepts = ReadonlyMap<string, OssieConcept>;

/** A value type's chain up to its built-in: the user value types passed through, and the root. */
interface Chain {
  readonly through: readonly OssieConcept[];
  readonly root: ConceptualDataTypeName;
}

/** An entity's `requires`, split: the relationships made mandatory, and the rest. */
interface RequiresSplit {
  readonly mandatory: readonly string[];
  readonly unrecognized: readonly string[];
}

/**
 * What the document check resolved, so building the model reads each
 * decision rather than making it a second time: two copies of "which
 * requires items are mandatory" could disagree, and an item would land in
 * the note and the constraints both, or in neither.
 */
interface Resolved {
  readonly readings: ReadonlyMap<OssieRelationship, readonly string[]>;
  readonly chains: ReadonlyMap<OssieConcept, Chain>;
  readonly requires: ReadonlyMap<OssieConcept, RequiresSplit>;
}

/**
 * An expression as one line, for where it is rendered: a warning printed
 * as one comment line, and a note's one-expression-per-line framing. Never
 * applied to what the model stores as data -- an enumeration's literals
 * or a derivation's text, where whitespace and a SQL `--` comment's line
 * end carry meaning.
 */
function oneLine(expr: string): string {
  return expr.trim().replace(/\s+/g, " ");
}

export function mapOssieToOrm(doc: OssieDocument, modelName?: string): OssieMapResult {
  const resolved = checkDocument(doc);
  const warnings: string[] = [];
  // The ontology-level requires has no element to hold it but the model,
  // so it joins the description in the model's note.
  const ontologyRequires = doc.requires ?? [];
  const note = [doc.description, notes(ontologyRequires, [])].filter(Boolean).join("\n");
  const model = new OrmModel({ name: modelName ?? doc.name, ...(note ? { note } : {}) });

  reportDropped(doc, ontologyRequires, warnings);
  reportUnsplittable(doc, warnings);

  // Object types first: relationships name concepts declared further down.
  for (const c of doc.ontology) addConcept(model, c, resolved, warnings);
  for (const c of doc.ontology) {
    for (const r of c.relationships ?? []) {
      addRelationship(model, c, r, resolved.readings.get(r)!, warnings);
    }
  }
  const unidentified = doc.ontology.filter((c) =>
    c.type === "EntityType" && !hasIdentifyBy(c) && supertypes(c).length === 0
  );
  if (unidentified.length > 0) {
    // One line for all of them: an ontology that leaves most concepts
    // unidentified would otherwise bury the warnings that name a loss.
    warnings.push(
      `no identify_by and no supertype, so nothing identifies them; each is given a reference `
        + `mode no relationship carries: ${unidentified.map((c) => c.concept).join(", ")}.`,
    );
  }
  for (const c of doc.ontology) {
    if (c.type !== "EntityType") continue;
    addSubtypes(model, c);
    addIdentifier(model, c, warnings);
    addMandatoryRoles(model, c, resolved.requires.get(c)!);
  }
  return { model, warnings };
}

// ---------------------------------------------------------------------------
// The document check: every refusal the spec's Scope lists, in one place.
// ---------------------------------------------------------------------------

function checkDocument(doc: OssieDocument): Resolved {
  const concepts = new Map<string, OssieConcept>();
  const readings = new Map<OssieRelationship, readonly string[]>();
  const chains = new Map<OssieConcept, Chain>();
  const requires = new Map<OssieConcept, RequiresSplit>();
  for (const c of doc.ontology) {
    if (concepts.has(c.concept)) {
      throw new OssieImportError(`Concept ${c.concept} is declared twice.`);
    }
    if (isOssieBuiltinValueType(c.concept) || c.concept === OSSIE_ANY) {
      throw new OssieImportError(`Concept ${c.concept} redeclares an Ossie built-in.`);
    }
    concepts.set(c.concept, c);
  }
  for (const c of doc.ontology) {
    if (c.type === "EntityType") {
      checkEntity(c, concepts);
      requires.set(c, splitEntityRequires(c));
    } else {
      chains.set(c, valueChain(c, concepts));
    }
    const seen = new Set<string>();
    for (const r of c.relationships ?? []) {
      if (seen.has(r.name)) {
        throw new OssieImportError(`${c.concept} declares relationship ${r.name} twice.`);
      }
      seen.add(r.name);
      readings.set(r, checkRelationship(c, r, concepts));
    }
  }
  checkNoSubtypeCycle(doc, concepts);
  return { readings, chains, requires };
}

function checkEntity(c: OssieConcept, concepts: Concepts): void {
  for (const s of c.extends ?? []) {
    if (s === OSSIE_ANY) continue;
    if (s === c.concept) throw new OssieImportError(`Entity type ${c.concept} extends itself.`);
    if (concepts.get(s)?.type !== "EntityType") {
      throw new OssieImportError(
        `Entity type ${c.concept} extends ${s}, which is not a declared entity type.`,
      );
    }
  }
  if (new Set(c.extends ?? []).size !== (c.extends ?? []).length) {
    throw new OssieImportError(`Entity type ${c.concept} lists a supertype twice.`);
  }
  const identifiers = c.identify_by ?? [];
  if (new Set(identifiers).size !== identifiers.length) {
    throw new OssieImportError(`${c.concept}: identify_by lists a relationship twice.`);
  }
  for (const rel of identifiers) {
    const r = (c.relationships ?? []).find((x) => x.name === rel);
    if (!r) {
      throw new OssieImportError(
        `${c.concept}: identify_by names ${rel}, which ${c.concept} does not itself declare.`,
      );
    }
    if ((r.roles ?? []).length !== 1) {
      throw new OssieImportError(`${c.concept}: identify_by names ${rel}, which is not binary.`);
    }
    // A ring binary relates the entity to another of its kind; core does
    // not read it as identifying its player, so the preferred identifier
    // would fail validation instead of the import naming the place.
    if (r.roles![0]!.concept === c.concept) {
      throw new OssieImportError(
        `${c.concept}: identify_by names ${rel}, which relates ${c.concept} to itself.`,
      );
    }
  }
}

function checkNoSubtypeCycle(doc: OssieDocument, concepts: Concepts): void {
  const done = new Set<string>();
  const visit = (name: string, path: string[]): void => {
    if (done.has(name)) return;
    if (path.includes(name)) {
      throw new OssieImportError(`extends forms a cycle: ${[...path, name].join(" -> ")}.`);
    }
    for (const s of concepts.get(name)?.extends ?? []) {
      if (concepts.get(s)?.type === "EntityType") visit(s, [...path, name]);
    }
    done.add(name);
  };
  for (const c of doc.ontology) if (c.type === "EntityType") visit(c.concept, []);
}

/** The role keys Ossie expressions and placeholders use: the role name, else the player. */
function roleKeys(c: OssieConcept, r: OssieRelationship): string[] {
  return [c.concept, ...(r.roles ?? []).map((role) => role.name ?? role.concept)];
}

function rolePlayers(c: OssieConcept, r: OssieRelationship): string[] {
  return [c.concept, ...(r.roles ?? []).map((role) => role.concept)];
}

/** Checks a relationship and returns its reading templates. */
function checkRelationship(
  c: OssieConcept,
  r: OssieRelationship,
  concepts: Concepts,
): readonly string[] {
  const name = ossieFactTypeName(c.concept, r.name);
  for (const player of rolePlayers(c, r)) {
    if (!concepts.has(player) && !isOssieBuiltinValueType(player)) {
      throw new OssieImportError(
        `${name} names concept ${player}, which the ontology does not declare.`,
      );
    }
  }
  const keys = roleKeys(c, r);
  const repeated = keys.find((k, i) => keys.indexOf(k) !== i);
  if (repeated !== undefined) {
    throw new OssieImportError(
      `${name}: two roles answer to ${repeated}; Ossie requires a role name to tell them apart.`,
    );
  }
  if (r.verbalizes.length === 0) {
    throw new OssieImportError(`${name}: verbalizes lists no reading.`);
  }
  return r.verbalizes.map((pattern) => reading(pattern, keys, rolePlayers(c, r), name));
}

/**
 * A value type's chain up to its built-in: the user value types it passes
 * through, then the built-in's data type.
 */
function valueChain(c: OssieConcept, concepts: Concepts): Chain {
  // Only the first supertype gives the data type, but every one named must
  // be a value type: a typo or an entity there is the mistake an entity's
  // extends is refused for.
  for (const s of (c.extends ?? []).slice(1)) {
    if (s === c.concept) throw new OssieImportError(`Value type ${c.concept} extends itself.`);
    if (!isOssieBuiltinValueType(s) && concepts.get(s)?.type !== "ValueType") {
      throw new OssieImportError(
        `Value type ${c.concept} extends ${s}, which is not a declared value type.`,
      );
    }
  }
  const through: OssieConcept[] = [];
  let at = c.extends?.[0];
  if (at === undefined) {
    throw new OssieImportError(`Value type ${c.concept} extends no built-in value type.`);
  }
  while (!isOssieBuiltinValueType(at)) {
    const next = concepts.get(at);
    if (next?.type !== "ValueType") {
      throw new OssieImportError(
        `Value type ${c.concept} extends ${at}, which is not a declared value type.`,
      );
    }
    if (next === c || through.includes(next)) {
      throw new OssieImportError(`Value type ${c.concept} extends itself.`);
    }
    through.push(next);
    at = next.extends?.[0];
    if (at === undefined) {
      throw new OssieImportError(`Value type ${next.concept} extends no built-in value type.`);
    }
  }
  return { through, root: OSSIE_BUILTIN_VALUE_TYPES[at] };
}

// ---------------------------------------------------------------------------
// Building the model.
// ---------------------------------------------------------------------------

function reportDropped(
  doc: OssieDocument,
  ontologyRequires: readonly string[],
  warnings: string[],
): void {
  if (doc.prefixes) {
    warnings.push(`prefixes: barwise has no field for namespace prefixes; dropped.`);
  }
  if (doc.ai_context !== undefined) {
    warnings.push(`ai_context: barwise has no field for AI context; dropped.`);
  }
  if (doc.ontology_mappings) {
    warnings.push(
      `ontology_mappings: embedded mappings (deprecated in Ossie) are not imported; dropped.`,
    );
  }
  for (const expr of ontologyRequires) {
    warnings.push(
      `requires on the ontology is not carried as a constraint (kept in the model's note): ${
        oneLine(expr)
      }`,
    );
  }
  for (const c of doc.ontology) {
    if (c.iri) warnings.push(`${c.concept}: iri ${c.iri} dropped; barwise has no field for IRIs.`);
    for (const r of c.relationships ?? []) {
      if (r.iri) {
        const name = ossieFactTypeName(c.concept, r.name);
        warnings.push(`${name}: iri ${r.iri} dropped; barwise has no field for IRIs.`);
      }
    }
  }
}

/** The object type a concept imported as; every concept is added before it is looked up. */
function conceptId(model: OrmModel, name: string): string {
  return model.getObjectTypeByName(name)!.id;
}

/** The fact type a relationship imported as; every relationship is added before it is looked up. */
function relationshipFact(model: OrmModel, concept: string, rel: string) {
  return model.getFactTypeByName(ossieFactTypeName(concept, rel))!;
}

/**
 * The object type playing a role, made on first use when it is a built-in.
 * Ossie lets a role name `String` without declaring it; barwise needs an
 * object type to play the role, so the built-in becomes one value type of
 * its own name and data type, which the exporter writes back as the
 * built-in rather than as a declared concept.
 */
function playerId(model: OrmModel, name: string): string {
  const existing = model.getObjectTypeByName(name);
  if (existing) return existing.id;
  // checkRelationship has refused any player that is neither declared nor built in.
  const builtin = name as keyof typeof OSSIE_BUILTIN_VALUE_TYPES;
  return model.addObjectType({
    id: generateId(),
    name,
    kind: "value",
    dataType: { name: OSSIE_BUILTIN_VALUE_TYPES[builtin] },
  }).id;
}

const kept = (concept: string, expr: string): string =>
  `${concept}: requires is not carried as a constraint (kept in the note): ${oneLine(expr)}`;

function addConcept(
  model: OrmModel,
  c: OssieConcept,
  resolved: Resolved,
  warnings: string[],
): void {
  const base = {
    id: generateId(),
    name: c.concept,
    ...(c.description ? { definition: c.description } : {}),
  };
  if (c.type === "EntityType") {
    const { unrecognized } = resolved.requires.get(c)!;
    for (const expr of unrecognized) warnings.push(kept(c.concept, expr));
    // A derivation with no supertype has no subtype fact to hold it as a
    // defining rule, so it stays as text with the requires it sits beside.
    const unheld = supertypes(c).length > 0 ? [] : c.derived_by ?? [];
    for (const expr of unheld) {
      warnings.push(
        `${c.concept}: derived_by on an entity type with no supertype is kept in the note: ${
          oneLine(expr)
        }`,
      );
    }
    const note = notes(unrecognized, unheld);
    model.addObjectType({
      ...base,
      kind: "entity",
      referenceMode: referenceMode(c),
      ...(note ? { note } : {}),
    });
    return;
  }

  const shapes = readValueShapes(c.concept, c.requires ?? []);
  const derivedBy = c.derived_by ?? [];
  const valueConstraint: ValueConstraintDef | undefined =
    shapes.values.length > 0 || shapes.ranges.length > 0
      ? { values: shapes.values, ...(shapes.ranges.length > 0 ? { ranges: shapes.ranges } : {}) }
      : undefined;
  if (shapes.contradictory.length > 0) {
    warnings.push(
      `${c.concept}: the bounds ${shapes.contradictory.map(oneLine).join(", ")} admit no value; `
        + `kept in the note rather than stored as a constraint nothing satisfies.`,
    );
  }
  for (const expr of shapes.unrecognized) {
    if (!shapes.contradictory.includes(expr)) warnings.push(kept(c.concept, expr));
  }
  for (const expr of derivedBy) {
    warnings.push(`${c.concept}: derived_by on a value type is kept in the note: ${oneLine(expr)}`);
  }
  if (hasIdentifyBy(c)) {
    warnings.push(
      `${c.concept}: identify_by on a value type is not carried; a value identifies itself.`,
    );
  }
  const note = notes(shapes.unrecognized, derivedBy);
  model.addObjectType({
    ...base,
    kind: "value",
    dataType: { name: valueDataType(c, resolved.chains.get(c)!, warnings) },
    ...(valueConstraint ? { valueConstraint } : {}),
    ...(note ? { note } : {}),
  });
}

/**
 * The data type at the root of a value type's `extends` chain. barwise has
 * no value-type subtyping, so a chain flattens to its root and the loss is
 * named (Open decision 1), together with any `requires` on the chain that
 * the flattened type does not inherit.
 */
function valueDataType(c: OssieConcept, chain: Chain, warnings: string[]): ConceptualDataTypeName {
  const supers = c.extends ?? [];
  if (supers.length > 1) {
    warnings.push(
      `${c.concept}: extends ${supers.join(", ")}; barwise keeps one data type, from ${supers[0]}.`,
    );
  }
  const { through, root } = chain;
  if (through.length > 0) {
    warnings.push(
      `${c.concept}: extends ${supers[0]}; barwise has no value-type subtyping, so ${c.concept} `
        + `takes the ${root} data type at the chain's root and the chain is not kept.`,
    );
  }
  for (const ancestor of through) {
    for (const expr of ancestor.requires ?? []) {
      warnings.push(
        `${c.concept}: inherits ${ancestor.concept}'s requires, which the flattened type does not `
          + `carry: ${oneLine(expr)}`,
      );
    }
  }
  return root;
}

/** Whether a concept names its own identifier. */
function hasIdentifyBy(c: OssieConcept): boolean {
  return (c.identify_by ?? []).length > 0;
}

/** The entity's declared supertypes, `Any` (every entity's) left out. */
function supertypes(c: OssieConcept): string[] {
  return (c.extends ?? []).filter((s) => s !== OSSIE_ANY);
}

/**
 * The single identifying relationship's name, which is how Ossie names the
 * reference; else the NORMA importer's `<snake_name>_id`, through the same
 * `snakeCase`, for an entity identified compositely or not at all.
 */
function referenceMode(c: OssieConcept): string {
  return c.identify_by?.length === 1 ? c.identify_by[0]! : `${snakeCase(c.concept)}_id`;
}

/**
 * An entity's `requires`, split: a bare `Entity.rel` naming one of its own
 * relationships is a mandatory first role on `rel`, and everything else is
 * kept in the note. Computed once, by the document check (`Resolved`).
 */
function splitEntityRequires(c: OssieConcept): RequiresSplit {
  const mandatory: string[] = [];
  const unrecognized: string[] = [];
  for (const expr of c.requires ?? []) {
    const rel = readMandatoryShape(c.concept, expr);
    if (rel !== undefined && (c.relationships ?? []).some((r) => r.name === rel)) {
      // `requires: [ E.x, E.x ]` states one constraint, not two.
      if (!mandatory.includes(rel)) mandatory.push(rel);
    } else {
      unrecognized.push(expr);
    }
  }
  return { mandatory, unrecognized };
}

/** Ossie's hyphen binding (`has average- departure {Delay}`), which barwise does not apply. */
const HYPHEN_BINDING = /\w- /;

function addRelationship(
  model: OrmModel,
  c: OssieConcept,
  r: OssieRelationship,
  readings: readonly string[],
  warnings: string[],
): void {
  const name = ossieFactTypeName(c.concept, r.name);
  const players = rolePlayers(c, r);
  const keys = roleKeys(c, r);
  const roles: RoleConfig[] = players.map((player, i) => ({
    id: generateId(),
    name: keys[i]!,
    playerId: playerId(model, player),
  }));
  for (const pattern of r.verbalizes) {
    if (HYPHEN_BINDING.test(pattern)) {
      warnings.push(
        `${name}: reading ${JSON.stringify(pattern)} uses hyphen binding, which barwise does not `
          + `apply; kept as written (barwise-iiw).`,
      );
    }
  }
  const requires = r.requires ?? [];
  for (const expr of requires) warnings.push(kept(name, expr));
  const note = notes(requires, []);
  model.addFactType({
    id: generateId(),
    name,
    roles,
    readings,
    constraints: multiplicityConstraints(name, roles, r.multiplicity, warnings),
    ...(r.description ? { definition: r.description } : {}),
    ...(note ? { note } : {}),
    ...(r.derived_by && r.derived_by.length > 0
      ? {
        derivation: { kind: "derived" as const, expression: joinDerivation(r.derived_by) },
      }
      : {}),
  });
}

/**
 * An Ossie verbalization to a barwise reading template. `{Concept:role}`
 * names the role called `role`; `{Concept}` names the role called
 * `Concept` -- the first role, or one with no role name -- else the only
 * role that concept plays. A placeholder matching none, or a pattern that
 * leaves a role out (naming another twice), is refused: core would refuse
 * the reading, and in core's words.
 */
function reading(
  pattern: string,
  keys: readonly string[],
  players: readonly string[],
  at: string,
): string {
  const named = new Set<number>();
  const template = pattern.replace(
    /\{([^{}:]+)(?::([^{}]+))?\}/g,
    (whole, concept: string, role?: string) => {
      let index = keys.indexOf(role ?? concept);
      if (index >= 0 && players[index] !== concept) index = -1;
      if (index < 0 && role === undefined) {
        const playing = players.flatMap((p, i) => (p === concept ? [i] : []));
        if (playing.length === 1) index = playing[0]!;
      }
      if (index < 0) {
        throw new OssieImportError(
          `${at}: verbalization ${JSON.stringify(pattern)} names ${whole}, which is no role of `
            + `the relationship.`,
        );
      }
      named.add(index);
      return `{${index}}`;
    },
  );
  const missing = keys.filter((_, i) => !named.has(i));
  if (missing.length > 0) {
    throw new OssieImportError(
      `${at}: verbalization ${JSON.stringify(pattern)} leaves out the role ${missing.join(", ")}.`,
    );
  }
  return template;
}

/**
 * The uniqueness a multiplicity states. No multiplicity still states one:
 * Ossie relationships have set semantics, so no link repeats, which is a
 * uniqueness spanning every role (Open decision 3).
 */
function multiplicityConstraints(
  name: string,
  roles: readonly RoleConfig[],
  multiplicity: OssieRelationship["multiplicity"],
  warnings: string[],
): InternalConstraint[] {
  const uc = (ids: readonly string[]): InternalConstraint => ({
    type: "internal_uniqueness",
    id: generateId(),
    roleIds: ids,
  });
  const ids = roles.map((r) => r.id!);
  if (multiplicity === "OneToOne") {
    if (ids.length === 2) return [uc([ids[0]!]), uc([ids[1]!])];
    warnings.push(
      `${name}: OneToOne applies to binary relationships only; read as no multiplicity.`,
    );
  } else if (multiplicity === "ManyToOne") {
    if (ids.length >= 2) return [uc(ids.slice(0, -1))];
    warnings.push(`${name}: ManyToOne needs two roles or more; read as no multiplicity.`);
  }
  return [uc(ids)];
}

/**
 * A subtype fact per declared supertype. The first identifies the subtype
 * unless the subtype names its own `identify_by`.
 */
function addSubtypes(model: OrmModel, c: OssieConcept): void {
  const rule = c.derived_by && c.derived_by.length > 0
    ? { kind: "derived" as const, expression: joinDerivation(c.derived_by) }
    : undefined;
  supertypes(c).forEach((s, i) => {
    model.addSubtypeFact({
      id: generateId(),
      subtypeId: conceptId(model, c.concept),
      supertypeId: conceptId(model, s),
      providesIdentification: i === 0 && !hasIdentifyBy(c),
      ...(rule ? { definingRule: rule } : {}),
    });
  });
}

/**
 * The entity's preferred identifier: the uniqueness on the far role of one
 * identifying relationship, or, for several, an external uniqueness over
 * their far roles (external-preferred-identifier.spec.md). identify_by
 * states each component is single-valued, so a relationship whose
 * multiplicity left the entity's role without its own uniqueness gains
 * one, with a warning, as the far role does in the single case: without
 * it the stored identifier would not identify the entity.
 * checkEntity has held each to a binary the entity itself declares.
 */
function addIdentifier(model: OrmModel, c: OssieConcept, warnings: string[]): void {
  const names = c.identify_by ?? [];
  if (names.length === 0) return;
  const facts = names.map((rel) => relationshipFact(model, c.concept, rel));
  const farRoles = facts.map((ft) => ft.roles[1]!.id);
  if (facts.length === 1) {
    const ft = facts[0]!;
    const held = ft.internalConstraints.find((k) =>
      k.type === "internal_uniqueness" && k.roleIds.length === 1 && k.roleIds[0] === farRoles[0]
    );
    const id = held?.id ?? generateId();
    if (!held) {
      // identify_by states the far role is unique even where the
      // multiplicity did not (a ManyToOne identifying relationship).
      ft.addConstraint({ type: "internal_uniqueness", id, roleIds: farRoles });
      warnings.push(
        `${c.concept}: identify_by ${names[0]} implies each ${ft.roles[1]!.name} identifies at `
          + `most one ${c.concept}; added that uniqueness, which the multiplicity did not state.`,
      );
    }
    model.setPreferredIdentifier(conceptId(model, c.concept), id);
    return;
  }
  for (const [i, ft] of facts.entries()) {
    const near = ft.roles[0]!.id;
    if (isUniqueAlone(ft, near)) continue;
    ft.addConstraint({ type: "internal_uniqueness", id: generateId(), roleIds: [near] });
    warnings.push(
      `${c.concept}: identify_by [${names.join(", ")}] implies each ${c.concept} has at most `
        + `one ${names[i]}; added that uniqueness, which the multiplicity did not state.`,
    );
  }
  const id = generateId();
  model.addConstraint({ type: "external_uniqueness", id, roleIds: farRoles });
  model.setPreferredIdentifier(conceptId(model, c.concept), id);
}

/** The mandatory first roles an entity's `requires` states. */
function addMandatoryRoles(model: OrmModel, c: OssieConcept, split: RequiresSplit): void {
  for (const rel of split.mandatory) {
    const ft = relationshipFact(model, c.concept, rel);
    ft.addConstraint({ type: "mandatory", id: generateId(), roleId: ft.roles[0]!.id });
  }
}

function notes(requires: readonly string[], derivedBy: readonly string[]): string {
  return [
    ...requires.map((e) => `${REQUIRES_NOTE_PREFIX}${oneLine(e)}`),
    ...derivedBy.map((e) => `${DERIVED_BY_NOTE_PREFIX}${oneLine(e)}`),
  ].join("\n");
}

/**
 * A `derived_by` list as one derivation text: the items joined by a blank
 * line, which the exporter splits at. A blank line, not a line end, so one
 * expression that spans lines stays one item on the way back.
 */
export const DERIVATION_ITEM_SEPARATOR = "\n\n";

function joinDerivation(items: readonly string[]): string {
  return items.join(DERIVATION_ITEM_SEPARATOR);
}

/**
 * What the export could not split back as it was written, named now: a
 * `derived_by` item holding a blank line (it would come back as two), and
 * a description line beginning `requires: ` (it would come back as an
 * ontology requires, since the model note holds both).
 */
function reportUnsplittable(doc: OssieDocument, warnings: string[]): void {
  const blank = /\n\s*\n/;
  const owners: [string, readonly string[] | undefined][] = doc.ontology.flatMap((c) => [
    [c.concept, c.derived_by] as [string, readonly string[] | undefined],
    ...(c.relationships ?? []).map((r) =>
      [ossieFactTypeName(c.concept, r.name), r.derived_by] as [
        string,
        readonly string[] | undefined,
      ]
    ),
  ]);
  for (const [owner, items] of owners) {
    if ((items ?? []).some((e) => blank.test(e))) {
      warnings.push(
        `${owner}: a derived_by expression holds a blank line, where the export splits items; `
          + `it will be written back as more than one.`,
      );
    }
  }
  if (doc.description?.split("\n").some((line) => line.startsWith(REQUIRES_NOTE_PREFIX))) {
    warnings.push(
      `description: a line begins "${REQUIRES_NOTE_PREFIX.trim()}", which the export would read as `
        + `an ontology requires.`,
    );
  }
}
