/**
 * Serialized model summary for diagram front ends.
 *
 * The webview renders a self-contained model tree and a detail
 * inspector (diagram-ui-modernization, Phase 2) but must not hold the
 * `OrmModel` itself -- the presentation contract carries plain data
 * only. This builder derives the summary the tree and inspector need:
 * object types with the fact types they play in, fact types with
 * display-ready readings and constraint labels, and subtype links.
 * Pure and deterministic; order follows model declaration order.
 */
import type { OrmModel } from "@barwise/core";

export interface SummaryRole {
  readonly id: string;
  readonly name: string;
  readonly playerId: string;
  readonly playerName: string;
}

export interface SummaryConstraint {
  /** Traceability id; optional on the underlying constraint. */
  readonly id?: string;
  /** The constraint's type tag, e.g. "internal_uniqueness". */
  readonly type: string;
}

export interface SummaryFactType {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly SummaryRole[];
  /** Reading templates with player names substituted for placeholders. */
  readonly readings: readonly string[];
  readonly constraints: readonly SummaryConstraint[];
}

export interface SummaryObjectType {
  readonly id: string;
  readonly name: string;
  readonly kind: "entity" | "value";
  readonly referenceMode?: string;
  /** Data type label for value types, e.g. "text(50)". */
  readonly dataType?: string;
  readonly aliases?: readonly string[];
  /** Ids of the fact types this object type plays a role in. */
  readonly factTypeIds: readonly string[];
}

export interface SummarySubtype {
  readonly id: string;
  readonly subtypeId: string;
  readonly subtypeName: string;
  readonly supertypeId: string;
  readonly supertypeName: string;
  readonly providesIdentification: boolean;
}

export interface ModelSummary {
  readonly objectTypes: readonly SummaryObjectType[];
  readonly factTypes: readonly SummaryFactType[];
  readonly subtypes: readonly SummarySubtype[];
}

function dataTypeLabel(model: OrmModel, objectTypeId: string): string | undefined {
  const ot = model.getObjectType(objectTypeId);
  if (!ot?.dataType) return undefined;
  const { name, length, scale } = ot.dataType;
  if (length !== undefined && scale !== undefined) return `${name}(${length},${scale})`;
  if (length !== undefined) return `${name}(${length})`;
  return name;
}

/** Substitute player names into a reading template ("{0} has {1}"). */
function renderReading(template: string, playerNames: readonly string[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    return playerNames[Number(index)] ?? match;
  });
}

/** Derive the serializable model summary a diagram front end renders. */
export function buildModelSummary(model: OrmModel): ModelSummary {
  const playedIn = new Map<string, string[]>();
  for (const ft of model.factTypes) {
    for (const playerId of new Set(ft.roles.map((r) => r.playerId))) {
      let list = playedIn.get(playerId);
      if (!list) {
        list = [];
        playedIn.set(playerId, list);
      }
      list.push(ft.id);
    }
  }

  const objectTypes: SummaryObjectType[] = model.objectTypes.map((ot) => ({
    id: ot.id,
    name: ot.name,
    kind: ot.kind,
    ...(ot.referenceMode !== undefined && { referenceMode: ot.referenceMode }),
    ...(dataTypeLabel(model, ot.id) !== undefined && { dataType: dataTypeLabel(model, ot.id) }),
    ...(ot.aliases !== undefined && ot.aliases.length > 0 && { aliases: ot.aliases }),
    factTypeIds: playedIn.get(ot.id) ?? [],
  }));

  const factTypes: SummaryFactType[] = model.factTypes.map((ft) => {
    const playerNames = ft.roles.map((r) => model.getObjectType(r.playerId)?.name ?? r.playerId);
    return {
      id: ft.id,
      name: ft.name,
      roles: ft.roles.map((r, i) => ({
        id: r.id,
        name: r.name,
        playerId: r.playerId,
        playerName: playerNames[i]!,
      })),
      readings: ft.readings.map((reading) => renderReading(reading.template, playerNames)),
      constraints: ft.constraints.map((c) => ({
        ...(c.id !== undefined && { id: c.id }),
        type: c.type,
      })),
    };
  });

  const subtypes: SummarySubtype[] = model.subtypeFacts.map((sf) => ({
    id: sf.id,
    subtypeId: sf.subtypeId,
    subtypeName: model.getObjectType(sf.subtypeId)?.name ?? sf.subtypeId,
    supertypeId: sf.supertypeId,
    supertypeName: model.getObjectType(sf.supertypeId)?.name ?? sf.supertypeId,
    providesIdentification: sf.providesIdentification,
  }));

  return { objectTypes, factTypes, subtypes };
}
