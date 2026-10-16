/**
 * A fact type and its roles as Effect Schema, as a file spells them
 * (docs/specs/effect-adoption.spec.md, WS1).
 *
 * The record is `FactTypeConfig` without its constraints: those are decoded
 * one by one by `constraintDecoder.ts`, so a fact type's own problems and
 * its constraints' problems are each reported in full, and neither hides the
 * other. The `FactType` class still builds the model element; converting it
 * to a record is WS4's, since it is mutable (`addConstraint`, the
 * `definition` setter) and used across the codebase.
 *
 * Field rules are stated on the file shape, as for constraints, because
 * Effect runs a struct's checks only once all its fields pass. The one rule
 * across fields -- every reading names each role once -- is a check on the
 * fact type, pointed at the reading it is about.
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { deserializeDerivation } from "../serialization/yaml/derivation.js";
import type { DerivationRule } from "./FactType.js";
import { invalidField } from "./problemWording.js";
import { validateReadingTemplate } from "./ReadingOrder.js";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

const RoleFile = Schema.Struct({ id: NonEmpty, player: NonEmpty, role_name: NonEmpty });

const DerivationFile = Schema.Struct({
  kind: Schema.Literals(["derived", "semiderived"]),
  storage: Schema.optionalKey(Schema.Literals(["derive_on_request", "derived_and_stored"])),
  expression: Schema.String,
  is_formal: Schema.optionalKey(Schema.Boolean),
});

/**
 * Each reading names every role, and no role the fact type lacks: one
 * problem per reading at fault, as a path and a predicate. The fact type's
 * check, and the decoder's own run of it on the raw input when Effect
 * skipped the check because another field failed.
 */
export function readingProblems(
  roleCount: number,
  readings: readonly string[],
): { readonly path: readonly PropertyKey[]; readonly issue: string; }[] {
  return readings.flatMap((template, i) => {
    const errors = validateReadingTemplate(template, roleCount);
    if (errors.length === 0) return [];
    const detail = errors.map((e) => e.replace(/\.$/, "")).join("; ");
    return [{ path: ["readings", i], issue: invalidField(["readings", i], detail) }];
  });
}

const readingsFitRoles = Schema.makeFilter(
  (ft: { readonly roles: readonly unknown[]; readonly readings: readonly string[]; }) =>
    readingProblems(ft.roles.length, ft.readings),
);

const FactTypeFile = Schema.Struct({
  id: NonEmpty,
  name: NonEmpty,
  definition: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  roles: Schema.Array(RoleFile).check(Schema.isMinLength(1)),
  readings: Schema.Array(NonEmpty).check(Schema.isMinLength(1)),
  // Decoded on their own, by the constraint decoder; here only a list.
  constraints: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  derivation: Schema.optionalKey(DerivationFile),
}).check(readingsFitRoles);

/** A fact type as decoded: `FactTypeConfig` without its constraints. */
const FactTypeRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  definition: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  roles: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, playerId: Schema.String }),
  ),
  readings: Schema.Array(Schema.String),
  derivation: Schema.optionalKey(Schema.Unknown),
});

export type FactTypeRecord = Omit<typeof FactTypeRecord.Type, "derivation"> & {
  readonly derivation?: DerivationRule;
};

/**
 * A fact type as a file spells it, read into its record. Its `constraints`
 * are dropped here: the loader decodes them separately and adds them back.
 * Encoding is not used (writing stays with the hand-written serializer, so
 * S2's bytes cannot move); the inverse is given only because a
 * transformation needs one, and it does not write a derivation.
 */
const read = (f: typeof FactTypeFile.Type): typeof FactTypeRecord.Encoded => ({
  id: f.id,
  name: f.name,
  ...(f.definition !== undefined ? { definition: f.definition } : {}),
  ...(f.note !== undefined ? { note: f.note } : {}),
  roles: f.roles.map((r) => ({ id: r.id, name: r.role_name, playerId: r.player })),
  readings: f.readings,
  ...(f.derivation !== undefined ? { derivation: deserializeDerivation(f.derivation) } : {}),
});

const write = (r: typeof FactTypeRecord.Encoded): typeof FactTypeFile.Type => ({
  id: r.id,
  name: r.name,
  ...(r.definition !== undefined ? { definition: r.definition } : {}),
  ...(r.note !== undefined ? { note: r.note } : {}),
  roles: r.roles.map((role) => ({ id: role.id, player: role.playerId, role_name: role.name })),
  readings: r.readings,
});

export const FactTypeYamlCodec = FactTypeFile.pipe(
  Schema.decodeTo(FactTypeRecord, SchemaTransformation.transform({ decode: read, encode: write })),
);
