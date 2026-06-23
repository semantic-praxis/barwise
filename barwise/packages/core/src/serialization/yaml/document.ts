import type { OrmYamlDefinition } from "./definition.js";
import type { OrmYamlDiagramLayout } from "./diagram.js";
import type { OrmYamlFactType } from "./factType.js";
import type { OrmYamlObjectifiedFactType } from "./objectified.js";
import type { OrmYamlObjectType } from "./objectType.js";
import type { OrmYamlPopulation } from "./population.js";
import type { OrmYamlSubtypeFact } from "./subtype.js";

/**
 * The shape of a parsed .orm.yaml document. This mirrors the JSON Schema
 * and is used as the intermediate representation between YAML text and
 * the in-memory OrmModel.
 */
export interface OrmYamlDocument {
  orm_version: string;
  model: {
    name: string;
    domain_context?: string;
    note?: string;
    object_types?: OrmYamlObjectType[];
    fact_types?: OrmYamlFactType[];
    subtype_facts?: OrmYamlSubtypeFact[];
    objectified_fact_types?: OrmYamlObjectifiedFactType[];
    populations?: OrmYamlPopulation[];
    definitions?: OrmYamlDefinition[];
    diagrams?: OrmYamlDiagramLayout[];
  };
}
