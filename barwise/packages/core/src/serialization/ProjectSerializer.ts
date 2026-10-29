import { Ajv, type ErrorObject } from "ajv";
import { parse, stringify } from "yaml";
import projectSchema from "../../schemas/orm-project.schema.json" with { type: "json" };
import type { DomainModelConfig } from "../model/DomainModel.js";
import {
  type ExportFormat,
  OrmProject,
  type OrmProjectConfig,
  type PreferredIdentifierStrategy,
  type ProjectSettings,
} from "../model/OrmProject.js";
import type { ProductConfig } from "../model/ProductDependency.js";
import { formatVersionProblem } from "./schemaVersion.js";

/**
 * The `format_version` this build reads and writes for `.orm-project.yaml`.
 * The serializer stamps it on every manifest, and the schema pins its
 * `const` to the same value. Separate from `CURRENT_ORM_VERSION`: each file
 * kind evolves on its own (iri-identity WS4, barwise-y1b).
 */
export const CURRENT_PROJECT_FORMAT_VERSION = "1.0";

/**
 * The shape of a parsed .orm-project.yaml document.
 */
interface ProjectYamlDocument {
  format_version?: string;
  project: {
    name: string;
    iri_base?: string;
    domains?: Array<{ path: string; context: string; }>;
    mappings?: Array<{ path: string; }>;
    products?: Array<{
      path: string;
      context: string;
      depends_on?: {
        domains?: string[];
        mappings?: string[];
      };
    }>;
    settings?: {
      dbt_project_dir?: string;
      default_export_format?: string;
      default_export_dir?: string;
      preferred_identifier_strategy?: string;
      default_llm_model?: string;
    };
  };
}

/**
 * Serializes and deserializes OrmProject instances to/from
 * .orm-project.yaml format.
 */
export class ProjectSerializer {
  private readonly validate;

  constructor() {
    const ajv = new Ajv({ allErrors: true });
    this.validate = ajv.compile(projectSchema);
  }

  /**
   * Serialize an OrmProject to YAML.
   */
  serialize(project: OrmProject): string {
    const doc: ProjectYamlDocument = {
      format_version: CURRENT_PROJECT_FORMAT_VERSION,
      project: {
        name: project.name,
      },
    };

    if (project.iriBase) {
      doc.project.iri_base = project.iriBase;
    }

    if (project.domains.length > 0) {
      doc.project.domains = project.domains.map((d) => ({
        path: d.path,
        context: d.context,
      }));
    }

    if (project.mappings.length > 0) {
      doc.project.mappings = project.mappings.map((m) => ({
        path: m.path,
      }));
    }

    if (project.products.length > 0) {
      doc.project.products = project.products.map((p) => {
        const entry: ProjectYamlDocument["project"]["products"] extends
          | Array<infer T>
          | undefined ? T
          : never = {
            path: p.path,
            context: p.context,
          };

        if (
          p.dependsOnDomains.length > 0
          || p.dependsOnMappings.length > 0
        ) {
          (
            entry as { depends_on?: { domains?: string[]; mappings?: string[]; }; }
          ).depends_on = {};
          if (p.dependsOnDomains.length > 0) {
            entry.depends_on!.domains = [...p.dependsOnDomains];
          }
          if (p.dependsOnMappings.length > 0) {
            entry.depends_on!.mappings = [...p.dependsOnMappings];
          }
        }

        return entry;
      });
    }

    // Serialize settings (only if at least one value is set).
    const s = project.settings;
    if (
      s.dbtProjectDir || s.defaultExportFormat || s.defaultExportDir
      || s.preferredIdentifierStrategy || s.defaultLlmModel
    ) {
      const settingsDoc: NonNullable<ProjectYamlDocument["project"]["settings"]> = {};
      if (s.dbtProjectDir) settingsDoc.dbt_project_dir = s.dbtProjectDir;
      if (s.defaultExportFormat) settingsDoc.default_export_format = s.defaultExportFormat;
      if (s.defaultExportDir) settingsDoc.default_export_dir = s.defaultExportDir;
      if (s.preferredIdentifierStrategy) {
        settingsDoc.preferred_identifier_strategy = s.preferredIdentifierStrategy;
      }
      if (s.defaultLlmModel) settingsDoc.default_llm_model = s.defaultLlmModel;
      doc.project.settings = settingsDoc;
    }

    return stringify(doc);
  }

  /**
   * Deserialize a YAML string into an OrmProject.
   *
   * @throws {DeserializationError} if the YAML is invalid or doesn't
   * match the schema.
   */
  deserialize(yaml: string): OrmProject {
    let parsed: unknown;
    try {
      parsed = parse(yaml);
    } catch (err) {
      throw new ProjectDeserializationError(
        `Invalid YAML: ${(err as Error).message}`,
      );
    }

    const versionProblem = formatVersionProblem(parsed, CURRENT_PROJECT_FORMAT_VERSION);
    if (versionProblem) throw new ProjectDeserializationError(versionProblem);

    const valid = this.validate(parsed);
    if (!valid) {
      const messages = (this.validate.errors ?? [])
        .map(
          (e: ErrorObject) => `${e.instancePath || "/"}: ${e.message ?? "unknown error"}`,
        )
        .join("; ");
      throw new ProjectDeserializationError(
        `Schema validation failed: ${messages}`,
      );
    }

    const doc = parsed as ProjectYamlDocument;
    return this.buildProject(doc);
  }

  private buildProject(doc: ProjectYamlDocument): OrmProject {
    const domains: DomainModelConfig[] = (doc.project.domains ?? []).map(
      (d) => ({ path: d.path, context: d.context }),
    );

    const products: ProductConfig[] = (doc.project.products ?? []).map(
      (p) => ({
        path: p.path,
        context: p.context,
        dependsOnDomains: p.depends_on?.domains ?? [],
        dependsOnMappings: p.depends_on?.mappings ?? [],
      }),
    );

    // Map snake_case YAML keys to camelCase model properties.
    const settings: ProjectSettings | undefined = doc.project.settings
      ? {
        dbtProjectDir: doc.project.settings.dbt_project_dir,
        defaultExportFormat: doc.project.settings.default_export_format as ExportFormat | undefined,
        defaultExportDir: doc.project.settings.default_export_dir,
        preferredIdentifierStrategy: doc.project.settings.preferred_identifier_strategy as
          | PreferredIdentifierStrategy
          | undefined,
        defaultLlmModel: doc.project.settings.default_llm_model,
      }
      : undefined;

    const config: OrmProjectConfig = {
      name: doc.project.name,
      iriBase: doc.project.iri_base,
      domains,
      products,
      settings,
    };

    const project = new OrmProject(config);

    // Mappings are stored as file paths in the manifest; the actual
    // mapping content lives in separate .map.yaml files. We store
    // the paths so that a loader can resolve them.
    // For now we just track the paths on the project.
    // The ContextMapping objects are loaded separately via MappingSerializer.

    return project;
  }

  /**
   * Get the mapping file paths declared in a project manifest YAML.
   */
  getMappingPaths(yaml: string): string[] {
    let parsed: unknown;
    try {
      parsed = parse(yaml);
    } catch {
      return [];
    }

    const doc = parsed as ProjectYamlDocument;
    return (doc.project?.mappings ?? []).map((m) => m.path);
  }
}

/**
 * Error thrown when project deserialization fails.
 */
export class ProjectDeserializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDeserializationError";
  }
}
