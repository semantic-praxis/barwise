/**
 * The serializer's own conflations, applied to a config so a round trip
 * can be compared field by field.
 *
 * `OrmYamlSerializer` writes a default as absence in four places, and
 * reading the document back therefore yields the default rather than the
 * value that was written:
 *
 *   1. an empty `note` (`if (ot.note)`) reads back as absent;
 *   2. `independent: false` (`if (ot.independent)`) reads back as absent,
 *      and the constructor re-defaults it to false;
 *   3. `sample: false` on a population reads back as absent, and
 *      `Population` re-defaults it to false;
 *   4. a derivation's default storage `derive_on_request` reads back as
 *      absent (`serializeDerivation`).
 *
 * These four and no others (docs/specs/core-model-laws.spec.md, WS1). A
 * fifth conflation added to the serializer must fail the round-trip law
 * rather than be absorbed here, so the generator deliberately never
 * emits the values that would exercise one -- see `model.ts`.
 *
 * Rules 1, 2 and 4 apply to the two config projections the law compares;
 * rule 3 lives on `Population`, which neither projection reaches, so the
 * law asserts it directly on the round-tripped populations.
 */

import type { FactTypeConfig } from "../../src/model/FactType.js";
import type { ObjectTypeConfig } from "../../src/model/ObjectType.js";

/** Apply conflations 1 and 2 to an object type projection. */
export function normaliseObjectTypeConfig(config: ObjectTypeConfig): ObjectTypeConfig {
  return {
    ...config,
    note: config.note === "" ? undefined : config.note,
    independent: config.independent === false ? undefined : config.independent,
  };
}

/** Apply conflations 1 and 4 to a fact type projection. */
export function normaliseFactTypeConfig(config: FactTypeConfig): FactTypeConfig {
  return {
    ...config,
    note: config.note === "" ? undefined : config.note,
    derivation: config.derivation === undefined ? undefined : {
      ...config.derivation,
      storage: config.derivation.storage === "derive_on_request"
        ? undefined
        : config.derivation.storage,
    },
  };
}

/**
 * Drop the identity plumbing the laws compare "ids aside".
 *
 * An element's own id, its roles' ids and its constraints' ids are
 * removed; every id that is a *reference* (a role's `playerId`, a
 * constraint's role ids, a join operand's root) is left alone, because
 * those are structure rather than identity.
 */
export function stripObjectTypeIds(config: ObjectTypeConfig): ObjectTypeConfig {
  return { ...config, id: undefined };
}

/** See {@link stripObjectTypeIds}. */
export function stripFactTypeIds(config: FactTypeConfig): FactTypeConfig {
  return {
    ...config,
    id: undefined,
    roles: config.roles.map((role) => ({ ...role, id: undefined })),
    constraints: config.constraints?.map((constraint) => ({ ...constraint, id: undefined })),
  };
}
