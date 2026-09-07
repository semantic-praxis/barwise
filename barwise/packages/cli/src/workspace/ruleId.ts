/**
 * Rule identifiers this surface mints itself.
 *
 * Core owns the identifiers its validation rules emit and knows nothing
 * about this file; the CLI reports one condition core cannot, because
 * resolving a project's files happens before there is a model to
 * validate. So the CLI declares its own registry of the same shape and
 * widens at the point of use -- `Diagnostic<RuleId | CliRuleId>` -- and
 * a third surface would do the same without either of them changing.
 *
 * A global registry (TypeScript's declaration-merging idiom) would have
 * spared the widening, at the price of every package seeing every
 * other's identifiers whether or not it depends on them, and of making
 * an exhaustive switch over core's `RuleId` impossible. The reasoning
 * is in `docs/specs/closed-sets-as-unions.spec.md`, WS2.
 *
 * The `Record` is the completeness idiom core uses, kept here so this
 * registry earns the same guarantee: the union is derived from it, and
 * a descriptor is required rather than optional, so an identifier
 * cannot be added without being described.
 */

import type { RuleDescriptor } from "@barwise/core";

const CLI_RULE_DESCRIPTORS = {
  "project/file-unresolved": {
    severity: "error",
    description:
      "A project file could not be resolved to a model, so its domain was skipped rather than validated.",
  },
} as const satisfies Record<string, RuleDescriptor>;

/** Every rule identifier the CLI mints itself. */
export type CliRuleId = keyof typeof CLI_RULE_DESCRIPTORS;

/** Every CLI-minted rule identifier, in declaration order. */
export const CLI_RULE_IDS = Object.keys(CLI_RULE_DESCRIPTORS) as readonly CliRuleId[];

/** The descriptor for a CLI-minted rule identifier. */
export function cliRuleDescriptor(id: CliRuleId): RuleDescriptor {
  return CLI_RULE_DESCRIPTORS[id];
}
