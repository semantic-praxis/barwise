/**
 * A single fact instance (tuple) within a population.
 *
 * Each instance maps role IDs to string values representing the
 * concrete data for that role. For example, in "Customer places Order",
 * an instance might be { "role-customer": "C001", "role-order": "O123" }.
 */
import type { Complete } from "../util/complete.js";
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
  /** Optional stable identifier. If omitted, `<population>.N`, the next number. */
  readonly id?: string;
  /** Role ID to value mapping. */
  readonly roleValues: Record<string, string>;
}

/**
 * Configuration for creating a new Population.
 */
export interface PopulationConfig {
  /** Optional stable identifier. In a model, `<fact type>.population` if omitted; standalone, generated. */
  readonly id?: string;
  /** The id of the fact type this population samples. */
  readonly factTypeId: string;
  /** Optional human-readable description. */
  readonly description?: string;
  /** Initial set of fact instances. */
  readonly instances?: readonly FactInstanceConfig[];
  /**
   * Whether these instances are an illustrative sample rather than the
   * complete extension of the fact type.
   *
   * A sample is **positive evidence only**: it can satisfy a constraint
   * but never creates the obligation that one be satisfied. Concretely,
   * its instances are excluded from the object universe, so a mandatory
   * constraint is not reported as violated merely because an entity the
   * sample happens to mention plays no role in it.
   *
   * Defaults to false, which is what every population authored before
   * this field meant: a significant population, complete for the fact
   * type it covers, and checkable as a closed world.
   *
   * LLM extraction sets it. A transcript names far more entities than
   * it gives complete facts about, so an extracted population is a
   * sample by construction -- and treating one as complete reported a
   * violation for every entity the transcript merely mentioned
   * (docs/specs/sample-populations.spec.md).
   */
  readonly sample?: boolean;
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
  /** See `PopulationConfig.sample`. Positive evidence only when true. */
  readonly sample: boolean;
  private readonly _instances: FactInstance[] = [];
  /**
   * The number the next unnamed instance takes: one past the highest this
   * population has used, stated or given, so a number is never reused once
   * an instance holding it is removed (iri-identity, decision 7).
   */
  private _next = 1;

  constructor(config: PopulationConfig) {
    this.id = config.id ?? generateId();
    this.factTypeId = config.factTypeId;
    this.description = config.description;
    this.sample = config.sample ?? false;

    if (config.instances) {
      // Every stated number first, so an unnamed instance listed before a
      // stated one does not take its number.
      for (const inst of config.instances) {
        if (inst.id !== undefined) this.countPast(inst.id);
      }
      for (const inst of config.instances) {
        this._instances.push(this.createInstance(inst));
      }
    }
  }

  /**
   * An instance with its id: its own, or the population's id and the next
   * number (`<population>.3`). A stated id of that form moves the count
   * past it, so a later unnamed instance cannot take it.
   */
  private createInstance(config: FactInstanceConfig): FactInstance {
    const prefix = `${this.id}.`;
    let id = config.id;
    if (id === undefined) {
      if (!Number.isSafeInteger(this._next + 1)) {
        throw new Error(`Population "${this.id}" has no instance number left to give.`);
      }
      id = `${prefix}${this._next++}`;
    } else {
      this.countPast(id);
    }
    return { id, roleValues: { ...config.roleValues } };
  }

  /** Move the count past a stated id of the form `<population>.<n>`. */
  private countPast(id: string): void {
    const prefix = `${this.id}.`;
    if (!id.startsWith(prefix)) return;
    // Plain decimal only: `Number` also reads "1e21", "0x10" and " 3",
    // and a count past 2^53 stops moving, so every later instance would
    // take one id.
    const suffix = id.slice(prefix.length);
    const n = Number(suffix);
    if (/^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(n + 1) && n >= this._next) {
      this._next = n + 1;
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
    const instance = this.createInstance(config);
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

/**
 * Project a Population, instances included, back to the config shape
 * that constructed it. See {@link toSubtypeFactConfig} for why these
 * projections exist rather than a hand-copied literal at each caller.
 */
export function toPopulationConfig(pop: Population): PopulationConfig {
  const config: Complete<PopulationConfig> = {
    id: pop.id,
    factTypeId: pop.factTypeId,
    description: pop.description,
    sample: pop.sample,
    instances: pop.instances.map((inst) => {
      const instance: Complete<FactInstanceConfig> = {
        id: inst.id,
        roleValues: { ...inst.roleValues },
      };
      return instance;
    }),
  };
  return config;
}
