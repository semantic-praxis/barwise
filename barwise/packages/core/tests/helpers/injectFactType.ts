/**
 * Put a fact type into a model past `addFactType`'s refusals, for a test
 * that needs a state no public path builds (two fact types under one
 * name). It stores the fact type the way `addFactType` does -- its id and
 * every role and constraint id held in the model's id index, and the fact
 * type joined -- so the index agrees with the stores and a later add mints
 * against what is really there (barwise-wcg.f1s).
 */
import type { FactType } from "../../src/model/FactType.js";
import type { IdIndex } from "../../src/model/idIndex.js";
import { idsWithin, type OrmModel } from "../../src/model/OrmModel.js";

interface ModelInternals {
  readonly _factTypes: { set(ft: FactType): void; };
  readonly _ids: IdIndex;
  readonly _admission: Parameters<FactType["joinModel"]>[0];
}

export function injectFactType(model: OrmModel, ft: FactType): void {
  const m = model as unknown as ModelInternals;
  m._factTypes.set(ft);
  for (const [id, kind] of idsWithin(ft)) m._ids.hold(id, kind);
  ft.joinModel(m._admission);
}
