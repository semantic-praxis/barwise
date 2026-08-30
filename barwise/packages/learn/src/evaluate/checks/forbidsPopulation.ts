import {
  type Constraint,
  evaluateConstraintEnforcement,
  type FactType,
  isDisjunctiveMandatory,
  isExternalUniqueness,
  isFrequency,
  isInternalUniqueness,
  isMandatoryRole,
  isRing,
  isValueConstraint,
  type OrmModel,
  type PopulationConfig,
} from "@barwise/core";
import { generateCounterexampleForConstraint } from "@barwise/core/counterexample";
import type { ConstraintKind, NameLicence } from "../../exercise/types.js";
import type { CheckResult } from "../GymReport.js";
import {
  correspondingFactTypes,
  entityFoldMappings,
  mapForbiddenPopulation,
  projectionMappings,
} from "../populationMapping.js";

/** Which constraint in the REFERENCE model the check names. One kind, one guard. */
const GUARDS: Record<ConstraintKind, (c: Constraint) => boolean> = {
  internal_uniqueness: isInternalUniqueness,
  mandatory: isMandatoryRole,
  value: isValueConstraint,
  frequency: isFrequency,
  ring: isRing,
};

const fail = (message: string, hint?: string): CheckResult => ({
  kind: "forbids_population",
  passed: false,
  message,
  hint,
});

/**
 * Which of the CANDIDATE's constraints answer to a reference constraint
 * kind.
 *
 * Two guards per kind wherever a candidate can express the same rule in a
 * wider form: a model that says "employee number is unique across the
 * company" as an external uniqueness has expressed the rule, and refusing
 * it is the false-miss shape barwise-892 and barwise-896 both fixed.
 *
 * This replaces `REJECTING_RULES`, a map from kind to the `population/*`
 * rule ids that counted as rejection. That map restated strings core owns,
 * so a rename there would have emptied one kind's accept-list silently and
 * made every check of that kind vacuous again -- which is why it needed
 * `tests/rejectingRulesDrift.test.ts` to guard it. These are core's own
 * exported type guards: a rename fails the build instead (barwise-904).
 *
 * The two widened rows are carried forward from that map and are, on
 * measurement, unexercised: dropping either changes no test, no
 * discrimination count, and no score on any of the 192 committed
 * payloads. They stay because deleting a false-miss guard on the grounds
 * that nothing currently trips it is how barwise-892 and barwise-896 come
 * back on a candidate nobody has seen yet. Tracked as barwise-911.
 */
const CANDIDATE_GUARDS: Record<ConstraintKind, readonly ((c: Constraint) => boolean)[]> = {
  internal_uniqueness: [isInternalUniqueness, isExternalUniqueness],
  mandatory: [isMandatoryRole, isDisjunctiveMandatory],
  value: [isValueConstraint],
  frequency: [isFrequency],
  ring: [isRing],
};

/**
 * Every (fact type, constraint) pair in the candidate that could carry
 * the rule, for one set of populations about to be injected.
 *
 * Two sources, and the asymmetry between them is load-bearing.
 * `correspondents` is the candidate's answer to the fact type the check
 * NAMES; it is the only source for `mandatory`, because a mandatory
 * counterexample mints a fresh entity in an ANCHOR fact type, so the
 * fact type injected into is by construction not the one carrying the
 * rule, and every other mandatory constraint in the candidate fires on
 * those minted players -- the noise that left 12 of 43 checks vacuous
 * (barwise-894). `correspondingFactTypes` also excludes the entity-fold
 * tier for the same reason: a fold absorbs value roles into an entity,
 * so the reference's mandatory role has no counterpart to be mandatory
 * on.
 *
 * For every other kind the population lands in the very fact type whose
 * constraint should reject it, and that fact type may be one no
 * correspondence tier admits -- a wider ternary, or an objectified
 * shape. Those are legitimate carriers of the same rule
 * (docs/specs/wider-shape-correspondence.spec.md), so the injected fact
 * types join the set.
 */
function constraintsUnderTest(
  candidate: OrmModel,
  correspondents: readonly FactType[],
  configs: readonly PopulationConfig[],
  kind: ConstraintKind,
): Array<{ readonly ft: FactType; readonly c: Constraint; }> {
  const carriers = new Map<string, FactType>();
  for (const ft of correspondents) carriers.set(ft.id, ft);
  if (kind !== "mandatory") {
    for (const cfg of configs) {
      const ft = candidate.getFactType(cfg.factTypeId);
      if (ft) carriers.set(ft.id, ft);
    }
  }

  const guards = CANDIDATE_GUARDS[kind];
  const pairs: Array<{ ft: FactType; c: Constraint; }> = [];
  for (const ft of carriers.values()) {
    for (const c of ft.constraints) {
      if (guards.some((g) => g(c))) pairs.push({ ft, c });
    }
  }
  return pairs;
}

/**
 * Add the given populations to the candidate, ask each constraint under
 * test whether IT rejects them, then remove them again (the candidate is
 * left unchanged).
 *
 * Before barwise-904 this had to infer the answer: it collected
 * error-severity `population/*` diagnostics from a model-wide
 * `validate()`, filtered them by rule id, decided by inspecting
 * `elementId` whether each one named the right fact type, and took a
 * before/after multiset delta to separate what the injection caused from
 * what the candidate's own data already violated. Three layers, all
 * compensating for a question core could not be asked directly. Two are
 * gone: `evaluateConstraintEnforcement` names the constraint, so rule-id
 * filtering and attribution are the call itself.
 *
 * The delta stays, and is not a leftover. A candidate whose own
 * populations already violate its constraints would otherwise pass every
 * check of that kind vacuously -- the constraint rejects, but not because
 * of anything this check injected. Comparing the SAME constraint's
 * diagnostics before and after is what "the injection caused this" means,
 * and it is now per-constraint rather than model-wide
 * (barwise-895, docs/specs/population-blind-rejection.spec.md).
 */
function candidateRejects(
  candidate: OrmModel,
  configs: PopulationConfig[],
  under: ReadonlyArray<{ readonly ft: FactType; readonly c: Constraint; }>,
): boolean {
  if (under.length === 0) return false;

  const errorCounts = (ft: FactType, c: Constraint): Map<string, number> => {
    const counts = new Map<string, number>();
    const verdict = evaluateConstraintEnforcement(candidate, ft, c);
    if (!verdict.enforced) return counts;
    for (const d of verdict.diagnostics) {
      if (d.severity !== "error") continue;
      const key = JSON.stringify([d.ruleId, d.elementId, d.message]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const before = under.map(({ ft, c }) => errorCounts(ft, c));
  const addedIds: string[] = [];
  try {
    for (const cfg of configs) addedIds.push(candidate.addPopulation(cfg).id);
    for (const [i, { ft, c }] of under.entries()) {
      const was = before[i]!;
      for (const [key, count] of errorCounts(ft, c)) {
        if (count > (was.get(key) ?? 0)) return true;
      }
    }
    return false;
  } finally {
    for (const id of addedIds) candidate.removePopulation(id);
  }
}

/**
 * Pass iff the candidate rejects the population the named reference
 * constraint forbids. The population is derived from the reference model
 * (via `generateCounterexampleForConstraint`) and mapped onto the
 * candidate, so a candidate that has not encoded the constraint -- or has
 * not modeled the relationship at all -- fails, with a concrete message.
 */
export function forbidsPopulation(
  candidate: OrmModel,
  reference: OrmModel | undefined,
  factTypeName: string,
  constraintKind: ConstraintKind,
  hint?: string,
  licence?: NameLicence,
): CheckResult {
  if (!reference) {
    return fail(`This check needs a reference model, but the exercise declares none.`);
  }

  const refFt = reference.getFactTypeByName(factTypeName);
  if (!refFt) {
    return fail(`The reference model has no fact type named "${factTypeName}" (exercise error).`);
  }

  const constraint = refFt.constraints.find(GUARDS[constraintKind]);
  if (!constraint) {
    return fail(
      `The reference fact type "${factTypeName}" has no ${constraintKind} constraint (exercise error).`,
    );
  }

  const counterexample = generateCounterexampleForConstraint(constraint, refFt, reference);
  if (!counterexample || counterexample.forbidden.length === 0) {
    return fail(
      `Could not generate a forbidden population for the ${constraintKind} constraint on `
        + `"${factTypeName}" (unsupported constraint shape).`,
    );
  }

  // Map each forbidden population. The flat and expansion tiers give
  // at most one mapping; when they find none, the projection tier may
  // offer several wider carriers, each tried in turn -- the check
  // passes on the first attempt whose injection the candidate rejects
  // (docs/specs/wider-shape-correspondence.spec.md).
  const options: PopulationConfig[][] = [];
  const carriersTried: string[] = [];
  for (const pop of counterexample.forbidden) {
    const mapped = mapForbiddenPopulation(pop, reference, candidate, licence);
    if (mapped) {
      options.push([mapped]);
      continue;
    }
    const projected = projectionMappings(pop, reference, candidate, licence);
    if (projected.length > 0) {
      options.push(projected.map((p) => p.config));
      for (const p of projected) {
        if (!carriersTried.includes(p.candFt.name)) carriersTried.push(p.candFt.name);
      }
      continue;
    }
    const folded = entityFoldMappings(pop, reference, candidate, licence);
    if (folded.length > 0) {
      options.push(folded.map((f) => f.config));
      continue;
    }
    return fail(
      `Your model does not yet carry the relationship this rule guards `
        + `(no fact type matching "${factTypeName}"), so it cannot rule out: ${counterexample.text}`,
      hint,
    );
  }

  // The constraint under test lives on the candidate correspondent of
  // the fact type the check NAMES -- not on whichever fact type the
  // population was injected into. For mandatory those differ by
  // construction: the counterexample mints a fresh entity in an anchor
  // fact type, and the rule it breaks is the mandatory one back on the
  // named fact type (barwise-894).
  const correspondents = correspondingFactTypes(refFt, reference, candidate, licence);
  for (const configs of combinations(options)) {
    const under = constraintsUnderTest(candidate, correspondents, configs, constraintKind);
    if (candidateRejects(candidate, configs, under)) {
      return {
        kind: "forbids_population",
        passed: true,
        message: `Your model correctly rules out: ${counterexample.text}`,
      };
    }
  }

  if (carriersTried.length > 0) {
    const named = carriersTried.map((n) => `"${n}"`).join(" or ");
    return fail(
      `Your model still allows what it should forbid: ${counterexample.text} `
        + `(possibly carried in the wider fact type ${named}, whose constraints `
        + `do not forbid this population)`,
      hint,
    );
  }
  return fail(`Your model still allows what it should forbid: ${counterexample.text}`, hint);
}

/**
 * Every way of picking one config per population, first list varying
 * slowest. Almost always a single one-element list -- only a population
 * that mapped through the projection tier contributes alternatives.
 */
function* combinations(options: PopulationConfig[][]): Generator<PopulationConfig[]> {
  if (options.length === 0) {
    yield [];
    return;
  }
  const [head, ...rest] = options;
  for (const config of head!) {
    for (const tail of combinations(rest)) {
      yield [config, ...tail];
    }
  }
}
