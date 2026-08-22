/**
 * Deterministic conformance validation for LLM extraction responses.
 *
 * Applies structural checks against ORM 2 invariants to the raw
 * ExtractionResponse before the DraftModelParser consumes it. Fixes
 * issues where possible and records corrections for visibility.
 *
 * All checks are deterministic code -- no LLM calls.
 */

import type {
  ExtractedPopulation,
  ExtractedRole,
  ExtractedSubtype,
  ExtractionResponse,
  InferredConstraint,
} from "./ExtractionTypes.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConformanceCorrection {
  /** Category identifier for the check that triggered this correction. */
  readonly category: string;
  /** Human-readable explanation of what was fixed. */
  readonly description: string;
  /** Name of the affected element (fact type, constraint, etc.). */
  readonly element?: string;
}

export interface ConformanceResult {
  /** The cleaned extraction response. */
  readonly response: ExtractionResponse;
  /** Corrections that were applied. */
  readonly corrections: readonly ConformanceCorrection[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Validate an ExtractionResponse against ORM 2 structural invariants
 * and return a cleaned copy with a report of corrections made.
 */
export function enforceConformance(
  input: ExtractionResponse,
): ConformanceResult {
  const corrections: ConformanceCorrection[] = [];

  const objectTypeNames = new Set(input.object_types.map((ot) => ot.name));
  const factTypeNames = new Set(input.fact_types.map((ft) => ft.name));

  // Build sets for identifier fact type detection. An identifier fact
  // type links an entity (with a reference_mode) to its identifying
  // value type. It must be a binary fact type where one role player is
  // an entity with a reference_mode and the other is a value type.
  const entityRefModes = new Map<string, string>();
  const allEntityNames = new Set<string>();
  const valueTypeNames = new Set<string>();
  for (const ot of input.object_types) {
    if (ot.kind === "entity") {
      allEntityNames.add(ot.name);
      if (ot.reference_mode) {
        entityRefModes.set(ot.name, ot.reference_mode);
      }
    } else {
      valueTypeNames.add(ot.name);
    }
  }

  const identifierFactTypes = new Set<string>();
  const identifierFactTypeEntities = new Set<string>();
  const identifierFactByEntity = new Map<
    string,
    { readonly factType: string; readonly valueType: string; }
  >();
  for (const ft of input.fact_types) {
    if (ft.roles.length === 2) {
      const [r0, r1] = ft.roles;
      // An identifier fact type has one entity (with reference_mode)
      // and one value type.
      const r0IsRefEntity = entityRefModes.has(r0!.player);
      const r1IsRefEntity = entityRefModes.has(r1!.player);
      const r0IsValue = valueTypeNames.has(r0!.player);
      const r1IsValue = valueTypeNames.has(r1!.player);
      if (r0IsRefEntity && r1IsValue) {
        identifierFactTypes.add(ft.name);
        identifierFactTypeEntities.add(r0!.player);
        if (!identifierFactByEntity.has(r0!.player)) {
          identifierFactByEntity.set(r0!.player, {
            factType: ft.name,
            valueType: r1!.player,
          });
        }
      } else if (r1IsRefEntity && r0IsValue) {
        identifierFactTypes.add(ft.name);
        identifierFactTypeEntities.add(r1!.player);
        if (!identifierFactByEntity.has(r1!.player)) {
          identifierFactByEntity.set(r1!.player, {
            factType: ft.name,
            valueType: r0!.player,
          });
        }
      }
    }
  }

  // --- Check populations ---
  const rolesByFactType = new Map(input.fact_types.map((ft) => [ft.name, ft.roles]));

  const cleanedPopulations = cleanPopulations(
    input.populations ?? [],
    factTypeNames,
    input,
    rolesByFactType,
    corrections,
  );

  // --- Repair: entailed identifier-population instances ---
  const repairedPopulations = repairIdentifierPopulations(
    cleanedPopulations,
    input,
    identifierFactByEntity,
    corrections,
  );

  // Build the set of valid role identifiers. The parser resolves
  // constraint roles by object type name (player) or by role name,
  // so both are valid.
  const validRoleIdentifiers = new Set(objectTypeNames);
  for (const ft of input.fact_types) {
    for (const role of ft.roles) {
      validRoleIdentifiers.add(role.role_name);
    }
  }

  // --- Check constraints ---
  const cleanedConstraints = cleanConstraints(
    input.inferred_constraints,
    objectTypeNames,
    validRoleIdentifiers,
    identifierFactTypes,
    rolesByFactType,
    corrections,
  );

  // --- Check subtype cycles ---
  const cleanedSubtypes = cleanSubtypes(input.subtypes, corrections);

  // --- Check reference_mode without identifier fact type ---
  checkOrphanedReferenceModes(
    entityRefModes,
    identifierFactTypeEntities,
    corrections,
  );

  return {
    response: {
      ...input,
      subtypes: cleanedSubtypes,
      populations: repairedPopulations,
      inferred_constraints: cleanedConstraints,
    },
    corrections,
  };
}

// ---------------------------------------------------------------------------
// Identifier-population repair
// ---------------------------------------------------------------------------

/**
 * Synthesize the identifier-population instances the emitted examples
 * entail. An entity instance denoted by a value ("S-100") has that value
 * as its identifier by definition of its reference mode, so whenever a
 * population mentions an entity value that no population of the entity's
 * identifier fact type carries, the identity bijection instance
 * (entity = value, identifier = value) is appended and a correction is
 * recorded. Only values already present in the payload are used --
 * nothing is invented -- and entities whose reference mode is orphaned
 * (no identifier fact type) are untouched, staying detect-only.
 */
function repairIdentifierPopulations(
  populations: readonly ExtractedPopulation[],
  input: ExtractionResponse,
  identifierFactByEntity: ReadonlyMap<
    string,
    { readonly factType: string; readonly valueType: string; }
  >,
  corrections: ConformanceCorrection[],
): ExtractedPopulation[] {
  if (populations.length === 0 || identifierFactByEntity.size === 0) {
    return [...populations];
  }

  const factTypesByName = new Map(input.fact_types.map((ft) => [ft.name, ft]));

  // Values already covered by a population of each identifier fact type.
  // Coverage is checked against every role value of the instance, so an
  // instance keyed by role name instead of player name still counts.
  const covered = new Map<string, Set<string>>();
  for (const pop of populations) {
    for (const inst of pop.instances) {
      let set = covered.get(pop.fact_type);
      if (!set) {
        set = new Set();
        covered.set(pop.fact_type, set);
      }
      for (const value of Object.values(inst.role_values)) set.add(value);
    }
  }

  // Entity values mentioned anywhere but missing from their identifier
  // fact type's population, keyed by entity, in first-mention order.
  const missing = new Map<string, { values: string[]; sourcePop: ExtractedPopulation; }>();
  for (const pop of populations) {
    const ft = factTypesByName.get(pop.fact_type);
    if (!ft) continue;
    for (const role of ft.roles) {
      const identifier = identifierFactByEntity.get(role.player);
      if (!identifier) continue;
      for (const inst of pop.instances) {
        const value = inst.role_values[role.player];
        if (value === undefined) continue;
        if (covered.get(identifier.factType)?.has(value)) continue;
        let entry = missing.get(role.player);
        if (!entry) {
          entry = { values: [], sourcePop: pop };
          missing.set(role.player, entry);
        }
        if (!entry.values.includes(value)) entry.values.push(value);
      }
    }
  }
  if (missing.size === 0) return [...populations];

  const result = populations.map((pop) => ({ ...pop, instances: [...pop.instances] }));
  for (const [entity, entry] of missing) {
    const identifier = identifierFactByEntity.get(entity)!;
    const instances = entry.values.map((value) => ({
      role_values: { [entity]: value, [identifier.valueType]: value },
    }));
    for (const value of entry.values) {
      corrections.push({
        category: "missing_identifier_population",
        description: `Added the entailed identifier instance "${value}" to the population of `
          + `"${identifier.factType}": the value appears in the population of "${entry.sourcePop.fact_type}" `
          + `but not in its identifier fact type's population.`,
        element: identifier.factType,
      });
    }
    const existing = result.find((pop) => pop.fact_type === identifier.factType);
    if (existing) {
      existing.instances.push(...instances);
    } else {
      result.push({
        fact_type: identifier.factType,
        description:
          `Identifier instances entailed by the examples in "${entry.sourcePop.fact_type}".`,
        instances,
        source_references: entry.sourcePop.source_references,
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Population checks
// ---------------------------------------------------------------------------

function cleanPopulations(
  populations: readonly ExtractedPopulation[],
  factTypeNames: Set<string>,
  input: ExtractionResponse,
  rolesByFactType: ReadonlyMap<string, readonly ExtractedRole[]>,
  corrections: ConformanceCorrection[],
): ExtractedPopulation[] {
  const result: ExtractedPopulation[] = [];

  for (const pop of populations) {
    // Check 1: Empty instances
    if (pop.instances.length === 0) {
      corrections.push({
        category: "empty_population",
        description: `Removed population for "${pop.fact_type}" with no instances.`,
        element: pop.fact_type,
      });
      continue;
    }

    // Check 2: Nonexistent fact type
    if (!factTypeNames.has(pop.fact_type)) {
      corrections.push({
        category: "orphaned_population",
        description: `Removed population referencing nonexistent fact type "${pop.fact_type}".`,
        element: pop.fact_type,
      });
      continue;
    }

    // Check 3: Population duplicating a value constraint
    if (isDuplicateOfValueConstraint(pop, input)) {
      corrections.push({
        category: "duplicate_value_constraint_population",
        description:
          `Removed population for "${pop.fact_type}" that duplicates a value constraint.`,
        element: pop.fact_type,
      });
      continue;
    }

    // Check 3b: Instances that cannot fill every role
    //
    // `population/incomplete-instance` is an error in the validator, so
    // an instance short a role value cost 0.1 and nothing here caught
    // it -- the fourth instance of the class barwise-826 named. The
    // instance is dropped rather than the population: a population of
    // five good instances and one bad one is mostly evidence, and
    // discarding the five to punish the one is the opposite of what
    // sample semantics were introduced to do
    // (docs/specs/population-instance-completeness.spec.md).
    const roles = rolesByFactType.get(pop.fact_type) ?? [];
    const complete = pop.instances.filter((inst) => {
      const missing = missingRoles(roles, inst.role_values);
      if (missing.length === 0) return true;
      corrections.push({
        category: "incomplete_instance",
        description: `Removed an incomplete instance of "${pop.fact_type}" -- no value for `
          + `${missing.map((m) => `"${m}"`).join(", ")}. Every instance must fill every role.`,
        element: pop.fact_type,
      });
      return false;
    });

    // Dropping every instance takes the population with it, but charges
    // nothing further: the instance corrections above already name the
    // defect, and an empty population here is our own consequence
    // rather than a second thing the extraction did wrong. Check 1
    // charges for a population the model itself emitted empty, which is
    // a different claim.
    if (complete.length === 0) continue;

    result.push(complete.length === pop.instances.length ? pop : { ...pop, instances: complete });
  }

  return result;
}

/**
 * Which roles an instance supplies no value for.
 *
 * A key may name a role or a player, and a role already claimed by an
 * earlier key cannot be claimed again -- the resolution `parsePopulations`
 * performs, mirrored here so conformance judges what the parser will
 * actually build. On a self-referencing fact type the two disagree
 * loudly: `{"Employee": "Alice"}` fills one role of two, which is the
 * case this check exists to price at 0.02 instead of 0.1.
 */
function missingRoles(
  roles: readonly ExtractedRole[],
  roleValues: Readonly<Record<string, string>>,
): string[] {
  const claimed = new Set<number>();
  for (const hint of Object.keys(roleValues)) {
    const lower = hint.toLowerCase();
    let i = roles.findIndex(
      (r, idx) => !claimed.has(idx) && r.role_name?.toLowerCase() === lower,
    );
    if (i === -1) i = roles.findIndex((r, idx) => !claimed.has(idx) && r.player === hint);
    if (i !== -1) claimed.add(i);
  }
  return roles
    .map((r, idx) => (claimed.has(idx) ? undefined : (r.role_name || r.player)))
    .filter((n): n is string => n !== undefined);
}

/**
 * Detect if a population's instances merely repeat the allowed values
 * from a value constraint on one of the fact type's role players.
 */
function isDuplicateOfValueConstraint(
  pop: ExtractedPopulation,
  input: ExtractionResponse,
): boolean {
  // Find the fact type definition.
  const ft = input.fact_types.find((f) => f.name === pop.fact_type);
  if (!ft) return false;

  // For each role player, check if it has a value_constraint.
  for (const role of ft.roles) {
    const ot = input.object_types.find((o) => o.name === role.player);
    if (!ot?.value_constraint?.values?.length) continue;

    const constraintValues = new Set(ot.value_constraint.values);

    // Check if all population instance values for this role player
    // are a subset of the value constraint.
    const popValues = new Set<string>();
    for (const instance of pop.instances) {
      const val = instance.role_values[role.player];
      if (val !== undefined) {
        popValues.add(val);
      }
    }

    if (popValues.size > 0 && isSubsetOf(popValues, constraintValues)) {
      return true;
    }
  }

  return false;
}

function isSubsetOf(a: Set<string>, b: Set<string>): boolean {
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Constraint checks
// ---------------------------------------------------------------------------

function cleanConstraints(
  constraints: readonly InferredConstraint[],
  objectTypeNames: Set<string>,
  validRoleIdentifiers: Set<string>,
  identifierFactTypes: Set<string>,
  rolesByFactType: ReadonlyMap<string, readonly ExtractedRole[]>,
  corrections: ConformanceCorrection[],
): InferredConstraint[] {
  const result: InferredConstraint[] = [];
  const seen = new Set<string>();

  for (const ic of constraints) {
    // Check 4: Role identifiers must be resolvable. The parser accepts
    // both object type names (player names) and role names, so we
    // accept either form here.
    const invalidPlayers = ic.roles.filter((r) => !validRoleIdentifiers.has(r));
    if (invalidPlayers.length > 0) {
      corrections.push({
        category: "invalid_role_player",
        description: `Removed constraint "${ic.description}" -- role identifier(s) ${
          invalidPlayers.map((p) => `"${p}"`).join(", ")
        } not resolvable.`,
        element: ic.fact_type,
      });
      continue;
    }

    // Check 5: Constraint arity
    if (!isValidArity(ic)) {
      corrections.push({
        category: "arity_mismatch",
        description: `Removed constraint "${ic.description}" -- ${ic.type} requires ${
          expectedArityDescription(ic.type)
        } role(s) but got ${ic.roles.length}.`,
        element: ic.fact_type,
      });
      continue;
    }

    // Check 5b: Frequency bounds
    //
    // Same class as the arity check above and found the same way: the
    // validator rejects a frequency constraint with min < 1 or a max
    // below its min, conformance did not, and the difference became an
    // unavoidable validation error on every extraction that produced
    // one (docs/specs/constraint-bounds.spec.md). A frequency of "at
    // least 0" is not a weak constraint, it is no constraint -- every
    // population satisfies it -- so removing it loses nothing a reader
    // could have relied on.
    const bounds = invalidBounds(ic);
    if (bounds !== undefined) {
      corrections.push({
        category: "invalid_bounds",
        description: `Removed constraint "${ic.description}" -- ${bounds}.`,
        element: ic.fact_type,
      });
      continue;
    }

    // Check 5c: Ring constraints relate an object type to itself
    //
    // Third instance of the class barwise-826 named, and found by the
    // audit rather than by a live run (barwise-831). The validator
    // rejects a ring whose two roles are played by different object
    // types; conformance checked only that there were two of them.
    //
    // Removal rather than repair is easiest to defend here of the
    // three: a ring type -- irreflexive, acyclic, symmetric -- names a
    // property of a relation on a single set, so a ring across two
    // object types is not a weak constraint but a meaningless one.
    // There is no repair that preserves the author's intent, because no
    // coherent intent can be recovered from it.
    if (ic.type === "ring" && ringSpansTwoPlayers(ic, rolesByFactType)) {
      corrections.push({
        category: "ring_different_players",
        description: `Removed constraint "${ic.description}" -- a ring constraint requires both `
          + `roles to be played by the same object type.`,
        element: ic.fact_type,
      });
      continue;
    }

    // Check 6: is_preferred on non-identifier fact type
    let constraint = ic;
    if (ic.is_preferred && !identifierFactTypes.has(ic.fact_type)) {
      corrections.push({
        category: "misplaced_is_preferred",
        description:
          `Cleared is_preferred on constraint "${ic.description}" -- fact type "${ic.fact_type}" is not an identifier fact type.`,
        element: ic.fact_type,
      });
      // Create a copy without is_preferred
      constraint = {
        type: ic.type,
        fact_type: ic.fact_type,
        roles: ic.roles,
        description: ic.description,
        confidence: ic.confidence,
        values: ic.values,
        ring_type: ic.ring_type,
        min: ic.min,
        max: ic.max,
        superset_fact_type: ic.superset_fact_type,
        superset_roles: ic.superset_roles,
        source_references: ic.source_references,
      };
    }

    // Check 7: Duplicate constraints
    const key = constraintKey(constraint);
    if (seen.has(key)) {
      corrections.push({
        category: "duplicate_constraint",
        description:
          `Removed duplicate constraint "${constraint.description}" (${constraint.type} on ${constraint.fact_type}).`,
        element: constraint.fact_type,
      });
      continue;
    }
    seen.add(key);

    result.push(constraint);
  }

  return result;
}

/**
 * Whether a constraint covers a number of roles its own type allows.
 *
 * The three multi-role types are listed explicitly rather than falling
 * through to the permissive default, because that default put this
 * module in direct contradiction with the validator: conformance waved
 * through a single-role `disjunctive_mandatory` and
 * `constraintConsistency` then rejected it as an error. Every such
 * constraint became a validation error the extraction could not avoid,
 * and on the dev split that was the whole story -- `incident-response`
 * scored 0.000 on seven of them and `subscription-billing` lost 0.1 to
 * one (docs/specs/constraint-arity.spec.md).
 *
 * Any rule the validator enforces on arity has to be enforced here too,
 * or the pipeline produces models it knows are invalid.
 */
function isValidArity(ic: InferredConstraint): boolean {
  switch (ic.type) {
    case "ring":
      return ic.roles.length === 2;
    case "frequency":
    case "mandatory":
      return ic.roles.length === 1;
    // A disjunction, an exclusion, or an exclusive-or over a single
    // role is not a weaker constraint -- it is a contradiction in
    // terms. There is nothing for the role to be disjoint from.
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or":
      return ic.roles.length >= 2;
    default:
      // Other constraint types accept 1 or more roles.
      return ic.roles.length >= 1;
  }
}

/**
 * Whether a ring constraint's two roles are played by different object
 * types -- which the validator rejects as an error.
 *
 * The resolution here deliberately mirrors `resolveRolesByPlayerName`
 * in `parse/helpers.ts`: role name first (case-insensitively), then
 * player name, with each match consuming a role so it cannot be picked
 * twice. Resolving differently from the parser would be this same bug
 * one level down -- conformance judging a constraint the parser will
 * build differently. The consuming rule is what makes the common live
 * shape work: `Employee mentors Employee` arrives with roles named
 * `["Employee", "Employee"]`, and the repeated player name has to
 * select two distinct roles rather than the same one twice.
 *
 * Anything that cannot be resolved is left alone rather than removed.
 * The unresolvable-role check (check 4) runs ahead of this one, and the
 * parser skips what it still cannot resolve; guessing here would only
 * add a second opinion.
 */
function ringSpansTwoPlayers(
  ic: InferredConstraint,
  rolesByFactType: ReadonlyMap<string, readonly ExtractedRole[]>,
): boolean {
  const roles = rolesByFactType.get(ic.fact_type);
  if (roles === undefined || ic.roles.length !== 2) return false;

  const taken = new Set<number>();
  const players: string[] = [];
  for (const hint of ic.roles) {
    const lower = hint.toLowerCase();
    let index = roles.findIndex(
      (r, i) => !taken.has(i) && r.role_name?.toLowerCase() === lower,
    );
    if (index === -1) {
      index = roles.findIndex((r, i) => !taken.has(i) && r.player === hint);
    }
    if (index === -1) continue;
    taken.add(index);
    players.push(roles[index]!.player);
  }

  return players.length === 2 && players[0] !== players[1];
}

/**
 * Why a frequency constraint's bounds are unusable, or undefined when
 * they are fine. Only `frequency` carries bounds; every other type
 * ignores the fields entirely.
 */
function invalidBounds(ic: InferredConstraint): string | undefined {
  if (ic.type !== "frequency") return undefined;
  if (ic.min !== undefined && ic.min < 1) {
    return `frequency min is ${ic.min}, which must be at least 1`;
  }
  if (
    ic.max !== undefined && ic.max !== "unbounded" && ic.min !== undefined
    && ic.max < ic.min
  ) {
    return `frequency max ${ic.max} is below its min ${ic.min}`;
  }
  return undefined;
}

function expectedArityDescription(type: InferredConstraint["type"]): string {
  switch (type) {
    case "ring":
      return "exactly 2";
    case "frequency":
    case "mandatory":
      return "exactly 1";
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or":
      return "at least 2";
    default:
      return "at least 1";
  }
}

function constraintKey(ic: InferredConstraint): string {
  const sortedRoles = [...ic.roles].sort().join(",");
  return `${ic.type}|${ic.fact_type}|${sortedRoles}`;
}

// ---------------------------------------------------------------------------
// Subtype checks
// ---------------------------------------------------------------------------

/**
 * Drop any subtype edge that closes a cycle.
 *
 * `structural/subtype-cycle` is an error and was the one gap the wider
 * validator audit turned up (barwise-834). Both edges of "Order is-a
 * Customer" / "Customer is-a Order" resolve perfectly well -- each names
 * an object type that exists and is an entity -- so the parser builds
 * them and the model carries a cycle it is then rejected for.
 *
 * Decidable here without a model: `subtypes` is a list of name pairs,
 * and a cycle in a name graph needs nothing else.
 *
 * Declarations are processed in order and an edge is rejected when the
 * supertype already reaches the subtype, which keeps every relationship
 * declared before it. That is the least destructive reading -- the
 * earlier edges are the ones the extraction committed to first -- and it
 * is deterministic, which matters because the alternative (drop the
 * whole hierarchy) would discard a correct taxonomy to punish one
 * contradictory edge.
 *
 * A diamond is not a cycle: two paths from A to D is legal ORM and
 * survives, which is why reachability is tested per edge rather than
 * with a visited set across the whole walk.
 */
function cleanSubtypes(
  subtypes: readonly ExtractedSubtype[],
  corrections: ConformanceCorrection[],
): ExtractedSubtype[] {
  const result: ExtractedSubtype[] = [];
  // supertype -> subtypes declared under it, built as we go.
  const children = new Map<string, string[]>();

  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(children.get(node) ?? []));
    }
    return false;
  };

  for (const st of subtypes) {
    // A self-edge is a cycle of length one; `reaches` catches it because
    // the walk starts by comparing the node with itself.
    if (reaches(st.supertype, st.subtype)) {
      corrections.push({
        category: "subtype_cycle",
        description: `Removed subtype "${st.subtype}" of "${st.supertype}" -- it closes a cycle `
          + `in the subtype hierarchy.`,
        element: st.subtype,
      });
      continue;
    }
    const list = children.get(st.subtype);
    if (list) list.push(st.supertype);
    else children.set(st.subtype, [st.supertype]);
    result.push(st);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reference mode checks
// ---------------------------------------------------------------------------

function checkOrphanedReferenceModes(
  entityRefModes: Map<string, string>,
  identifierFactTypeEntities: Set<string>,
  corrections: ConformanceCorrection[],
): void {
  // Check 8: Entity has reference_mode but no identifier fact type
  for (const [entityName] of entityRefModes) {
    if (!identifierFactTypeEntities.has(entityName)) {
      corrections.push({
        category: "orphaned_reference_mode",
        description:
          `Entity "${entityName}" has a reference_mode but no identifier fact type was found.`,
        element: entityName,
      });
    }
  }
}
