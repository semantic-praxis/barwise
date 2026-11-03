/**
 * A format 4.0 model with some ids changed and every reference to them
 * following (iri-identity WS6, the rename's id rewrite). Pure: the input is
 * never changed. Each element is added again, in the order the readers add
 * them, with its id through the map, so a reference field nobody listed
 * here cannot be missed silently: a constraint's references go through
 * `mapConstraintReferences`, which refuses a field it does not know, and
 * `remapIds.test.ts` holds the rest to the corpus (an identity map gives
 * back the same model; a renamed id leaves nothing dangling).
 *
 * Rebuilt from the model rather than edited in the file's text, because a
 * text edit cannot tell an id from a name or a data value that happens to
 * be spelled the same.
 */
import {
  type ConstraintFileValue,
  constraintRecord,
  modelConstraint,
} from "../decode/constraint.js";
import type { Constraint } from "../model/Constraint.js";
import { toFactTypeConfig } from "../model/FactType.js";
import { mapConstraintReferences, type Reference } from "../model/mint.js";
import { toObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { ObjectTypeConfig } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import { toPopulationConfig } from "../model/Population.js";
import { toSubtypeFactConfig } from "../model/SubtypeFact.js";

/**
 * The model with each id in `ids` replaced by its value, everywhere it is
 * held or referred to. An id not in the map is kept. The model must be one
 * whose ids name one element across kinds, as every 4.0 model's do, so one
 * map serves every kind; and the map must not give two elements one id,
 * which the new model refuses.
 */
export function remapIds(source: OrmModel, ids: ReadonlyMap<string, string>): OrmModel {
  const to = (id: string): string => ids.get(id) ?? id;
  const target = new OrmModel({
    name: source.name,
    ...(source.domainContext !== undefined ? { domainContext: source.domainContext } : {}),
    ...(source.note !== undefined ? { note: source.note } : {}),
    ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
    ...(source.imports.size > 0 ? { imports: Object.fromEntries(source.imports) } : {}),
    idsAcrossKinds: true,
  });
  /** A constraint over the new ids, keeping its own id or its lack of one. */
  const remap = <C extends Constraint>(c: C): C => {
    const form = mapConstraintReferences(c, (ref: Reference) => to(ref.id));
    const record = modelConstraint(
      constraintRecord({ ...form, id: c.id === undefined ? "" : to(c.id) } as ConstraintFileValue),
    );
    if (c.id !== undefined) return record as unknown as C;
    const { id: _none, ...unnamed } = record;
    return unnamed as unknown as C;
  };

  for (const ot of source.objectTypes) {
    target.addObjectType({ ...(ot as ObjectTypeConfig), id: to(ot.id) });
  }
  for (const ft of source.factTypes) {
    const { roles, constraints, ...config } = toFactTypeConfig(ft);
    target.addFactType(
      {
        ...config,
        id: to(ft.id),
        roles: roles.map((r) => ({ ...r, id: to(r.id!), playerId: to(r.playerId) })),
        constraints: (constraints ?? []).map(remap),
      },
      { skipPlayerValidation: true },
    );
  }
  for (const sf of source.subtypeFacts) {
    const config = toSubtypeFactConfig(sf);
    target.addSubtypeFact(
      {
        ...config,
        ...(sf.id !== undefined ? { id: to(sf.id) } : {}),
        subtypeId: to(sf.subtypeId),
        supertypeId: to(sf.supertypeId),
      },
      { skipPlayerValidation: true },
    );
  }
  for (const c of source.constraints) target.addConstraint(remap(c));
  for (const ot of source.objectTypes) {
    const preferred = source.preferredIdentifierOf(ot.id);
    if (preferred !== undefined) target.setPreferredIdentifier(to(ot.id), to(preferred));
  }
  for (const o of source.objectifiedFactTypes) {
    const config = toObjectifiedFactTypeConfig(o);
    target.addObjectifiedFactType(
      {
        ...config,
        ...(o.id !== undefined ? { id: to(o.id) } : {}),
        factTypeId: to(o.factTypeId),
        objectTypeId: to(o.objectTypeId),
      },
      { skipPlayerValidation: true },
    );
  }
  for (const pop of source.populations) {
    const { instances, ...config } = toPopulationConfig(pop);
    const added = target.addPopulation(
      { ...config, id: to(pop.id), factTypeId: to(pop.factTypeId) },
      { skipPlayerValidation: true },
    );
    for (const inst of instances ?? []) {
      added.addInstance({
        ...(inst.id !== undefined ? { id: to(inst.id) } : {}),
        roleValues: Object.fromEntries(
          Object.entries(inst.roleValues).map(([role, value]) => [to(role), value]),
        ),
      });
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

  // A minted id keeps the key it was minted from under its new id, so a
  // rename does not turn a minted name into one a person chose.
  for (const id of mintedIds(source)) {
    const key = source.mintedFromOf(id)!;
    if (target.idKindsHolding(to(id)).length > 0) target.recordMintedFrom(to(id), key);
  }
  return target;
}

/** Every id in the model that holds a minted key. */
function mintedIds(model: OrmModel): string[] {
  return [
    ...model.everyConstraint().map(([c]) => c.id),
    ...model.subtypeFacts.map((sf) => sf.id),
    ...model.objectifiedFactTypes.map((o) => o.id),
  ].filter((id): id is string => id !== undefined && model.mintedFromOf(id) !== undefined);
}
