/**
 * The 3.x and 2.0 replay into format 4.0 (iri-identity WS6, 6b-2b-2a): a
 * model read from a 3.0 file, or by the 2.0 reader, added element by
 * element to a fresh model that names what it is given. Every id the old
 * model held is dropped and every reference goes through the growing map
 * from old id to new, so a 3.x file's UUIDs become local names and nothing
 * else moves. A reference the old model never defined is carried across
 * as written, so validation reports it as it does today -- unless it is a
 * role reference 4.0 could not read back, which takes
 * `unresolved.<local name>` and still resolves to nothing (owner,
 * 2026-10-31).
 *
 * The replay asks for what a migration takes and new authoring does not:
 * the suffix rule for roles named alike (decision 5) and, for a fact type
 * named like the object type that objectifies it, an id from its first
 * reading (decision 20). The new model refuses an id across kinds, as a
 * 4.0 model does. Its map back to the old ids stays on it in memory, never
 * written, for diff to pair two replayed revisions exactly.
 *
 * Not yet reached by the loader: 6b-2b-2b switches \`deserialize\` to it.
 */
import {
  type ConstraintFileValue,
  constraintRecord,
  modelConstraint,
} from "../decode/constraint.js";
import type { Constraint, ExternalConstraint, InternalConstraint } from "../model/Constraint.js";
import type { ConstraintInView } from "../model/constraintModel.js";
import { toFactTypeConfig } from "../model/FactType.js";
import type { FactType } from "../model/FactType.js";
import { isMintable, mapConstraintReferences, type Reference } from "../model/mint.js";
import { localName, ROLE_ID_PATTERN } from "../model/name.js";
import { toObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { ObjectTypeConfig } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import { toPopulationConfig } from "../model/Population.js";
import { toSubtypeFactConfig } from "../model/SubtypeFact.js";
import { derivedId } from "./derivedId.js";

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

/**
 * Replay a 3.x model into format 4.0's ids. Pure: one model gives one
 * result. The returned model's `priorIds` maps each new id back to the old.
 */
export function replayInto40(source: OrmModel): OrmModel {
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
   * The constraint over the new ids, without its id when the model can name
   * it. One it cannot -- a malformed constraint, an internal one naming
   * another fact type's role -- keeps an id the replay states: its old one
   * when nothing holds it, else one derived from it, so the replay gives one
   * model for one input. (At the switch to the 4.0 writer such a constraint
   * is left unnamed instead, 6b-2b-2b.)
   */
  const remap = <C extends Constraint>(c: C, host: FactType | undefined): C => {
    const form = mapConstraintReferences(c, (ref: Reference) => to(ref.kind, ref.id));
    const { id: _dropped, ...rest } = modelConstraint(
      constraintRecord({ ...form, id: "" } as unknown as ConstraintFileValue),
    );
    if (c.id === undefined) return rest as unknown as C;
    if (isMintable({ kind: "constraint", inView: [rest, host] as ConstraintInView }, target)) {
      return rest as unknown as C;
    }
    return { ...rest, id: freeId(c.id) } as unknown as C;
  };
  // Ids handed out but not yet added: one fact type's constraints are all
  // remapped before any is added, so the model cannot see them yet.
  const kept = new Set<string>();
  const freeId = (old: string): string => {
    const free = (id: string) =>
      target.idKindsHolding(id).length === 0 && !dangling.has(id) && !kept.has(id);
    const take = (id: string) => (kept.add(id), id);
    if (free(old)) return take(old);
    for (let n = 1;; n++) {
      const id = derivedId("replay.constraint", [old, String(n)]);
      if (free(id)) return take(id);
    }
  };

  // Every reference the old model does not resolve, reserved for the whole
  // replay, so no element the replay names takes one and a dangling
  // reference carried across as written still resolves to nothing.
  const { ids: dangling, roles: danglingRoles } = danglingReferences(source);
  // A dangling role reference 4.0 could not read back, as a 3.0 fragment
  // naming another file's role holds, takes `unresolved.<local name>`:
  // still dangling, so validation still reports it, and the old id still
  // legible in the new one (owner, 2026-10-31). `unresolved` is reserved,
  // so no fact type the replay names takes it and makes the role resolve.
  const reshaped = new Set<string>();
  for (const old of [...danglingRoles].sort()) {
    if (ROLE_ID_PATTERN.test(old)) continue;
    const base = `${UNRESOLVED}.${localName(old) || "role"}`;
    let id = base;
    for (let n = 2; reshaped.has(id) || dangling.has(id); n++) id = `${base}_${n}`;
    reshaped.add(id);
    mapOf("role").set(old, id);
  }
  target.withReserved([...dangling, ...reshaped, UNRESOLVED], () => {
    // Object types first: everything else refers to them. A shadow, which
    // holds another domain's element, takes `<context>:<local name>`, its
    // context a local name too, as a 4.0 alias is.
    for (const ot of source.objectTypes) {
      const { id: _old, ...config } = ot as ObjectTypeConfig & { readonly id: string; };
      const id = ot.sourceContext !== undefined
        ? `${localName(ot.sourceContext)}:${localName(ot.name)}`
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
            const host = target.factTypesHolding([roleIds[0]!])[0];
            return (constraints ?? []).map((c) => remap(c as InternalConstraint, host));
          },
        },
      );
      record("factType", ft.id, added.id);
      (constraints ?? []).forEach((c, i) =>
        record("constraint", c.id, added.internalConstraints[i]?.id)
      );
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
      record(
        "constraint",
        c.id,
        target.addConstraint(remap(c as ExternalConstraint, undefined)).id,
      );
    }

    // After every constraint, as the readers set them.
    for (const ot of source.objectTypes) {
      const preferred = source.preferredIdentifierOf(ot.id);
      if (preferred !== undefined) {
        target.setPreferredIdentifier(to("objectType", ot.id), to("constraint", preferred));
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
  target.recordPriorIds(back);
  return target;
}

/** The fact type part of a reshaped dangling role reference. */
const UNRESOLVED = "unresolved";

/**
 * Every id the model refers to and does not define, each reference
 * checked against the kind it names; and which of them are role
 * references. A strict load admits one where it does not check the
 * reference, as for a constraint's roles.
 */
function danglingReferences(model: OrmModel): { ids: Set<string>; roles: Set<string>; } {
  const out = new Set<string>();
  const roles = new Set<string>();
  const objectType = (id: string) => model.getObjectType(id) !== undefined || out.add(id);
  const factType = (id: string) => model.getFactType(id) !== undefined || out.add(id);
  const role = (id: string) =>
    model.factTypesHolding([id]).length > 0 || (roles.add(id), out.add(id));
  const subtypeFact = (id: string) => model.getSubtypeFact(id) !== undefined || out.add(id);
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
    if (preferred !== undefined && !constraintIds.has(preferred)) out.add(preferred);
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
  return { ids: out, roles };
}
