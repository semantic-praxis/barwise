import { ContextMapping, type ContextMappingConfig } from "./ContextMapping.js";
import { DomainModel, type DomainModelConfig } from "./DomainModel.js";
import type { ObjectType } from "./ObjectType.js";
import { type ProductConfig, ProductDependency } from "./ProductDependency.js";

// ---------------------------------------------------------------------------
// Project Settings
// ---------------------------------------------------------------------------

/**
 * A registered export format name (e.g. "ddl", "openapi", "avro", "dbt").
 * Core does not enumerate the formats -- they register from outside core
 * through the `FormatDescriptor` registry -- so this is the format's
 * registered name rather than a fixed union.
 */
export type ExportFormat = string;

/**
 * Strategy for generating preferred identifier (primary key) columns
 * when the model does not specify an explicit preferred identifier
 * value type.
 *
 * - "integer" -- PK columns default to INTEGER (auto-counter/serial).
 * - "uuid"    -- PK columns default to UUID.
 *
 * When unset, the relational mapper falls back to TEXT (the existing
 * behavior prior to this setting).
 */
export type PreferredIdentifierStrategy = "integer" | "uuid";

/**
 * Project-level settings persisted in .orm-project.yaml.
 *
 * These are structural settings about the project layout that apply
 * to all users (not personal editor preferences). All paths are
 * relative to the project root.
 */
export interface ProjectSettings {
  /** Path to the dbt project root (e.g. "dbt"). */
  readonly dbtProjectDir?: string;
  /** Default export format for relational mapping output. */
  readonly defaultExportFormat?: ExportFormat;
  /** Default directory for export output. */
  readonly defaultExportDir?: string;
  /**
   * Default data type strategy for entity primary key columns when no
   * explicit preferred identifier value type is declared in the model.
   */
  readonly preferredIdentifierStrategy?: PreferredIdentifierStrategy;
  /**
   * Default LLM model identifier for transcript extraction.
   *
   * Free-form string matching the provider's model naming convention
   * (e.g. "claude-sonnet-4-5-20250929", "gpt-4o", "gpt-5-mini").
   * Used as the pre-selected default when the model picker is shown.
   */
  readonly defaultLlmModel?: string;
}

// ---------------------------------------------------------------------------
// Project Config & Class
// ---------------------------------------------------------------------------

/**
 * Configuration for creating an OrmProject.
 */
export interface OrmProjectConfig {
  readonly name: string;
  readonly domains?: readonly DomainModelConfig[];
  readonly mappings?: readonly ContextMappingConfig[];
  readonly products?: readonly ProductConfig[];
  readonly settings?: ProjectSettings;
}

/**
 * Root aggregate for a multi-domain ORM project.
 *
 * Holds references to domain models, context mappings, and data products.
 * Provides cross-domain reference resolution using the `context:ObjectType`
 * namespace syntax.
 */
export class OrmProject {
  private _name: string;
  private readonly _domains: Map<string, DomainModel> = new Map();
  private readonly _mappings: ContextMapping[] = [];
  private readonly _products: Map<string, ProductDependency> = new Map();
  private _settings: ProjectSettings;

  constructor(config: OrmProjectConfig) {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error("Project name must be a non-empty string.");
    }
    this._name = config.name.trim();
    this._settings = config.settings ? { ...config.settings } : {};

    for (const dc of config.domains ?? []) {
      this.addDomain(dc);
    }
    for (const mc of config.mappings ?? []) {
      this.addMapping(mc);
    }
    for (const pc of config.products ?? []) {
      this.addProduct(pc);
    }
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error("Project name must be a non-empty string.");
    }
    this._name = value.trim();
  }

  // ---- Settings ----

  /** Project-level settings. Returns a shallow copy. */
  get settings(): ProjectSettings {
    return { ...this._settings };
  }

  /** Replace all settings. */
  set settings(value: ProjectSettings) {
    this._settings = { ...value };
  }

  /**
   * Merge partial settings into the current settings.
   * Only provided keys are updated; others are preserved.
   */
  updateSettings(partial: Partial<ProjectSettings>): void {
    this._settings = { ...this._settings, ...partial };
  }

  // ---- Domains ----

  get domains(): readonly DomainModel[] {
    return [...this._domains.values()];
  }

  getDomain(context: string): DomainModel | undefined {
    return this._domains.get(context);
  }

  addDomain(config: DomainModelConfig): DomainModel {
    if (this._domains.has(config.context.trim())) {
      throw new Error(
        `Domain with context "${config.context}" already exists in project "${this._name}".`,
      );
    }
    if (this._products.has(config.context.trim())) {
      throw new Error(
        `Context name "${config.context}" is already used by a data product.`,
      );
    }
    const dm = new DomainModel(config);
    this._domains.set(dm.context, dm);
    return dm;
  }

  // ---- Mappings ----

  get mappings(): readonly ContextMapping[] {
    return [...this._mappings];
  }

  addMapping(config: ContextMappingConfig): ContextMapping {
    const cm = new ContextMapping(config);
    this._mappings.push(cm);
    return cm;
  }

  /** Get all mappings that involve a given context. */
  mappingsForContext(context: string): readonly ContextMapping[] {
    return this._mappings.filter((m) => m.involvesContext(context));
  }

  // ---- Products ----

  get products(): readonly ProductDependency[] {
    return [...this._products.values()];
  }

  getProduct(context: string): ProductDependency | undefined {
    return this._products.get(context);
  }

  addProduct(config: ProductConfig): ProductDependency {
    if (this._products.has(config.context.trim())) {
      throw new Error(
        `Product with context "${config.context}" already exists in project "${this._name}".`,
      );
    }
    if (this._domains.has(config.context.trim())) {
      throw new Error(
        `Context name "${config.context}" is already used by a domain.`,
      );
    }
    const pd = new ProductDependency(config);
    this._products.set(pd.context, pd);
    return pd;
  }

  // ---- Cross-Domain Reference Resolution ----

  /**
   * All context names in the project (domains + products).
   */
  get allContexts(): readonly string[] {
    return [
      ...this._domains.keys(),
      ...this._products.keys(),
    ];
  }

  /**
   * Parse a namespace-qualified reference like "crm:Customer".
   *
   * Returns the context and object type name, or undefined if
   * the reference is not namespace-qualified.
   */
  static parseQualifiedRef(ref: string): {
    context: string;
    name: string;
  } | undefined {
    const colonIdx = ref.indexOf(":");
    if (colonIdx <= 0 || colonIdx === ref.length - 1) {
      return undefined;
    }
    return {
      context: ref.slice(0, colonIdx),
      name: ref.slice(colonIdx + 1),
    };
  }

  /**
   * Resolve a namespace-qualified reference to an object type.
   *
   * Returns the ObjectType if the referenced domain is loaded
   * and contains the named object type; undefined otherwise.
   */
  resolveQualifiedRef(ref: string): ObjectType | undefined {
    const parsed = OrmProject.parseQualifiedRef(ref);
    if (!parsed) return undefined;

    const domain = this._domains.get(parsed.context);
    if (!domain?.model) return undefined;

    return domain.model.getObjectTypeByName(parsed.name);
  }
}
