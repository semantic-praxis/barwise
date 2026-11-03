/**
 * A NORMA import with its local names mapped back to the NORMA ids each
 * element was built under (iri-identity 6c). The mapper's tests assert
 * which NORMA element became which -- an exclusive-or kept once under its
 * exclusion, a duplicate dropped, a cardinality given its role's id -- and
 * read those choices most plainly in NORMA's ids. This runs the whole
 * import, replay included, and then core's `remapIds` over the replay's own
 * map, so a test of the mapper's choices still covers the path that names
 * the model. `NormaLocalNames.test.ts` asserts the names themselves.
 */
import type { OrmModel } from "@barwise/core";
import { remapIds } from "@barwise/core/rename";
import { mapNormaToOrmWithIds } from "../../src/norma/NormaToOrmMapper.js";
import type { NormaDocument } from "../../src/norma/NormaXmlTypes.js";

export function mapUnderNormaIds(doc: NormaDocument): OrmModel {
  const { model, priorIds } = mapNormaToOrmWithIds(doc);
  return remapIds(model, priorIds);
}
