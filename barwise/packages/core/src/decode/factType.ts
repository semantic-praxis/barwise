/**
 * A fact type and its roles as a format 3.0 file states them, stated once as
 * Effect Schemas, and decoded into the `FactTypeConfig` today's reader builds
 * or into every problem with them (docs/specs/effect-adoption.spec.md, 1r,
 * R3).
 *
 * As for object types and constraints, the Schemas are written in the file's
 * own keys and make no transformation; `factTypeConfig` maps a decoded value
 * to the config. The config is what `deserializeFactType` gives the
 * `FactType` constructor, with the fact type's constraints decoded by R2's
 * internal list: the class still builds the element, and making it a record
 * is WS4's.
 *
 * **The reading rule.** Each reading names every role at least once, and no
 * role the fact type lacks, as `validateReadingTemplate` has it. It reads
 * two fields, so it is a rule the harness runs, reported at each reading at
 * fault beside the fact type's other problems -- #672 ran it on the raw
 * input after every decode instead. Like every rule, it is skipped where a
 * field it reads is of the wrong kind: `roles` or `readings` not a list,
 * or a reading not a string. Today's loader reports no more than that: its
 * schema refuses the reading and the constructor, which checks the
 * placeholders, never runs. A reading that is not a string comes from an
 * unquoted `{0}` in YAML, which a formatter or the writer prevents, so the
 * harness carries no special case for it (owner's call, 2026-10-30). A
 * blank reading is its leaf's, and the rule passes over it. With no roles
 * it says nothing: the roles list's minimum is the problem, and every
 * reading would only repeat it.
 *
 * Nothing on the load path calls this until R4.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  DerivationKind,
  DerivationRule,
  DerivationStorage,
  FactTypeConfig,
} from "../model/FactType.js";
import { validateReadingTemplate } from "../model/ReadingOrder.js";
import {
  constraintRecord,
  type DecodedInternalConstraint,
  InternalConstraintsFile,
} from "./constraint.js";
import { type DecodeProblems, decoderFor, runDecode } from "./decoder.js";
import { crossField } from "./harness.js";
import { Flag, Name, nonEmpty, notBlank, Text } from "./leaves.js";
import { type ElementLabel, elementOf, labelByNameOrId } from "./problems.js";

// -- Leaves -----------------------------------------------------------------

/** Total records, so a kind or storage added to the model fails to compile here. */
const DERIVATION_KIND_MEMBERS: Record<DerivationKind, true> = { derived: true, semiderived: true };
const DERIVATION_KINDS = Object.keys(DERIVATION_KIND_MEMBERS) as DerivationKind[];
const STORAGE_MEMBERS: Record<DerivationStorage, true> = {
  derive_on_request: true,
  derived_and_stored: true,
};
const STORAGES = Object.keys(STORAGE_MEMBERS) as DerivationStorage[];

/** A reading the constructor accepts: something left after trimming. */
const Reading = notBlank(" (a reading)");

// -- The fact type ----------------------------------------------------------

const RoleFile = Schema.Struct({ id: nonEmpty(""), player: nonEmpty(""), role_name: Name });

const DerivationFile = Schema.Struct({
  kind: Schema.Literals(DERIVATION_KINDS).annotate({
    message: `must be ${DERIVATION_KINDS.join(" or ")}.`,
  }),
  storage: Schema.optionalKey(
    Schema.Literals(STORAGES).annotate({ message: `must be ${STORAGES.join(" or ")}.` }),
  ),
  expression: Text,
  is_formal: Schema.optionalKey(Flag),
});

/**
 * Each reading names every role at least once, and no role the fact type lacks: one
 * problem per reading at fault, in the constructor's words. A blank reading
 * is its leaf's to report and is passed over, so the others are still
 * judged.
 */
const readingsFitRoles = crossField(
  { id: "readings-fit-roles", reads: ["readings.*", "roles"] },
  (ft: { readonly roles: readonly unknown[]; readonly readings: readonly unknown[]; }) => {
    // No roles is the roles list's problem; every reading would only repeat it.
    if (ft.roles.length === 0) return true;
    const issues = ft.readings.flatMap((template, i) => {
      // Every reading is a string here (the harness skips the rule otherwise);
      // the test only narrows the type.
      if (typeof template !== "string" || template.trim() === "") return [];
      const errors = validateReadingTemplate(template, ft.roles.length);
      return errors.length === 0 ? [] : [{
        path: ["readings", i],
        issue: `does not fit the fact type's ${ft.roles.length} role${
          ft.roles.length === 1 ? "" : "s"
        }: ${errors.map((e) => e.replace(/\.$/, "")).join("; ")}.`,
      }];
    });
    return issues.length === 0 ? true : issues;
  },
  "must have readings that name each of its roles.",
);

/** What a message calls a fact type: by its name, else its id. */
const describeFactType = (raw: unknown): ElementLabel => labelByNameOrId("Fact type", raw);

/** A fact type as a 3.0 file states it, its own constraints included. */
export const FactTypeFile = Schema.Struct({
  id: nonEmpty(""),
  name: Name,
  definition: Schema.optionalKey(Text),
  note: Schema.optionalKey(Text),
  roles: Schema.Array(RoleFile).check(
    Schema.isMinLength(1, { message: "must list at least one role." }),
  ),
  readings: Schema.Array(Reading).check(
    Schema.isMinLength(1, { message: "must list at least one reading." }),
  ),
  constraints: Schema.optionalKey(InternalConstraintsFile),
  derivation: Schema.optionalKey(DerivationFile),
})
  // Annotated before the rule is attached: annotating a checked Schema
  // annotates its last check, and the walk then never meets the element.
  .annotate(elementOf({ noun: "Fact type", badTag: "", describe: describeFactType }))
  .check(readingsFitRoles);

/** A decoded file fact type: exactly what the file states. */
export type FactTypeFileValue = (typeof FactTypeFile)["Type"];

// -- To the config ----------------------------------------------------------

/** A decoded fact type: the config `deserializeFactType` builds, its constraints decoded. */
export interface DecodedFactType extends FactTypeConfig {
  readonly id: string;
  readonly constraints: readonly DecodedInternalConstraint[];
}

function derivationRule(d: NonNullable<FactTypeFileValue["derivation"]>): DerivationRule {
  // A storage the file states is kept, the default included, and a false
  // `is_formal` dropped, as `deserializeDerivation` reads them.
  return {
    kind: d.kind,
    expression: d.expression,
    ...(d.storage !== undefined ? { storage: d.storage } : {}),
    ...(d.is_formal ? { isFormal: true } : {}),
  };
}

/** The config a decoded fact type stands for, as `deserializeFactType` builds it. */
export function factTypeConfig(file: FactTypeFileValue): DecodedFactType {
  return {
    id: file.id,
    name: file.name,
    ...(file.definition !== undefined ? { definition: file.definition } : {}),
    ...(file.note !== undefined ? { note: file.note } : {}),
    roles: file.roles.map((r) => ({ id: r.id, name: r.role_name, playerId: r.player })),
    readings: file.readings,
    constraints: (file.constraints ?? []).map(constraintRecord),
    ...(file.derivation !== undefined ? { derivation: derivationRule(file.derivation) } : {}),
  };
}

// -- Decoding ---------------------------------------------------------------

const decodeFile = decoderFor(FactTypeFile);

/** Decode one fact type as a 3.0 file states it. */
export function decodeFactType(doc: unknown): Effect.Effect<DecodedFactType, DecodeProblems> {
  return decodeFile(doc).pipe(Effect.map(factTypeConfig));
}

/** The synchronous boundary: the decoded fact type, or every problem thrown at once. */
export function runFactTypeDecode(doc: unknown): DecodedFactType {
  return runDecode(decodeFactType(doc));
}
