/**
 * The 3.x and 2.0 replay into format 4.0 (iri-identity WS6, 6b-2b-2a): a
 * model read from a 3.0 file, or by the 2.0 reader, added element by
 * element to a fresh model that names what it is given. Every id the old
 * model held is dropped and every reference goes through the growing map
 * from old id to new, so a 3.x file's UUIDs become local names and nothing
 * else moves. A reference the old model never defined is carried across
 * as written, so validation reports it as it does today -- unless 4.0
 * could not read it back, when it takes its old id's local name (a role
 * `unresolved.<local name>`) and still resolves to nothing (owner,
 * 2026-10-31).
 *
 * The replay asks for what a migration takes and new authoring does not:
 * the suffix rule for roles named alike (decision 5) and, for a fact type
 * named like the object type that objectifies it, an id from its first
 * reading (decision 20). The new model refuses an id across kinds, as a
 * 4.0 model does. Its map back to the old ids stays on it in memory, never
 * written, for diff to pair two replayed revisions exactly.
 *
 * The loader replays every 3.0 and 2.0 file through it (6b-2b-2b-2).
 */
import {
  type ConstraintFileValue,
  constraintRecord,
  modelConstraint,
} from "../decode/constraint.js";
import type { Constraint, ExternalConstraint, InternalConstraint } from "../model/Constraint.js";
import { constraintRef } from "../model/constraintRef.js";
import { toFactTypeConfig } from "../model/FactType.js";
import { mapConstraintReferences, type Reference } from "../model/mint.js";
import {
  LOCAL_NAME_PATTERN,
  localName,
  REFERENCE_PATTERN,
  ROLE_ID_PATTERN,
} from "../model/name.js";
import { toObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { ObjectTypeConfig } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import { toPopulationConfig } from "../model/Population.js";
import { toSubtypeFactConfig } from "../model/SubtypeFact.js";

/** Which element an old id names: a 3.x file may give two kinds one id. */
type Kind =
  | "objectType"
  | "factType"
  | "role"
  | "constraint"
  | "subtypeFact"
  | "objectification"
  | "population"
  | "instance";

/** What a replay may be told beyond its one file. */
export interface ReplayOptions {
  /**
   * The id a shadow's owner holds in its own domain, by the owner's
   * context and the shadow's name; undefined when that domain does not
   * say. A file alone cannot see an owner whose local name took a suffix,
   * so `barwise migrate` given a project replays its domains first, then
   * replays each domain with shadows again with this, so the shadow names
   * its owner rather than whichever element holds the unsuffixed local
   * name (iri-identity, Requirements: the 3.x read).
   */
  readonly ownerId?: (context: string, name: string) => string | undefined;
}

/**
 * Replay a 3.x model into format 4.0's ids. Pure: one model and one set of
 * options give one result. The returned model's `priorIds` maps each new
 * id back to the old.
 */
export function replayInto40(source: OrmModel, options: ReplayOptions = {}): OrmModel {
  const target = new OrmModel({
    name: source.name,
    ...(source.domainContext !== undefined ? { domainContext: source.domainContext } : {}),
    ...(source.note !== undefined ? { note: source.note } : {}),
    ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
    idsAcrossKinds: true,
  });
  // One map per kind: an object type and a fact type sharing an old id are
  // two entries, and a reference resolves within the kind it names.
  const maps = new Map<Kind, Map<string, string>>();
  const mapOf = (kind: Kind) => {
    let m = maps.get(kind);
    if (!m) maps.set(kind, m = new Map());
    return m;
  };
  const to = (kind: Kind, id: string): string => mapOf(kind).get(id) ?? id;
  const record = (kind: Kind, from: string | undefined, now: string | undefined) => {
    if (from !== undefined && now !== undefined) mapOf(kind).set(from, now);
  };
  // A diagram position keys an object type or a fact type; an orientation,
  // a fact type only (`DiagramLayout`).
  const toElement = (id: string) => mapOf("objectType").get(id) ?? to("factType", id);

  /**
   * The constraint over the new ids, without its id: the model names it
   * from its sentence, and leaves one it cannot -- a malformed constraint,
   * an internal one naming another fact type's role -- unnamed, as it does
   * a subtype fact or objectification whose references dangle (decision
   * 19). A reference to such a constraint, a preferred identifier, then
   * names nothing, and validation reports it.
   */
  const remap = <C extends Constraint>(c: C): C => {
    const form = mapConstraintReferences(c, (ref: Reference) => to(ref.kind, ref.id));
    const { id: _dropped, ...rest } = modelConstraint(
      constraintRecord({ ...form, id: "" } as unknown as ConstraintFileValue),
    );
    return rest as unknown as C;
  };

  // A constraint the model left unnamed has no id to map to; its old id is
  // kept against its reference (`constraintRef`), so a diagnostic about it
  // still finds the line the file states it on, and a preferred identifier
  // that named it is told apart from one that dangled in the file.
  // By the constraint, not its reference: two identical ones share one.
  const unnamedPrior = new Map<Constraint, string>();
  const kept = (old: string | undefined, added: Constraint | undefined) => {
    if (old === undefined || added === undefined) return;
    if (added.id !== undefined) record("constraint", old, added.id);
    else unnamedPrior.set(added, old);
  };
  const leftUnnamed = () => new Set(unnamedPrior.values());
  /**
   * A preferred identifier as the new model states it: through the map,
   * or as written when it dangled in the file (reshaped if 4.0 could not
   * read it). One naming a constraint the replay left unnamed names
   * nothing now, as decision 19 has a reference to such an element; it
   * takes its old id's local name, under the suffix rule past every id
   * the model holds, so it is one 4.0 reads and no element answers to.
   */
  const preferredNow = (old: string): string => {
    if (!leftUnnamed().has(old)) return to("constraint", old);
    const base = localName(old) || "constraint";
    const free = (id: string) =>
      target.idKindsHolding(id).length === 0 && !dangling.has(id) && !reshaped.has(id);
    let id = base;
    for (let n = 2; !free(id); n++) id = `${base}_${n}`;
    reshaped.add(id);
    return id;
  };

  // Every reference the old model does not resolve, reserved for the whole
  // replay, so no element the replay names takes one and a dangling
  // reference carried across as written still resolves to nothing.
  const { ids: dangling, byKind } = danglingReferences(source);
  // A dangling reference 4.0 could not read back -- as a 3.0 fragment
  // naming another file's element holds -- takes a shape it can: a role
  // `unresolved.<local name>`, anything else `<local name>`. Still
  // dangling, so validation still reports it, and the old id still legible
  // in the new one (owner, 2026-10-31). `unresolved` is reserved when a
  // role is reshaped, so no fact type the replay names takes it and makes
  // the role resolve; a model with none keeps a fact type of that name.
  const reshaped = new Set<string>();
  let rolesReshaped = false;
  for (const [kind, olds] of [...byKind].sort(([a], [b]) => a.localeCompare(b))) {
    const { pattern, shape } = RESHAPE[kind];
    for (const old of [...olds].sort()) {
      if (pattern.test(old)) continue;
      const base = shape(localName(old) || kind);
      let id = base;
      for (let n = 2; reshaped.has(id) || dangling.has(id); n++) id = `${base}_${n}`;
      reshaped.add(id);
      mapOf(kind).set(old, id);
      rolesReshaped ||= kind === "role";
    }
  }
  const reserved = [...dangling, ...reshaped, ...(rolesReshaped ? [UNRESOLVED] : [])];
  target.withReserved(reserved, () => {
    // Object types first: everything else refers to them. A shadow, which
    // holds another domain's element, takes `<context>:<local name>`, its
    // context a local name too, as a 4.0 alias is; or the owner's own id,
    // when the caller knows it (`ReplayOptions.ownerId`).
    for (const ot of source.objectTypes) {
      const { id: _old, ...config } = ot as ObjectTypeConfig & { readonly id: string; };
      const id = ot.sourceContext !== undefined
        ? `${localName(ot.sourceContext)}:${
          options.ownerId?.(ot.sourceContext, ot.name) ?? localName(ot.name)
        }`
        : undefined;
      record("objectType", ot.id, target.addObjectType({ ...config, ...(id ? { id } : {}) }).id);
    }

    // Which object type objectifies each fact type, for decision 20.
    const objectifier = new Map(
      source.objectifiedFactTypes.map((o) => [o.factTypeId, o.objectTypeId] as const),
    );
    for (const ft of source.factTypes) {
      const { id: _old, roles, constraints, ...config } = toFactTypeConfig(ft);
      const by = objectifier.get(ft.id);
      const added = target.addFactType(
        {
          ...config,
          roles: roles.map(({ id: _role, ...r }) => ({
            ...r,
            playerId: to("objectType", r.playerId),
          })),
        },
        {
          skipPlayerValidation: true,
          suffixRepeatedRoleNames: true,
          idFromFirstReading: by !== undefined && localName(ft.name) === to("objectType", by),
          constraintsOver: (roleIds) => {
            ft.roles.forEach((r, i) => record("role", r.id, roleIds[i]));
            return (constraints ?? []).map((c) => remap(c as InternalConstraint));
          },
        },
      );
      record("factType", ft.id, added.id);
      (constraints ?? []).forEach((c, i) => kept(c.id, added.internalConstraints[i]));
    }

    for (const sf of source.subtypeFacts) {
      const { id: _old, ...config } = toSubtypeFactConfig(sf);
      const added = target.addSubtypeFact(
        {
          ...config,
          subtypeId: to("objectType", sf.subtypeId),
          supertypeId: to("objectType", sf.supertypeId),
        },
        { skipPlayerValidation: true },
      );
      record("subtypeFact", sf.id, added.id);
    }

    for (const c of source.constraints) {
      kept(c.id, target.addConstraint(remap(c as ExternalConstraint)));
    }

    // After every constraint, as the readers set them.
    for (const ot of source.objectTypes) {
      const preferred = source.preferredIdentifierOf(ot.id);
      if (preferred !== undefined) {
        target.setPreferredIdentifier(to("objectType", ot.id), preferredNow(preferred));
      }
    }

    for (const o of source.objectifiedFactTypes) {
      const { id: _old, ...config } = toObjectifiedFactTypeConfig(o);
      const added = target.addObjectifiedFactType(
        {
          ...config,
          factTypeId: to("factType", o.factTypeId),
          objectTypeId: to("objectType", o.objectTypeId),
        },
        { skipPlayerValidation: true },
      );
      record("objectification", o.id, added.id);
    }

    for (const pop of source.populations) {
      const { id: _old, instances, ...config } = toPopulationConfig(pop);
      const added = target.addPopulation(
        { ...config, factTypeId: to("factType", pop.factTypeId) },
        { skipPlayerValidation: true },
      );
      record("population", pop.id, added.id);
      for (const inst of instances ?? []) {
        const roleValues = Object.fromEntries(
          Object.entries(inst.roleValues).map(([role, value]) => [to("role", role), value]),
        );
        record("instance", inst.id, added.addInstance({ roleValues }).id);
      }
    }

    for (const d of source.definitions) target.addDefinition(d);
    for (const layout of source.diagramLayouts) {
      const keyed = <V>(rec: Readonly<Record<string, V>>, key: (k: string) => string) =>
        Object.fromEntries(Object.entries(rec).map(([k, v]) => [key(k), v]));
      target.addDiagramLayout({
        ...layout,
        ...(layout.elements !== undefined
          ? { elements: layout.elements.map((e) => to("objectType", e)) }
          : {}),
        positions: keyed(layout.positions, toElement),
        orientations: keyed(layout.orientations, (k) => to("factType", k)),
      });
    }
  });

  // New ids are unique across kinds in a 4.0 model, so the map back is one.
  const back = new Map<string, string>();
  for (const m of maps.values()) for (const [from, now] of m) back.set(now, from);
  // Two identical unnamed constraints share a reference, and keep one here.
  for (const [c, old] of unnamedPrior) back.set(constraintRef(c), old);
  target.recordPriorIds(back);
  return target;
}

/** The fact type part of a reshaped dangling role reference. */
const UNRESOLVED = "unresolved";

/** The kinds a reference can dangle as. */
export type DanglingKind = "objectType" | "factType" | "role" | "subtypeFact" | "constraint";

/**
 * What 4.0 reads at a reference of each kind, and the shape a dangling one
 * that does not match takes from its old id's local name. A constraint
 * dangles only as an entity's preferred identifier. Each pattern must
 * accept what the 4.0 decoder's leaf for that reference accepts
 * (`decode/ids.ts`, `IDS_40`); `replay.test.ts` holds them together.
 */
export const RESHAPE: Record<DanglingKind, { pattern: RegExp; shape: (local: string) => string; }> =
  {
    objectType: { pattern: REFERENCE_PATTERN, shape: (l) => l },
    factType: { pattern: LOCAL_NAME_PATTERN, shape: (l) => l },
    role: { pattern: ROLE_ID_PATTERN, shape: (l) => `${UNRESOLVED}.${l}` },
    subtypeFact: { pattern: LOCAL_NAME_PATTERN, shape: (l) => l },
    constraint: { pattern: LOCAL_NAME_PATTERN, shape: (l) => l },
  };

/**
 * Every id the model refers to and does not define, each reference
 * checked against the kind it names; and the same, by that kind. A strict
 * load admits one where it does not check the reference, as for a
 * constraint's roles or a preferred identifier.
 */
function danglingReferences(
  model: OrmModel,
): { ids: Set<string>; byKind: Map<DanglingKind, Set<string>>; } {
  const out = new Set<string>();
  const byKind = new Map<DanglingKind, Set<string>>();
  const dangles = (kind: DanglingKind, id: string) => {
    out.add(id);
    let ids = byKind.get(kind);
    if (!ids) byKind.set(kind, ids = new Set());
    ids.add(id);
  };
  const objectType = (id: string) =>
    model.getObjectType(id) !== undefined || dangles("objectType", id);
  const factType = (id: string) => model.getFactType(id) !== undefined || dangles("factType", id);
  const role = (id: string) => model.factTypesHolding([id]).length > 0 || dangles("role", id);
  const subtypeFact = (id: string) =>
    model.getSubtypeFact(id) !== undefined || dangles("subtypeFact", id);
  const constraintIds = new Set(model.everyConstraint().map(([c]) => c.id));
  for (const ft of model.factTypes) for (const r of ft.roles) objectType(r.playerId);
  for (const [c] of model.everyConstraint()) {
    mapConstraintReferences(c, (ref) => {
      if (ref.kind === "role") role(ref.id);
      else if (ref.kind === "subtypeFact") subtypeFact(ref.id);
      else objectType(ref.id);
      return ref.id;
    });
  }
  for (const sf of model.subtypeFacts) {
    objectType(sf.subtypeId);
    objectType(sf.supertypeId);
  }
  for (const ot of model.objectTypes) {
    const preferred = model.preferredIdentifierOf(ot.id);
    if (preferred !== undefined && !constraintIds.has(preferred)) dangles("constraint", preferred);
  }
  for (const o of model.objectifiedFactTypes) {
    factType(o.factTypeId);
    objectType(o.objectTypeId);
  }
  for (const pop of model.populations) {
    factType(pop.factTypeId);
    for (const inst of pop.instances) for (const r of Object.keys(inst.roleValues)) role(r);
  }
  for (const layout of model.diagramLayouts) {
    for (const e of layout.elements ?? []) objectType(e);
    // A stale key reserved, so no element renamed to it takes over a position.
    for (const k of Object.keys(layout.positions)) {
      if (model.getObjectType(k) === undefined) factType(k);
    }
    for (const k of Object.keys(layout.orientations)) factType(k);
  }
  return { ids: out, byKind };
}
