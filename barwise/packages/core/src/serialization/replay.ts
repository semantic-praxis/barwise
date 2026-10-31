/**
 * The 3.x and 2.0 replay into format 4.0 (iri-identity WS6, 6b-2b-2a): a
 * model read from a 3.0 file, or by the 2.0 reader, added element by
 * element to a fresh model that names what it is given. Every id the old
 * model held is dropped and every reference goes through the growing map
 * from old id to new, so a 3.x file's UUIDs become local names and nothing
 * else moves. A reference the old model never defined, which only a
 * lenient load admits, is carried across as written, so validation
 * reports it as it does today.
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
import { mapConstraintReferences, mintedName, type Reference } from "../model/mint.js";
import { localName } from "../model/name.js";
import { toObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { ObjectTypeConfig } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import { toPopulationConfig } from "../model/Population.js";
import { toSubtypeFactConfig } from "../model/SubtypeFact.js";

/** A replayed model, and the map from each old id to the id it now has. */
export interface Replayed {
  readonly model: OrmModel;
  readonly ids: ReadonlyMap<string, string>;
}

/** Replay a 3.x model into format 4.0's ids. Pure: one model gives one result. */
export function replayInto40(source: OrmModel): Replayed {
  const target = new OrmModel({
    name: source.name,
    ...(source.domainContext !== undefined ? { domainContext: source.domainContext } : {}),
    ...(source.note !== undefined ? { note: source.note } : {}),
    ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
    idsAcrossKinds: true,
  });
  const ids = new Map<string, string>();
  const to = (id: string): string => ids.get(id) ?? id;
  const record = (from: string | undefined, now: string | undefined) => {
    if (from !== undefined && now !== undefined) ids.set(from, now);
  };
  /**
   * The constraint over the new ids, without its id when the model can name
   * it. One it cannot -- a malformed constraint, an internal one naming
   * another fact type's role -- keeps its old id: the model would otherwise
   * give it a generated one, and the replay must give one model for one
   * input. (At the switch to the 4.0 writer such a constraint is left
   * unnamed instead, 6b-2b-2b.)
   */
  const remap = <C extends Constraint>(c: C, host: FactType | undefined): C => {
    const form = mapConstraintReferences(c, (ref: Reference) => to(ref.id));
    const { id: _dropped, ...rest } = modelConstraint(
      constraintRecord({ ...form, id: "" } as unknown as ConstraintFileValue),
    );
    const named = mintedName(
      { kind: "constraint", inView: [rest, host] as ConstraintInView },
      target,
    );
    return (named === undefined && c.id !== undefined
      ? { ...rest, id: c.id }
      : rest) as unknown as C;
  };

  // Object types first: everything else refers to them. A shadow, which
  // holds another domain's element, takes `<context>:<local name>`.
  for (const ot of source.objectTypes) {
    const { id: _old, ...config } = ot as ObjectTypeConfig & { readonly id: string; };
    const id = ot.sourceContext !== undefined
      ? `${ot.sourceContext}:${localName(ot.name)}`
      : undefined;
    record(ot.id, target.addObjectType({ ...config, ...(id ? { id } : {}) }).id);
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
        roles: roles.map(({ id: _role, ...r }) => ({ ...r, playerId: to(r.playerId) })),
      },
      {
        skipPlayerValidation: true,
        suffixRepeatedRoleNames: true,
        idFromFirstReading: by !== undefined && localName(ft.name) === to(by),
        constraintsOver: (roleIds) => {
          ft.roles.forEach((r, i) => record(r.id, roleIds[i]));
          const host = target.factTypesHolding([roleIds[0]!])[0];
          return (constraints ?? []).map((c) => remap(c as InternalConstraint, host));
        },
      },
    );
    record(ft.id, added.id);
    (constraints ?? []).forEach((c, i) => record(c.id, added.internalConstraints[i]?.id));
  }

  for (const sf of source.subtypeFacts) {
    const { id: _old, ...config } = toSubtypeFactConfig(sf);
    const added = target.addSubtypeFact(
      { ...config, subtypeId: to(sf.subtypeId), supertypeId: to(sf.supertypeId) },
      { skipPlayerValidation: true },
    );
    record(sf.id, added.id);
  }

  for (const c of source.constraints) {
    record(c.id, target.addConstraint(remap(c as ExternalConstraint, undefined)).id);
  }

  // After every constraint, as the readers set them.
  for (const ot of source.objectTypes) {
    const preferred = source.preferredIdentifierOf(ot.id);
    if (preferred !== undefined) target.setPreferredIdentifier(to(ot.id), to(preferred));
  }

  for (const o of source.objectifiedFactTypes) {
    const { id: _old, ...config } = toObjectifiedFactTypeConfig(o);
    const added = target.addObjectifiedFactType(
      { ...config, factTypeId: to(o.factTypeId), objectTypeId: to(o.objectTypeId) },
      { skipPlayerValidation: true },
    );
    record(o.id, added.id);
  }

  for (const pop of source.populations) {
    const { id: _old, instances, ...config } = toPopulationConfig(pop);
    const added = target.addPopulation(
      { ...config, factTypeId: to(pop.factTypeId) },
      { skipPlayerValidation: true },
    );
    record(pop.id, added.id);
    for (const inst of instances ?? []) {
      const roleValues = Object.fromEntries(
        Object.entries(inst.roleValues).map(([role, value]) => [to(role), value]),
      );
      record(inst.id, added.addInstance({ roleValues }).id);
    }
  }

  for (const d of source.definitions) target.addDefinition(d);
  for (const layout of source.diagramLayouts) {
    const keyed = <V>(rec: Readonly<Record<string, V>>) =>
      Object.fromEntries(Object.entries(rec).map(([k, v]) => [to(k), v]));
    target.addDiagramLayout({
      ...layout,
      ...(layout.elements !== undefined ? { elements: layout.elements.map(to) } : {}),
      positions: keyed(layout.positions),
      orientations: keyed(layout.orientations),
    });
  }

  target.recordPriorIds(new Map([...ids].map(([from, now]) => [now, from])));
  return { model: target, ids };
}
