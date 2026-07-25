/**
 * A single fact instance (tuple) within a population.
 *
 * Each instance maps role IDs to string values representing the
 * concrete data for that role. For example, in "Customer places Order",
 * an instance might be { "role-customer": "C001", "role-order": "O123" }.
 */
import { generateId } from "./id.js";
export interface FactInstance {
  /** Unique identifier for this instance. */
  readonly id: string;
  /**
   * Mapping of role ID to the concrete value for that role.
   * Keys must be role IDs from the parent population's fact type.
   */
  readonly roleValues: Readonly<Record<string, string>>;
}

/**
 * Configuration for creating a new FactInstance.
 */
export interface FactInstanceConfig {
  /** Optional stable identifier. Generated if omitted. */
  readonly id?: string;
  /** Role ID to value mapping. */
  readonly roleValues: Record<string, string>;
}

/**
 * Configuration for creating a new Population.
 */
export interface PopulationConfig {
  /** Optional stable identifier. Generated if omitted. */
  readonly id?: string;
  /** The id of the fact type this population samples. */
  readonly factTypeId: string;
  /** Optional human-readable description. */
  readonly description?: string;
  /** Initial set of fact instances. */
  readonly instances?: readonly FactInstanceConfig[];
}

/**
 * A Population is a set of sample fact instances used for validation
 * with domain experts. Each population belongs to a specific fact type
 * and contains concrete example tuples that should satisfy all declared
 * constraints on that fact type.
 *
 * Example: For the fact type "Customer places Order", a population
 * might contain:
 *   { customer_id: "C001", order_number: "O123" }
 *   { customer_id: "C001", order_number: "O124" }
 *   { customer_id: "C002", order_number: "O125" }
 *
 * These instances can then be validated against uniqueness, mandatory,
 * value, and frequency constraints to verify the model is correct.
 */
export class Population {
  readonly id: string;
  readonly factTypeId: string;
  description: string | undefined;
  private readonly _instances: FactInstance[] = [];

  constructor(config: PopulationConfig) {
    this.id = config.id ?? generateId();
    this.factTypeId = config.factTypeId;
    this.description = config.description;

    if (config.instances) {
      for (const inst of config.instances) {
        this._instances.push(createInstance(inst));
      }
    }
  }

  /** All fact instances in this population. */
  get instances(): readonly FactInstance[] {
    return [...this._instances];
  }

  /** Number of instances in this population. */
  get size(): number {
    return this._instances.length;
  }

  /**
   * Add a fact instance to this population.
   * @returns The created instance.
   */
  addInstance(config: FactInstanceConfig): FactInstance {
    const instance = createInstance(config);
    this._instances.push(instance);
    return instance;
  }

  /**
   * Remove a fact instance by id.
   * @throws If the instance is not found.
   */
  removeInstance(id: string): void {
    const idx = this._instances.findIndex((i) => i.id === id);
    if (idx === -1) {
      throw new Error(
        `Fact instance with id "${id}" not found in population "${this.id}".`,
      );
    }
    this._instances.splice(idx, 1);
  }

  /** Look up a fact instance by id. */
  getInstance(id: string): FactInstance | undefined {
    return this._instances.find((i) => i.id === id);
  }
}

function createInstance(config: FactInstanceConfig): FactInstance {
  return {
    id: config.id ?? generateId(),
    roleValues: { ...config.roleValues },
  };
}
