/**
 * Converts an LLM extraction response into an OrmModel.
 *
 * This is a best-effort parser: it constructs as much of the model
 * as possible, collecting warnings for elements that cannot be created
 * (e.g., a fact type referencing an object type the LLM didn't extract).
 */

import {
  type ConceptualDataTypeName,
  type DataTypeDef,
  OrmModel,
  type RingType,
} from "@barwise/core";
import type {
  ConstraintProvenance,
  DraftModelResult,
  ElementProvenance,
  ExtractionResponse,
  ObjectificationProvenance,
  SubtypeProvenance,
} from "./ExtractionTypes.js";

/** Valid ConceptualDataTypeName values for validation of LLM output. */
const VALID_DATA_TYPE_NAMES: ReadonlySet<string> = new Set<ConceptualDataTypeName>([
  "text",
  "integer",
  "decimal",
  "money",
  "float",
  "boolean",
  "date",
  "time",
  "datetime",
  "timestamp",
  "auto_counter",
  "binary",
  "uuid",
  "other",
]);

/** Valid RingType values for validation of LLM output. */
const VALID_RING_TYPES: ReadonlySet<string> = new Set<RingType>([
  "irreflexive",
  "asymmetric",
  "antisymmetric",
  "intransitive",
  "acyclic",
  "symmetric",
  "transitive",
  "purely_reflexive",
]);

/**
 * Parse an extraction response into an ORM model with provenance metadata.
 *
 * @param response - The structured extraction from the LLM
 * @param modelName - Name for the resulting model
 */
export function parseDraftModel(
  response: ExtractionResponse,
  modelName: string,
): DraftModelResult {
  const model = new OrmModel({ name: modelName });
  const warnings: string[] = [];
  const objectTypeProvenance: ElementProvenance[] = [];
  const factTypeProvenance: ElementProvenance[] = [];
  const subtypeProvenance: SubtypeProvenance[] = [];
  const constraintProvenance: ConstraintProvenance[] = [];
  const objectificationProvenance: ObjectificationProvenance[] = [];

  // Pass 1: Create object types.
  for (const ext of response.object_types) {
    if (!ext.name || ext.name.trim().length === 0) {
      warnings.push("Skipped object type with empty name.");
      continue;
    }

    try {
      model.addObjectType({
        name: ext.name,
        kind: ext.kind ?? "entity",
        referenceMode: ext.kind === "entity"
          ? (ext.reference_mode ?? `${camelCase(ext.name)}_id`)
          : undefined,
        definition: ext.definition,
        valueConstraint: ext.value_constraint?.values?.length
          ? { values: [...ext.value_constraint.values] }
          : undefined,
        dataType: resolveDataType(ext.data_type, ext.name, warnings),
        aliases: ext.aliases?.length ? [...ext.aliases] : undefined,
      });

      objectTypeProvenance.push({
        elementName: ext.name,
        sourceReferences: ext.source_references ?? [],
      });
    } catch (err) {
      warnings.push(
        `Failed to create object type "${ext.name}": ${(err as Error).message}`,
      );
    }
  }

  // Pass 2: Create fact types.
  for (const ext of response.fact_types) {
    if (!ext.name || ext.name.trim().length === 0) {
      warnings.push("Skipped fact type with empty name.");
      continue;
    }

    if (!ext.roles || ext.roles.length === 0) {
      warnings.push(`Skipped fact type "${ext.name}": no roles defined.`);
      continue;
    }

    // Resolve role player names to object type ids.
    const resolvedRoles: Array<{ name: string; playerId: string; }> = [];
    let resolutionFailed = false;

    for (const role of ext.roles) {
      const ot = model.getObjectTypeByName(role.player);
      if (!ot) {
        warnings.push(
          `Fact type "${ext.name}": role player "${role.player}" `
            + `not found among extracted object types. Skipping this fact type.`,
        );
        resolutionFailed = true;
        break;
      }
      resolvedRoles.push({
        name: role.role_name || role.player.toLowerCase(),
        playerId: ot.id,
      });
    }

    if (resolutionFailed) continue;

    // Ensure at least one reading exists.
    let readings = ext.readings?.length
      ? [...ext.readings]
      : [buildDefaultReading(resolvedRoles)];

    // Validate reading placeholders match role count.
    readings = readings.filter((r) => {
      const maxPlaceholder = resolvedRoles.length - 1;
      for (let i = 0; i <= maxPlaceholder; i++) {
        if (!r.includes(`{${i}}`)) {
          warnings.push(
            `Fact type "${ext.name}": reading "${r}" is missing `
              + `placeholder {${i}}. Discarding this reading.`,
          );
          return false;
        }
      }
      return true;
    });

    if (readings.length === 0) {
      readings = [buildDefaultReading(resolvedRoles)];
    }

    try {
      model.addFactType({
        name: ext.name,
        roles: resolvedRoles.map((r) => ({
          name: r.name,
          playerId: r.playerId,
        })),
        readings,
      });

      factTypeProvenance.push({
        elementName: ext.name,
        sourceReferences: ext.source_references ?? [],
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type "${ext.name}": ${(err as Error).message}`,
      );
    }
  }

  // Pass 3: Apply inferred constraints.
  for (const ic of response.inferred_constraints) {
    const ft = model.getFactTypeByName(ic.fact_type);
    if (!ft) {
      constraintProvenance.push({
        description: ic.description,
        confidence: ic.confidence,
        sourceReferences: ic.source_references ?? [],
        applied: false,
        skipReason: `Fact type "${ic.fact_type}" not found in model.`,
      });
      continue;
    }

    if (ic.type === "internal_uniqueness") {
      // Find the role(s) by player name or role name.
      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length > 0) {
        const constraint: import("@barwise/core").Constraint = ic.is_preferred
          ? { type: "internal_uniqueness", roleIds, isPreferred: true }
          : { type: "internal_uniqueness", roleIds };

        // Skip duplicate constraints (LLMs often emit the same constraint
        // in multiple phrasings, e.g. "each X has at most one Y" and
        // "each Y identifies at most one X" both targeting the same role).
        if (isDuplicateConstraint(ft, constraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (identical type and roles already present).",
          });
        } else {
          ft.addConstraint(constraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      } else {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Could not resolve roles [${
            ic.roles.join(", ")
          }] in fact type "${ic.fact_type}".`,
        });
      }
    } else if (ic.type === "mandatory") {
      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length === 1 && roleIds[0]) {
        const mandatoryConstraint: import("@barwise/core").Constraint = {
          type: "mandatory",
          roleId: roleIds[0],
        };
        if (isDuplicateConstraint(ft, mandatoryConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (identical type and role already present).",
          });
        } else {
          ft.addConstraint(mandatoryConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      } else {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: roleIds.length === 0
            ? `Could not resolve role [${ic.roles.join(", ")}] in fact type "${ic.fact_type}".`
            : `Mandatory constraint requires exactly one role, got ${roleIds.length}.`,
        });
      }
    } else if (ic.type === "value_constraint") {
      // Role-level value constraint: restrict allowed values for a
      // specific role within a fact type.
      if (!ic.values || ic.values.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: "Value constraint has no values specified.",
        });
        continue;
      }

      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length !== 1) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: roleIds.length === 0
            ? `Could not resolve role [${ic.roles.join(", ")}] in fact type "${ic.fact_type}".`
            : `Value constraint requires exactly one role, got ${roleIds.length}.`,
        });
      } else {
        const vcConstraint: import("@barwise/core").Constraint = {
          type: "value_constraint",
          roleId: roleIds[0]!,
          values: [...ic.values],
        };
        if (isDuplicateConstraint(ft, vcConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason:
              "Duplicate constraint (identical value constraint on same role already present).",
          });
        } else {
          ft.addConstraint(vcConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (
      ic.type === "external_uniqueness"
      || ic.type === "disjunctive_mandatory"
      || ic.type === "exclusion"
      || ic.type === "exclusive_or"
    ) {
      // Multi-role constraints within a single fact type.
      // All four share the same structure: { type, roleIds }.
      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Could not resolve roles [${
            ic.roles.join(", ")
          }] in fact type "${ic.fact_type}".`,
        });
      } else {
        const constraint: import("@barwise/core").Constraint = {
          type: ic.type,
          roleIds,
        };
        if (isDuplicateConstraint(ft, constraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: `Duplicate constraint (identical ${ic.type} already present).`,
          });
        } else {
          ft.addConstraint(constraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (ic.type === "frequency") {
      // Frequency constraint: single role with min/max bounds.
      if (ic.min === undefined || ic.min === null) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: "Frequency constraint requires min value.",
        });
        continue;
      }
      if (ic.max === undefined || ic.max === null) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: "Frequency constraint requires max value.",
        });
        continue;
      }

      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length !== 1) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: roleIds.length === 0
            ? `Could not resolve role [${ic.roles.join(", ")}] in fact type "${ic.fact_type}".`
            : `Frequency constraint requires exactly one role, got ${roleIds.length}.`,
        });
      } else {
        const freqConstraint: import("@barwise/core").Constraint = {
          type: "frequency",
          roleId: roleIds[0]!,
          min: ic.min,
          max: ic.max,
        };
        if (isDuplicateConstraint(ft, freqConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (frequency on same role already present).",
          });
        } else {
          ft.addConstraint(freqConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (ic.type === "ring") {
      // Ring constraint: exactly 2 roles, same fact type, with a ring_type.
      if (!ic.ring_type || !VALID_RING_TYPES.has(ic.ring_type)) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: ic.ring_type
            ? `Unrecognized ring_type "${ic.ring_type}".`
            : "Ring constraint requires a ring_type.",
        });
        continue;
      }

      const roleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      if (roleIds.length !== 2) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Ring constraint requires exactly 2 roles, got ${roleIds.length}.`,
        });
      } else {
        const ringConstraint: import("@barwise/core").Constraint = {
          type: "ring",
          roleId1: roleIds[0]!,
          roleId2: roleIds[1]!,
          ringType: ic.ring_type as RingType,
        };
        if (isDuplicateConstraint(ft, ringConstraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: "Duplicate constraint (ring on same roles already present).",
          });
        } else {
          ft.addConstraint(ringConstraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    } else if (ic.type === "subset" || ic.type === "equality") {
      // Subset and equality constraints: two role sequences across two fact types.
      if (!ic.superset_fact_type) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `${ic.type} constraint requires superset_fact_type.`,
        });
        continue;
      }
      if (!ic.superset_roles || ic.superset_roles.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `${ic.type} constraint requires superset_roles.`,
        });
        continue;
      }

      const supersetFt = model.getFactTypeByName(ic.superset_fact_type);
      if (!supersetFt) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Superset fact type "${ic.superset_fact_type}" not found in model.`,
        });
        continue;
      }

      const subsetRoleIds = resolveRolesByPlayerName(ft, ic.roles, model, warnings, ic.description);
      const supersetRoleIds = resolveRolesByPlayerName(
        supersetFt,
        ic.superset_roles,
        model,
        warnings,
        ic.description,
      );

      if (subsetRoleIds.length === 0 || supersetRoleIds.length === 0) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason: `Could not resolve roles for ${ic.type} constraint.`,
        });
      } else if (subsetRoleIds.length !== supersetRoleIds.length) {
        constraintProvenance.push({
          description: ic.description,
          confidence: ic.confidence,
          sourceReferences: ic.source_references ?? [],
          applied: false,
          skipReason:
            `${ic.type} constraint requires matching arity: got ${subsetRoleIds.length} vs ${supersetRoleIds.length}.`,
        });
      } else {
        const constraint: import("@barwise/core").Constraint = ic.type === "subset"
          ? { type: "subset", subsetRoleIds, supersetRoleIds }
          : { type: "equality", roleIds1: subsetRoleIds, roleIds2: supersetRoleIds };

        if (isDuplicateConstraint(ft, constraint)) {
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: false,
            skipReason: `Duplicate constraint (identical ${ic.type} already present).`,
          });
        } else {
          ft.addConstraint(constraint);
          constraintProvenance.push({
            description: ic.description,
            confidence: ic.confidence,
            sourceReferences: ic.source_references ?? [],
            applied: true,
          });
        }
      }
    }
  }

  // Pass 4: Create subtype facts.
  for (const ext of response.subtypes ?? []) {
    const subtypeOt = model.getObjectTypeByName(ext.subtype);
    if (!subtypeOt) {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Subtype entity "${ext.subtype}" not found among extracted object types.`,
      });
      continue;
    }

    const supertypeOt = model.getObjectTypeByName(ext.supertype);
    if (!supertypeOt) {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Supertype entity "${ext.supertype}" not found among extracted object types.`,
      });
      continue;
    }

    if (subtypeOt.kind !== "entity") {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Subtype "${ext.subtype}" is a ${subtypeOt.kind} type, not an entity type.`,
      });
      continue;
    }

    if (supertypeOt.kind !== "entity") {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason:
          `Supertype "${ext.supertype}" is a ${supertypeOt.kind} type, not an entity type.`,
      });
      continue;
    }

    try {
      model.addSubtypeFact({
        subtypeId: subtypeOt.id,
        supertypeId: supertypeOt.id,
        providesIdentification: ext.provides_identification ?? true,
      });

      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: true,
      });
    } catch (err) {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Failed to create subtype fact: ${(err as Error).message}`,
      });
    }
  }

  // Pass 5: Create populations.
  for (const ext of response.populations ?? []) {
    const factType = model.getFactTypeByName(ext.fact_type);
    if (!factType) {
      warnings.push(
        `Population for fact type "${ext.fact_type}" skipped: fact type not found.`,
      );
      continue;
    }

    try {
      const population = model.addPopulation({
        factTypeId: factType.id,
        description: ext.description,
      });

      // Add instances to the population
      for (const instData of ext.instances) {
        // Map role player names to role IDs
        const roleValues: Record<string, string> = {};
        let resolutionFailed = false;

        for (const [playerName, value] of Object.entries(instData.role_values)) {
          // Find role by player name
          const player = model.getObjectTypeByName(playerName);
          if (!player) {
            warnings.push(
              `Population instance for "${ext.fact_type}": player "${playerName}" not found.`,
            );
            resolutionFailed = true;
            break;
          }

          const roles = factType.rolesForPlayer(player.id);
          if (roles.length === 0) {
            warnings.push(
              `Population instance for "${ext.fact_type}": player "${playerName}" does not play a role in this fact type.`,
            );
            resolutionFailed = true;
            break;
          }

          // Use first matching role (for simplicity)
          roleValues[roles[0]!.id] = value;
        }

        if (!resolutionFailed && Object.keys(roleValues).length > 0) {
          population.addInstance({ roleValues });
        }
      }
    } catch (err) {
      warnings.push(
        `Failed to create population for "${ext.fact_type}": ${(err as Error).message}`,
      );
    }
  }

  // Pass 6: Create objectified fact types.
  for (const ext of response.objectified_fact_types ?? []) {
    const ft = model.getFactTypeByName(ext.fact_type);
    if (!ft) {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Fact type "${ext.fact_type}" not found among extracted fact types.`,
      });
      continue;
    }

    const ot = model.getObjectTypeByName(ext.object_type);
    if (!ot) {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Object type "${ext.object_type}" not found among extracted object types.`,
      });
      continue;
    }

    if (ot.kind !== "entity") {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Object type "${ext.object_type}" is a ${ot.kind} type, not an entity type.`,
      });
      continue;
    }

    try {
      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: ot.id,
      });

      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: true,
      });
    } catch (err) {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Failed to create objectification: ${(err as Error).message}`,
      });
    }
  }

  return {
    model,
    objectTypeProvenance,
    factTypeProvenance,
    subtypeProvenance,
    constraintProvenance,
    objectificationProvenance,
    ambiguities: response.ambiguities ?? [],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a structurally identical constraint already exists on a fact type.
 * Two internal_uniqueness constraints are duplicates if they cover the same set
 * of role IDs. The isPreferred flag is promoted (if either is preferred, the
 * existing one wins).
 */
function isDuplicateConstraint(
  ft: import("@barwise/core").FactType,
  candidate: import("@barwise/core").Constraint,
): boolean {
  if (candidate.type === "internal_uniqueness") {
    const candidateRoles = [...candidate.roleIds].sort();
    return ft.constraints.some((existing) => {
      if (existing.type !== "internal_uniqueness") return false;
      const existingRoles = [...existing.roleIds].sort();
      return (
        existingRoles.length === candidateRoles.length
        && existingRoles.every((id, i) => id === candidateRoles[i])
      );
    });
  }
  if (candidate.type === "mandatory") {
    return ft.constraints.some(
      (existing) =>
        existing.type === "mandatory"
        && existing.roleId === candidate.roleId,
    );
  }
  if (candidate.type === "value_constraint") {
    return ft.constraints.some(
      (existing) =>
        existing.type === "value_constraint"
        && existing.roleId === candidate.roleId,
    );
  }
  // Multi-role constraints with sorted role ID comparison.
  if (
    candidate.type === "external_uniqueness"
    || candidate.type === "disjunctive_mandatory"
    || candidate.type === "exclusion"
    || candidate.type === "exclusive_or"
  ) {
    const candidateRoles = [...candidate.roleIds].sort();
    return ft.constraints.some((existing) => {
      if (existing.type !== candidate.type) return false;
      const existingRoles = [...(existing as typeof candidate).roleIds].sort();
      return (
        existingRoles.length === candidateRoles.length
        && existingRoles.every((id, i) => id === candidateRoles[i])
      );
    });
  }
  if (candidate.type === "frequency") {
    return ft.constraints.some(
      (existing) =>
        existing.type === "frequency"
        && existing.roleId === candidate.roleId,
    );
  }
  if (candidate.type === "ring") {
    const roles = [candidate.roleId1, candidate.roleId2].sort();
    return ft.constraints.some((existing) => {
      if (existing.type !== "ring") return false;
      if (existing.ringType !== candidate.ringType) return false;
      const existingRoles = [existing.roleId1, existing.roleId2].sort();
      return existingRoles[0] === roles[0] && existingRoles[1] === roles[1];
    });
  }
  if (candidate.type === "subset") {
    return ft.constraints.some((existing) => {
      if (existing.type !== "subset") return false;
      return (
        arraysEqual(existing.subsetRoleIds, candidate.subsetRoleIds)
        && arraysEqual(existing.supersetRoleIds, candidate.supersetRoleIds)
      );
    });
  }
  if (candidate.type === "equality") {
    return ft.constraints.some((existing) => {
      if (existing.type !== "equality") return false;
      return (
        arraysEqual(existing.roleIds1, candidate.roleIds1)
        && arraysEqual(existing.roleIds2, candidate.roleIds2)
      );
    });
  }
  return false;
}

/** Compare two readonly string arrays for equality (order-sensitive). */
function arraysEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Resolve role identifiers from constraint role hints.
 *
 * The LLM may send role names ("is placed by"), player names
 * ("Customer"), or a mix. We try matching strategies in order:
 *   1. Exact role name match (case-insensitive)
 *   2. Player object type name match (via model lookup)
 *   3. Skip with warning (no blind fallback)
 */
function resolveRolesByPlayerName(
  ft: import("@barwise/core").FactType,
  roleHints: readonly string[],
  model: OrmModel,
  warnings: string[],
  constraintDesc: string,
): string[] {
  const roleIds: string[] = [];
  for (const hint of roleHints) {
    const hintLower = hint.toLowerCase();

    // Strategy 1: Match by role name (case-insensitive).
    const byRoleName = ft.roles.find(
      (r) => r.name.toLowerCase() === hintLower && !roleIds.includes(r.id),
    );
    if (byRoleName) {
      roleIds.push(byRoleName.id);
      continue;
    }

    // Strategy 2: Match by player object type name.
    const ot = model.getObjectTypeByName(hint);
    if (ot) {
      const candidates = ft.rolesForPlayer(ot.id)
        .filter((r) => !roleIds.includes(r.id));
      if (candidates.length > 0) {
        roleIds.push(candidates[0]!.id);
        continue;
      }
    }

    // No match found -- warn but do not blindly pick a role.
    warnings.push(
      `Constraint "${constraintDesc}": could not resolve `
        + `role "${hint}" in fact type "${ft.name}". Skipping this role.`,
    );
  }
  return roleIds;
}

function camelCase(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function buildDefaultReading(
  roles: Array<{ name: string; playerId: string; }>,
): string {
  // Build "{0} role_name_1 {1} role_name_2 {2}" etc.
  const parts: string[] = [];
  for (let i = 0; i < roles.length; i++) {
    parts.push(`{${i}}`);
    const role = roles[i]!;
    if (i < roles.length - 1) {
      parts.push(role.name);
    }
  }
  return parts.join(" ");
}

/**
 * Validate and convert an LLM-produced data_type into a DataTypeDef.
 * Returns undefined if the input is missing or has an unrecognized type name.
 */
function resolveDataType(
  raw: { readonly name: string; readonly length?: number; readonly scale?: number; } | undefined,
  objectTypeName: string,
  warnings: string[],
): DataTypeDef | undefined {
  if (!raw?.name) return undefined;

  if (!VALID_DATA_TYPE_NAMES.has(raw.name)) {
    warnings.push(
      `Object type "${objectTypeName}": unrecognized data type "${raw.name}". Ignoring.`,
    );
    return undefined;
  }

  const result: DataTypeDef = { name: raw.name as ConceptualDataTypeName };
  if (raw.length !== undefined && typeof raw.length === "number") {
    (result as { length: number; }).length = raw.length;
  }
  if (raw.scale !== undefined && typeof raw.scale === "number") {
    (result as { scale: number; }).scale = raw.scale;
  }
  return result;
}
