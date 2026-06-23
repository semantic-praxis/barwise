import type {
  FactInstance,
  FactInstanceConfig,
  Population,
  PopulationConfig,
} from "../../model/Population.js";

export interface OrmYamlFactInstance {
  id: string;
  role_values: Record<string, string>;
}

export interface OrmYamlPopulation {
  id: string;
  fact_type: string;
  description?: string;
  instances: OrmYamlFactInstance[];
}

function serializeFactInstance(inst: FactInstance): OrmYamlFactInstance {
  return {
    id: inst.id,
    role_values: { ...inst.roleValues },
  };
}

export function serializePopulation(pop: Population): OrmYamlPopulation {
  const result: OrmYamlPopulation = {
    id: pop.id,
    fact_type: pop.factTypeId,
    instances: pop.instances.map((inst) => serializeFactInstance(inst)),
  };
  if (pop.description) {
    result.description = pop.description;
  }
  return result;
}

/**
 * Translate a population's header fields. The instances are added
 * separately (via {@link deserializeFactInstance}) so the orchestrator
 * keeps the model-mutation order.
 */
export function deserializePopulation(popDoc: OrmYamlPopulation): PopulationConfig {
  return {
    id: popDoc.id,
    factTypeId: popDoc.fact_type,
    description: popDoc.description,
  };
}

export function deserializeFactInstance(instDoc: OrmYamlFactInstance): FactInstanceConfig {
  return {
    id: instDoc.id,
    roleValues: instDoc.role_values,
  };
}
