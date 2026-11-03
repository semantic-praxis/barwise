/**
 * NORMA XML with every id the writer derived from a model id (decision
 * 12(a): `_` and a UUID) spelled back as `_<model id>`. A test that edits
 * exported XML by id -- drops a shape, duplicates a constraint, moves a
 * role reference -- then names what it edits, as a hand-written NORMA file
 * would, and the import reads those ids as any NORMA ids. Every NCName is a
 * NORMA id, so the rewritten file is one NORMA could have written; each
 * model id these tests use is an NCName once prefixed. A derived id with a
 * suffix (`<id>_ro0`) follows, since the replacement is by substring and
 * each UUID is unique.
 */
import type { OrmModel } from "@barwise/core";
import { toNormaId } from "../../src/norma/normaId.js";

function modelIds(model: OrmModel): string[] {
  return [
    ...model.objectTypes.map((ot) => ot.id),
    ...model.factTypes.flatMap((ft) => [ft.id, ...ft.roles.map((r) => r.id)]),
    ...model.everyConstraint().flatMap(([c]) => c.id ?? []),
    ...model.subtypeFacts.flatMap((sf) => sf.id ?? []),
    ...model.objectifiedFactTypes.flatMap((o) => o.id ?? []),
  ];
}

export function readableNormaIds(xml: string, model: OrmModel): string {
  let out = xml;
  for (const id of modelIds(model)) out = out.split(toNormaId(id)).join(`_${id}`);
  return out;
}
